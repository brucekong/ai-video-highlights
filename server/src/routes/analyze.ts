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
                videoDescription: { type: 'string', nullable: true },
                videoHashtags: { type: 'string', nullable: true },
                isIndexed: { type: 'boolean', description: '是否已完成向量化索引' },
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

        if (cached && cached.subtitles.length > 0) {
          const userId = getUserId(request);
          if (userId) {
            await prisma.userHistory.upsert({
              where: { userId_videoId: { userId, videoId } },
              create: { userId, videoId },
              update: { createdAt: new Date() },
            });
          }

          // 检查索引状态 (Prisma 不直接支持 Unsupported 字段的 NOT NULL 查询，需用 Raw SQL)
          const videoIndexedResult: any[] = await prisma.$queryRaw`SELECT 1 FROM videos WHERE video_id = ${videoId} AND "embedding" IS NOT NULL`;
          const subtitlesIndexedResult: any[] = await prisma.$queryRaw`SELECT 1 FROM subtitles WHERE video_id = ${videoId} AND "embedding" IS NOT NULL LIMIT 1`;
          const isIndexed = videoIndexedResult.length > 0 || subtitlesIndexedResult.length > 0;

          return reply.send({
            success: true,
            cached: true,
            data: {
              videoTitle: cached.title,
              mindmap: cached.mindmap,
              videoDescription: cached.videoDescription,
              videoHashtags: cached.videoHashtags,
              isIndexed,
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

      // 4. 保存基础结果 (视频信息 + 原始字幕)
      // 这里的标题先用元数据的，如果没有元数据则留空，后续 AI 摘要会更新更精准的标题
      await prisma.$transaction(async (tx) => {
        await tx.video.upsert({
          where: { videoId },
          create: { videoId, url, title: metadata.title || '', platform, duration: 0 },
          update: { url, platform }, // 不覆盖已有标题，除非是新创建
        });

        // 仅在没有字幕时创建，或者强制刷新时重新创建
        const existingSubtitles = await tx.subtitle.count({ where: { videoId } });
        if (existingSubtitles === 0 || forceRefresh) {
          await tx.subtitle.deleteMany({ where: { videoId } });
          await tx.subtitle.createMany({
            data: transcript.map((seg, i) => ({ videoId, text: seg.text, offset: seg.offset, duration: seg.duration, sortOrder: i })),
          });
        }
      });

      // 5. 开启后台异步任务：AI 摘要 & 脑图 & 翻译 & 向量生成
      const backgroundTask = async () => {
        try {
          console.log(`[Background] Starting analysis pipeline for ${videoId}...`);

          // STAGE 1: 立即生成原文向量索引 —— 目标是让“语义搜索”按钮最快可用
          const initialEmbeddingTask = async () => {
            try {
              console.log(`[Background] Stage 1: Fast Indexing (Original Text) for ${videoId}...`);

              // A1. 视频标题索引 (使用元数据的标题，避免等待 AI 生成新标题)
              const titleEmbedding = await getEmbedding(metadata.title || videoId);
              if (titleEmbedding) {
                await prisma.$executeRawUnsafe(
                  `UPDATE videos SET "embedding" = $1::vector WHERE video_id = $2`,
                  `[${titleEmbedding.join(',')}]`,
                  videoId
                );
              }

              // A2. 字幕原文索引 (并发生成)
              const subtitleEmbeddings = await getEmbeddings(transcript.map(s => s.text));
              for (let i = 0; i < subtitleEmbeddings.length; i++) {
                const vec = subtitleEmbeddings[i];
                await prisma.$executeRawUnsafe(
                  `UPDATE subtitles SET "embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
                  `[${vec.join(',')}]`,
                  videoId,
                  i
                );
              }
              console.log(`[Background] Stage 1: Fast Indexing done. Semantic Search button should release now.`);
            } catch (err) {
              console.error(`[Background Task] Stage 1 (Initial Embedding) failed:`, err);
            }
          };

          // STAGE 2: AI 深度分析 (摘要、脑图)
          const aiAnalysisTask = async () => {
            try {
              console.log(`[Background] Stage 2: AI Summary & Mindmap starting...`);
              const lastSegment = transcript[transcript.length - 1];
              const maxDurationSeconds = Math.ceil((lastSegment.offset + lastSegment.duration) / 1000);
              const aiResult = await analyzeTranscript(formattedText, maxDurationSeconds);

              // 更新视频标题、脑图、分类和标签
              await prisma.video.update({
                where: { videoId },
                data: {
                  title: aiResult.title,
                  mindmap: aiResult.mindmap,
                  category: aiResult.category,
                  tags: Array.isArray(aiResult.tags) ? aiResult.tags.join(',') : '',
                  videoDescription: aiResult.videoDescription,
                  videoHashtags: aiResult.videoHashtags,
                  duration: maxDurationSeconds
                }
              });

              // 同时更新标题的原文向量（基于 AI 优化的新标题）
              const newTitleEmbedding = await getEmbedding(aiResult.title);
              await prisma.$executeRawUnsafe(
                `UPDATE videos SET "embedding" = $1::vector WHERE video_id = $2`,
                `[${newTitleEmbedding.join(',')}]`,
                videoId
              );

              await prisma.takeaway.deleteMany({ where: { videoId } });
              await prisma.takeaway.createMany({
                data: aiResult.takeaways.map((t, i) => ({ videoId, title: t.title, summary: t.summary, timestamp: t.timestamp, duration: t.duration, sortOrder: i })),
              });
              console.log(`[Background] Stage 2: AI Summary & Mindmap completed.`);
            } catch (err) {
              console.error(`[Background Task] Stage 2 (AI Analysis) failed:`, err);
            }
          };

          // STAGE 3: 翻译流程 (文本翻译 + 向量化) - 采用增量批处理
          const translationFlowTask = async () => {
             try {
               const needsTranslation = transcript.slice(0, 10).filter(s => !/[\u4e00-\u9fa5]/.test(s.text)).length > 5;
               if (!needsTranslation) return;

               console.log(`[Background] Stage 3: Incremental translation starting for ${videoId}...`);

               const BATCH_SIZE = 50;
               const totalSegments = transcript.length;

               for (let i = 0; i < totalSegments; i += BATCH_SIZE) {
                 try {
                   const batch = transcript.slice(i, i + BATCH_SIZE);
                   const batchTexts = batch.map(s => s.text);

                   console.log(`[Background] Translating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalSegments / BATCH_SIZE)} for ${videoId}...`);
                   const translatedBatch = await translateTranscriptSegments(batchTexts);

                   // 1. 立即回填翻译文本
                   for (let j = 0; j < translatedBatch.length; j++) {
                     const sortOrder = i + j;
                     if (translatedBatch[j]) {
                        await prisma.subtitle.updateMany({
                          where: { videoId, sortOrder },
                          data: { translatedText: translatedBatch[j] }
                        });
                     }
                   }

                   // 2. 立即生成并回填翻译版本的向量索引 (对搜索即时生效)
                   const validBatchTexts = translatedBatch.filter(t => !!t);
                   if (validBatchTexts.length > 0) {
                      const transEmbeds = await getEmbeddings(validBatchTexts);
                      let transIdx = 0;
                      for (let j = 0; j < translatedBatch.length; j++) {
                        const sortOrder = i + j;
                        if (translatedBatch[j]) {
                          const vec = transEmbeds[transIdx++];
                          await prisma.$executeRawUnsafe(
                            `UPDATE subtitles SET "translated_embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
                            `[${vec.join(',')}]`,
                            videoId,
                            sortOrder
                          );
                        }
                      }
                   }
                   console.log(`[Background] Batch ${Math.floor(i / BATCH_SIZE) + 1} updated to DB.`);
                 } catch (batchErr) {
                   console.error(`[Background Task] Translation batch failed at index ${i}:`, batchErr);
                 }
               }

               // 3. 最后更新视频标题的翻译
               try {
                 const translatedTitle = await translateTranscriptSegments([metadata.title || videoId]);
                 if (translatedTitle[0]) {
                    await prisma.video.update({
                      where: { videoId },
                      data: { title: translatedTitle[0] }
                    });
                    const titleTransEmbed = await getEmbedding(translatedTitle[0]);
                    await prisma.$executeRawUnsafe(
                      `UPDATE videos SET "translated_embedding" = $1::vector WHERE video_id = $2`,
                      `[${titleTransEmbed.join(',')}]`,
                      videoId
                    );
                 }
               } catch (titleErr) {
                 console.error(`[Background Task] Title translation failed:`, titleErr);
               }
               console.log(`[Background] Stage 3: Translation and secondary indexing fully completed.`);
             } catch (err) {
               console.error(`[Background Task] Stage 3 (Translation Flow) encountered fatal error:`, err);
             }
          };

          // 核心执行逻辑：
          // 1. 先做原文索引（最快解锁按钮）
          await initialEmbeddingTask();
          // 2. 然后并行处理 AI 分析和翻译流
          await Promise.all([aiAnalysisTask(), translationFlowTask()]);

        } catch (err) {
          console.error(`[Background Task Overall] ${videoId}:`, err);
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

      // 6. 立即返回初步结果
      // 此时 takeaways 为空，mindmap 为空，由前端后续轮询
      return reply.send({
        success: true,
        cached: false,
        data: {
          videoTitle: metadata.title || '',
          mindmap: null,
          videoDescription: null,
          videoHashtags: null,
          isIndexed: false, // 明确告知前端处于未索引状态，启动轮询
          takeaways: [],
          transcript: transcript.map((s) => ({
            text: s.text,
            translatedText: null,
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

  /**
   * POST /api/translate
   * 单独翻译一段或几段字幕
   */
  fastify.post('/api/translate', {
    schema: {
      tags: ['Analyze'],
      summary: '翻译字幕片段',
      description: '将输入的文本片段翻译成中文。',
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: '待翻译的文本' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            translatedText: { type: 'string' },
          },
        },
        500: Schemas.ErrorResponse,
      },
    },
  }, async (request: FastifyRequest<{ Body: { text: string } }>, reply: FastifyReply) => {
    const { text } = request.body;
    try {
      const results = await translateTranscriptSegments([text]);
      return reply.send({
        success: true,
        translatedText: results[0] || '',
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });
}

