import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { fetchTranscript, formatTranscriptForAI, type TranscriptSegment } from '../services/transcript.js';
import { fetchBilibiliTranscript } from '../services/bilibili.js';
import { analyzeTranscript, translateTranscriptSegments, getEmbedding, getEmbeddings } from '../services/ai.js';
import { fallbackToWhisper } from '../services/whisper.js';
import { fetchVideoMetadata } from '../services/metadata.js';
import { containsSensitiveContent } from '../services/safety.js';
import { Schemas } from '../docs/openapi.js';
import { getUserId } from '../utils/auth.js';

interface AnalyzeBody {
  videoId: string;
  url: string;
  platform?: 'youtube' | 'bilibili';
  forceRefresh?: boolean;
}

export async function analyzeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/analyze
   * 分析视频内容并保存结果
   */
  fastify.post('/api/analyze', {
    schema: {
      tags: ['Analyze'],
      summary: '分析视频并提取关键要点',
      description: '提交一个视频 URL 进行 AI 分析。如果数据库中已有结果且未强制刷新，则返回缓存。',
      body: {
        type: 'object',
        required: ['videoId', 'url'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
          url: { type: 'string', description: '视频完整 URL' },
          platform: { type: 'string', enum: ['youtube', 'bilibili'], default: 'youtube' },
          forceRefresh: { type: 'boolean', default: false },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cached: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                videoTitle: { type: 'string', nullable: true },
                mindmap: { type: 'string', nullable: true },
                takeaways: { type: 'array', items: Schemas.TakeawayItem },
                transcript: { type: 'array', items: Schemas.TranscriptSegment },
              },
            },
          },
        },
        500: Schemas.ErrorResponse,
      },
    },
  }, async (request: FastifyRequest<{ Body: AnalyzeBody }>, reply: FastifyReply) => {
    const { videoId, url, platform = 'youtube', forceRefresh = false } = request.body;

    try {
      // 1. 检查缓存
      if (!forceRefresh) {
        const cached = await prisma.video.findUnique({
          where: { videoId },
          include: {
            takeaways: { orderBy: { sortOrder: 'asc' } },
            subtitles: { orderBy: { sortOrder: 'asc' } },
          },
        });

        if (cached && cached.takeaways.length > 0) {
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
              mindmap: cached.mindmap,
              takeaways: cached.takeaways,
              transcript: cached.subtitles.map(s => ({
                text: s.text,
                translatedText: s.translatedText,
                offset: s.offset,
                duration: s.duration,
              })),
            },
          });
        }
      }

      // 2. 获取元数据并进行安全检查
      const metadata = await fetchVideoMetadata(videoId, platform);
      if (containsSensitiveContent(metadata.title) || containsSensitiveContent(metadata.author)) {
        return reply.status(403).send({ error: '安全拦截：该内容包含敏感政治话题，暂不支持分析。' });
      }

      // 3. 获取字幕并进行安全检查
      let transcript: TranscriptSegment[] = [];
      try {
        transcript = platform === 'bilibili'
          ? await fetchBilibiliTranscript(videoId)
          : await fetchTranscript(videoId);
      } catch (e: any) {
        fastify.log.warn(`[Transcript] Primary fetch failed: ${e.message}. Attempting Whisper fallback...`);
      }

      if (!transcript || transcript.length === 0) {
        try {
          fastify.log.info(`[Transcript] Triggering Whisper fallback for ${videoId}...`);
          transcript = await fallbackToWhisper(videoId, platform);
        } catch (fbError: any) {
          fastify.log.error(`[Whisper Fallback Failed] ${fbError.message}`);
        }
      }

      if (!transcript || transcript.length === 0) {
        return reply.status(422).send({ error: '无法获取该视频转录文本。' });
      }

      const formattedText = formatTranscriptForAI(transcript);
      if (containsSensitiveContent(formattedText)) {
        return reply.status(403).send({ error: '安全拦截：转录内容涉及受限话题。' });
      }

      // 4. AI 分析 (此时不等待翻译)
      const lastSegment = transcript[transcript.length - 1];
      const maxDurationSeconds = Math.ceil((lastSegment.offset + lastSegment.duration) / 1000);
      const aiResult = await analyzeTranscript(formattedText, maxDurationSeconds);

      // 5. 保存基础结果 (视频信息, 摘要, 原始字幕)
      await prisma.$transaction(async (tx) => {
        await tx.video.upsert({
          where: { videoId },
          create: { videoId, url, title: aiResult.title, mindmap: aiResult.mindmap, platform, duration: maxDurationSeconds },
          update: { title: aiResult.title, mindmap: aiResult.mindmap, platform, duration: maxDurationSeconds },
        });

        await tx.takeaway.deleteMany({ where: { videoId } });
        await tx.takeaway.createMany({
          data: aiResult.takeaways.map((t, i) => ({ videoId, title: t.title, summary: t.summary, timestamp: t.timestamp, duration: t.duration, sortOrder: i })),
        });

        await tx.subtitle.deleteMany({ where: { videoId } });
        await tx.subtitle.createMany({
          data: transcript.map((seg, i) => ({ videoId, text: seg.text, offset: seg.offset, duration: seg.duration, sortOrder: i })),
        });
      });

      // 6. 开启后台异步任务：翻译 & 向量生成
      const backgroundTask = async () => {
        try {
          console.log(`[Background] Starting translation & embedding for ${videoId}...`);

          // A. 翻译
          const needsTranslation = transcript.slice(0, 10).filter(s => !/[\u4e00-\u9fa5]/.test(s.text)).length > 5;
          let translatedTexts: string[] = [];

          if (needsTranslation) {
            translatedTexts = await translateTranscriptSegments(transcript.map(s => s.text));
            // 批量更新数据库中的译文
            for (let i = 0; i < translatedTexts.length; i++) {
              if (translatedTexts[i]) {
                await prisma.subtitle.updateMany({
                  where: { videoId, sortOrder: i },
                  data: { translatedText: translatedTexts[i] }
                });
              }
            }
            console.log(`[Background] Translation completed for ${videoId}`);
          }

          // B. 向量生成 (Embedding)
          const titleEmbedding = await getEmbedding(aiResult.title);
          const subtitleEmbeddings = await getEmbeddings(translatedTexts.length > 0 ? translatedTexts : transcript.map(s => s.text));

          await prisma.$executeRaw`UPDATE videos SET embedding = ${`[${titleEmbedding.join(',')}]`}::vector WHERE video_id = ${videoId}`;

          await Promise.all(subtitleEmbeddings.map((vec, idx) => {
            const vectorStr = `[${vec.join(',')}]`;
            const offset = transcript[idx].offset;
            return prisma.$executeRaw`UPDATE subtitles SET embedding = ${vectorStr}::vector WHERE video_id = ${videoId} AND "offset" = ${offset}`;
          }));

          console.log(`[Background] Embedding generation completed for ${videoId}`);
        } catch (err) {
          console.error(`[Background Task Failed] ${videoId}:`, err);
        }
      };

      // 触发后台任务，不等待
      backgroundTask();

      const userId = getUserId(request);
      if (userId) {
        await prisma.userHistory.upsert({
          where: { userId_videoId: { userId, videoId } },
          create: { userId, videoId },
          update: { createdAt: new Date() },
        });
      }

      // 立即返回初始分析结果 (翻译字段为空，由前端后续轮询)
      return reply.send({
        success: true,
        cached: false,
        data: {
          videoTitle: aiResult.title,
          mindmap: aiResult.mindmap,
          takeaways: aiResult.takeaways,
          transcript: transcript.map((s, i) => ({
            text: s.text,
            translatedText: null, // 初始返回为空
            offset: s.offset,
            duration: s.duration,
          })),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });
}
