import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { fetchTranscript, formatTranscriptForAI, type TranscriptSegment } from '../services/transcript.js';
import { fetchBilibiliTranscript } from '../services/bilibili.js';
import { analyzeTranscript, translateTranscriptSegments } from '../services/ai.js';
import { fallbackToWhisper } from '../services/whisper.js';
import { fetchVideoMetadata } from '../services/metadata.js';
import { containsSensitiveContent, SafetyValidationError } from '../services/safety.js';
import jwt from 'jsonwebtoken';
import { Schemas } from '../docs/openapi.js';
import { JWT_SECRET, getUserId } from '../utils/auth.js';

interface TranscriptQuery {
  videoId: string;
  platform?: string;
}


interface AnalyzeBody {
  videoId: string;
  url: string;
  platform?: 'youtube' | 'bilibili';  // 视频平台
  forceRefresh?: boolean;
}

export async function analyzeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/analyze
   * 分析 YouTube 视频，提取关键要点
   */
  fastify.post('/api/analyze', {
    schema: {
      tags: ['Analyze'],
      summary: '分析视频并提取关键要点',
      description: '提交一个视频 URL 进行 AI 分析，自动提取字幕、生成关键要点摘要。支持 YouTube 和 Bilibili 平台。如果数据库中已有缓存结果且未强制刷新，则直接返回缓存。',
      body: {
        type: 'object',
        required: ['videoId', 'url'],
        properties: {
          videoId: { type: 'string', description: '视频 ID（YouTube video ID 或 Bilibili BV号）', examples: ['dQw4w9WgXcQ'] },
          url: { type: 'string', description: '视频完整 URL', examples: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] },
          platform: { type: 'string', enum: ['youtube', 'bilibili'], default: 'youtube', description: '视频平台' },
          forceRefresh: { type: 'boolean', default: false, description: '是否强制刷新（忽略缓存重新分析）' },
        },
      },
      response: {
        200: {
          type: 'object',
          description: '分析成功',
          properties: {
            success: { type: 'boolean', example: true },
            cached: { type: 'boolean', description: '是否命中缓存' },
            data: {
              type: 'object',
              properties: {
                videoTitle: { type: 'string', nullable: true },
                takeaways: {
                  type: 'array',
                  items: Schemas.TakeawayItem,
                },
                transcript: {
                  type: 'array',
                  items: Schemas.TranscriptSegment,
                },
              },
            },
          },
        },
        400: Schemas.ErrorResponse,
        422: Schemas.ErrorResponse,
        429: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Body: AnalyzeBody }>,
    reply: FastifyReply,
  ) => {
    const { videoId, url, platform = 'youtube', forceRefresh = false } = request.body;

    if (!videoId) {
      return reply.status(400).send({ error: 'videoId is required' });
    }

    // 根据平台选择字幕获取方法
    const fetchVideoTranscript = async (id: string): Promise<TranscriptSegment[]> => {
      if (platform === 'bilibili') {
        return fetchBilibiliTranscript(id);
      }
      return fetchTranscript(id);
    };

    try {
      // 1. 检查缓存 — 如果数据库中已有分析结果且不需要强制刷新，直接返回
      if (!forceRefresh) {
        const cached = await prisma.video.findUnique({
          where: { videoId },
          include: {
            takeaways: {
              orderBy: { sortOrder: 'asc' },
            },
            subtitles: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        });

        if (cached && cached.takeaways.length > 0) {
          fastify.log.info(`Cache hit for video: ${videoId} (takeaways: ${cached.takeaways.length}, subtitles: ${cached.subtitles.length})`);

          const userId = getUserId(request);
          if (userId) {
            await prisma.userHistory.upsert({
              where: { userId_videoId: { userId, videoId } },
              create: { userId, videoId },
              update: { createdAt: new Date() },
            });
          }

          return reply.send({
            success: true,
            cached: true,
            data: {
              videoTitle: cached.title,
              takeaways: cached.takeaways.map((t) => ({
                id: t.id,
                title: t.title,
                summary: t.summary,
                timestamp: t.timestamp,
                duration: t.duration,
              })),
              transcript: cached.subtitles.map((s) => ({
                text: s.text,
                translatedText: s.translatedText, // 返回翻译
                offset: s.offset,
                duration: s.duration,
              })),
            },
          });
        }
      }

      // 2. 视频元数据预检 (用于拦截已知的敏感作者/标题)
      fastify.log.info(`Pre-checking video metadata for ${platform} video: ${videoId}`);
      const metadata = await fetchVideoMetadata(videoId, platform);

      if (containsSensitiveContent(metadata.title) || containsSensitiveContent(metadata.author)) {
        fastify.log.warn(`[Safety Block] Blocked video: ${metadata.title} by ${metadata.author}`);
        return reply.status(403).send({
          error: '安全拦截：该视频包含受限或敏感政治内容，暂不支持分析。',
        });
      }

      // 3. 获取视频字幕（从外部平台）
      fastify.log.info(`Fetching transcript for ${platform} video: ${videoId}`);
      let transcript: TranscriptSegment[] = [];
      try {
        transcript = await fetchVideoTranscript(videoId);
      } catch (e: any) {
        fastify.log.warn(`[Transcript] Primary fetch failed: ${e.message}. Attempting Whisper fallback...`);
      }

      // 3. 兜底方案：如果官方字幕失败或没有字幕，走下载音频->Whisper路线
      if (!transcript || transcript.length === 0) {
        try {
          fastify.log.info(`No primary transcript available. Triggering Whisper fallback...`);
          transcript = await fallbackToWhisper(videoId, platform);
        } catch (fbError: any) {
          fastify.log.error(`[Whisper Fallback Failed] ${fbError.message}`);
        }
      }

      if (!transcript || transcript.length === 0) {
        return reply.status(422).send({
          error: 'No transcript available for this video, and Whisper fallback failed. The video may not have subtitles/captions or the audio is too long.',
        });
      }

      // 4. 格式化并发送给 AI 分析前，先扫描字幕内容
      const formattedText = formatTranscriptForAI(transcript);

      if (containsSensitiveContent(formattedText)) {
        fastify.log.warn(`[Safety Block] Transcript content for ${videoId} contains sensitive patterns.`);
        return reply.status(403).send({
            error: '安全拦截：分析检测到转录内容涉及受限话题，暂不提供摘要服务。',
        });
      }

      const lastSegment = transcript[transcript.length - 1];
      const maxDurationSeconds = Math.ceil((lastSegment.offset + lastSegment.duration) / 1000);

      fastify.log.info(`Analyzing transcript (${transcript.length} segments, duration: ${maxDurationSeconds}s)...`);
      const aiResult = await analyzeTranscript(formattedText, maxDurationSeconds);

      // 4. 判断是否需要翻译字幕（如果是英文/外语视频）
      // 简单判断：如果前 10 个片段中有一半以上不包含中文，则尝试翻译
      const needsTranslation = transcript.slice(0, 10).filter(s => !/[\u4e00-\u9fa5]/.test(s.text)).length > 5;
      let translatedTexts: string[]
      = [];
      if (needsTranslation) {
        fastify.log.info(`Translating ${transcript.length} segments to Chinese...`);
        translatedTexts = await translateTranscriptSegments(transcript.map(s => s.text));
      }

      // 5. 存储到数据库（事务：upsert video + 字幕 + takeaways）
      await prisma.$transaction(async (tx) => {
        // Upsert video
        await tx.video.upsert({
          where: { videoId },
          create: {
            videoId,
            url,
            title: aiResult.title,
            platform,
          },
          update: {
            url,
            title: aiResult.title,
            platform,
          },
        });

        // 删除旧的 takeaways
        await tx.takeaway.deleteMany({
          where: { videoId },
        });

        // 创建新的 takeaways
        await tx.takeaway.createMany({
          data: aiResult.takeaways.map((t, index) => ({
            videoId,
            title: t.title,
            summary: t.summary,
            timestamp: t.timestamp,
            duration: t.duration,
            sortOrder: index,
          })),
        });

        // 删除旧的字幕缓存
        await tx.subtitle.deleteMany({
          where: { videoId },
        });

        // 保存新的字幕到数据库
        await tx.subtitle.createMany({
          data: transcript.map((seg, index) => ({
            videoId,
            text: seg.text,
            translatedText: translatedTexts[index] || null, // 存储翻译
            offset: seg.offset,
            duration: seg.duration,
            sortOrder: index,
          })),
        });
      });

      fastify.log.info(`Saved ${transcript.length} subtitles and ${aiResult.takeaways.length} takeaways to DB`);

      // 5. 从数据库重新读取完整数据返回
      const result = await prisma.video.findUnique({
        where: { videoId },
        include: {
          takeaways: {
            orderBy: { sortOrder: 'asc' },
          },
          subtitles: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      const userId = getUserId(request);
      if (userId) {
        await prisma.userHistory.upsert({
          where: { userId_videoId: { userId, videoId } },
          create: { userId, videoId },
          update: { createdAt: new Date() },
        });
      }

      return reply.send({
        success: true,
        cached: false,
        data: {
          videoTitle: result?.title,
          takeaways: result?.takeaways.map((t) => ({
            id: t.id,
            title: t.title,
            summary: t.summary,
            timestamp: t.timestamp,
            duration: t.duration,
          })) || [],
          transcript: result?.subtitles.map((s) => ({
            text: s.text,
            translatedText: s.translatedText, // 返回翻译
            offset: s.offset,
            duration: s.duration,
          })) || [],
        },
      });
    } catch (error: any) {
      fastify.log.error(error);

      // 特定错误处理
      if (error.message?.includes('DEEPSEEK_API_KEY')) {
        return reply.status(500).send({
          error: 'AI service is not configured. Please set DEEPSEEK_API_KEY in server/.env',
        });
      }

      if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
        return reply.status(429).send({
          error: 'AI 服务请求频率超限，请稍后再试（建议等待片刻后重试）。',
        });
      }

      if (error.message?.includes('transcript')) {
        return reply.status(422).send({
          error: 'Failed to fetch video transcript. Please check if the video has subtitles enabled.',
        });
      }

      return reply.status(500).send({
        error: 'An internal error occurred during video analysis.',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/videos/:videoId
   * 获取之前分析过的视频结果
   */
  fastify.get('/api/videos/:videoId', {
    schema: {
      tags: ['Videos'],
      summary: '获取视频分析结果',
      description: '根据视频 ID 获取之前分析过的视频详情和关键要点。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                videoTitle: { type: 'string', nullable: true },
                takeaways: {
                  type: 'array',
                  items: Schemas.TakeawayItem,
                },
              },
            },
          },
        },
        404: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    const video = await prisma.video.findUnique({
      where: { videoId },
      include: {
        takeaways: {
          orderBy: { sortOrder: 'asc' },
        },
        subtitles: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    return reply.send({
      success: true,
      data: {
        videoTitle: video.title,
        takeaways: video.takeaways.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary,
          timestamp: t.timestamp,
          duration: t.duration,
        })),
        transcript: video.subtitles.map((s) => ({
          text: s.text,
          translatedText: s.translatedText,
          offset: s.offset,
          duration: s.duration,
        })),
      },
    });
  });

  fastify.delete('/api/videos/:videoId', {
    schema: {
      tags: ['Videos'],
      summary: '彻底删除视频数据',
      description: '从全局数据库中彻底删除视频记录及其所有的字幕、AI 分析要点以及所有效用户的历史记录。此操作不可逆。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      response: {
        200: Schemas.SuccessMessage,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    try {
      // 彻底删除视频记录。由于 Prisma Schema 中设置了 onDelete: Cascade，
      // 这会自动删除关联的 subtitles (字幕)、takeaways (AI要点) 以及所有用户的 UserHistory (历史记录)。
      await prisma.video.delete({
        where: { videoId },
      });

      fastify.log.info(`Deleted video globally: ${videoId} and all its related data.`);
      return reply.send({ success: true, message: '视频及相关所有数据已彻底删除' });
    } catch (error: any) {
      // 如果记录不存在 (P2025)，也返回成功，避免报错
      if (error.code === 'P2025') {
        return reply.send({ success: true, message: '记录已不存在' });
      }

      fastify.log.error(`Delete failed: ${error.message}`);
      return reply.status(500).send({
        error: '删除失败',
        message: error.message,
      });
    }
  });


  /**
   * GET /api/videos
   * 获取分析过的视频列表。如果用户已登录，获取该用户的历史记录；否则返回公共的最新记录。
   */
  fastify.get('/api/videos', {
    schema: {
      tags: ['Videos'],
      summary: '获取视频列表',
      description: '获取已分析的视频列表。如果用户已登录（携带 Bearer Token），返回该用户的历史记录（最多50条）；否则返回最新的公共记录（最多20条）。',
      security: [{ bearerAuth: [] }, {}],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: Schemas.VideoListItem,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userId = getUserId(request);

    if (userId) {
      const history = await prisma.userHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          video: {
            include: { _count: { select: { takeaways: true } } }
          }
        }
      });
      return reply.send({
        success: true,
        data: history.map(h => ({
          videoId: h.video.videoId,
          title: h.video.title,
          url: h.video.url,
          platform: h.video.platform,
          takeawayCount: h.video._count.takeaways,
          analyzedAt: h.createdAt,
        }))
      });
    }

    return reply.send({
      success: true,
      data: [],
    });
  });

  /**
   * GET /api/transcript/:videoId
   * 仅获取视频字幕，不做 AI 分析
   * 优先从数据库缓存读取，没有缓存时从平台获取并落库
   * 通过 query 参数 platform 指定平台: youtube（默认）或 bilibili
   */
  fastify.get('/api/transcript/:videoId', {
    schema: {
      tags: ['Transcript'],
      summary: '获取视频字幕',
      description: '仅获取视频字幕，不做 AI 分析。优先从数据库缓存读取，缓存未命中时从平台实时获取并保存到数据库。支持 Whisper 语音识别兜底。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['youtube', 'bilibili'], default: 'youtube', description: '视频平台' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached: { type: 'boolean', description: '是否命中缓存' },
            data: {
              type: 'object',
              properties: {
                videoId: { type: 'string' },
                segmentCount: { type: 'integer', description: '字幕段数' },
                segments: {
                  type: 'array',
                  items: Schemas.TranscriptSegment,
                },
              },
            },
          },
        },
        400: Schemas.ErrorResponse,
        422: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: TranscriptQuery; Querystring: { platform?: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const platform = (request.query.platform || 'youtube') as string;

    if (!videoId) {
      return reply.status(400).send({ error: 'videoId is required' });
    }

    try {
      // 1. 先查数据库缓存
      const cachedSubtitles = await prisma.subtitle.findMany({
        where: { videoId },
        orderBy: { sortOrder: 'asc' },
      });

      if (cachedSubtitles.length > 0) {
        fastify.log.info(`Subtitle cache hit for video: ${videoId} (${cachedSubtitles.length} segments)`);
        return reply.send({
          success: true,
          cached: true,
          data: {
            videoId,
            segmentCount: cachedSubtitles.length,
            segments: cachedSubtitles.map((s) => ({
              text: s.text,
              offset: s.offset,
              duration: s.duration,
            })),
          },
        });
      }

      // 2. 缓存未命中，从平台获取
      fastify.log.info(`Fetching transcript for ${platform} video: ${videoId}`);
      let transcript: TranscriptSegment[] = [];

      try {
        transcript = platform === 'bilibili'
          ? await fetchBilibiliTranscript(videoId)
          : await fetchTranscript(videoId);
      } catch (e: any) {
        fastify.log.warn(`[Transcript] Primary fetch failed: ${e.message}. Attempting Whisper fallback...`);
      }

      // 兜底方案
      if (!transcript || transcript.length === 0) {
        try {
          fastify.log.info(`No primary transcript available. Triggering Whisper fallback...`);
          transcript = await fallbackToWhisper(videoId, platform as 'youtube' | 'bilibili');
        } catch (fbError: any) {
          fastify.log.error(`[Whisper Fallback Failed] ${fbError.message}`);
        }
      }

      if (!transcript || transcript.length === 0) {
        return reply.status(422).send({
          error: 'No transcript available for this video, and Whisper fallback failed.',
        });
      }

      // 3. 保存到数据库（需要先确保 video 记录存在）
      await prisma.video.upsert({
        where: { videoId },
        create: { videoId, url: '', platform },
        update: { platform },
      });

      await prisma.subtitle.deleteMany({ where: { videoId } });
      await prisma.subtitle.createMany({
        data: transcript.map((seg, index) => ({
          videoId,
          text: seg.text,
          offset: seg.offset,
          duration: seg.duration,
          sortOrder: index,
        })),
      });

      fastify.log.info(`Saved ${transcript.length} subtitles to DB for video: ${videoId}`);

      return reply.send({
        success: true,
        cached: false,
        data: {
          videoId,
          segmentCount: transcript.length,
          segments: transcript.map((seg) => ({
            text: seg.text,
            offset: seg.offset,       // 毫秒
            duration: seg.duration,    // 毫秒
          })),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Failed to fetch transcript.',
        message: error.message,
      });
    }
  });
}

