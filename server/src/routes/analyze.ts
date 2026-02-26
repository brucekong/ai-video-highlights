import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { fetchTranscript, formatTranscriptForAI, type TranscriptSegment } from '../services/transcript.js';
import { fetchBilibiliTranscript } from '../services/bilibili.js';
import { analyzeTranscript } from '../services/ai.js';
import { fallbackToWhisper } from '../services/whisper.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

function getUserId(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded: any = jwt.verify(token, JWT_SECRET);
      return decoded.userId;
    } catch (e) {
      return null;
    }
  }
  return null;
}

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
  fastify.post('/api/analyze', async (
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
                offset: s.offset,
                duration: s.duration,
              })),
            },
          });
        }
      }

      // 2. 获取视频字幕（从外部平台）
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

      // 4. 格式化并发送给 AI 分析
      const formattedText = formatTranscriptForAI(transcript);
      fastify.log.info(`Analyzing transcript (${transcript.length} segments)...`);
      const aiResult = await analyzeTranscript(formattedText);

      // 4. 存储到数据库（事务：upsert video + 字幕 + takeaways）
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
  fastify.get('/api/videos/:videoId', async (
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
      },
    });
  });

  /**
   * GET /api/videos
   * 获取分析过的视频列表。如果用户已登录，获取该用户的历史记录；否则返回公共的最新记录。
   */
  fastify.get('/api/videos', async (request, reply) => {
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

    const videos = await prisma.video.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        _count: {
          select: { takeaways: true },
        },
      },
    });

    return reply.send({
      success: true,
      data: videos.map((v) => ({
        videoId: v.videoId,
        title: v.title,
        url: v.url,
        platform: v.platform,
        takeawayCount: v._count.takeaways,
        analyzedAt: v.createdAt,
      })),
    });
  });

  /**
   * GET /api/transcript/:videoId
   * 仅获取视频字幕，不做 AI 分析
   * 优先从数据库缓存读取，没有缓存时从平台获取并落库
   * 通过 query 参数 platform 指定平台: youtube（默认）或 bilibili
   */
  fastify.get('/api/transcript/:videoId', async (
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

