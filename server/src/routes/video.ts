import { createReadStream } from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma, { Prisma } from '../lib/prisma.js';
import { Schemas } from '../docs/openapi.js';
import { getUserId } from '../utils/auth.js';
import { downloadFullVideo } from '../services/clipping.js';
import { exportToNotion } from '../services/notion.js';
import { getPreferredTranscriptForVideo, rebuildSubtitleCuesForVideo } from '../services/subtitleCues.js';
import {
  analyzeTranscriptSummary,
  enrichKeywordGlossaryItem,
  generatePublishAssist,
  generateRedbookAssist,
  getEmbedding,
  isValidKeywordGlossaryEnglish,
  normalizeKeywordGlossaryEnglish,
  translateTranscriptSegments,
} from '../services/ai.js';

async function retranslateCueSegmentsForVideo(videoId: string) {
  const cueSegments = await prisma.subtitleCue.findMany({
    where: { videoId },
    orderBy: { sortOrder: 'asc' },
    select: {
      sortOrder: true,
      text: true,
      translatedText: true,
      sourceStartSortOrder: true,
      sourceEndSortOrder: true,
    },
  });

  const translatableCues = cueSegments.filter((cue) => (
    !/[\u4e00-\u9fa5]/.test(cue.text || '')
    && !/[\u4e00-\u9fa5]/.test(cue.translatedText || '')
  ));

  if (translatableCues.length === 0) {
    return 0;
  }

  const BATCH_SIZE = 50;
  let translatedCount = 0;

  for (let i = 0; i < translatableCues.length; i += BATCH_SIZE) {
    const batch = translatableCues.slice(i, i + BATCH_SIZE);
    const translatedBatch = await translateTranscriptSegments(batch.map((cue) => cue.text));

    for (let j = 0; j < translatedBatch.length; j++) {
      const cue = batch[j];
      const translatedText = translatedBatch[j];
      if (!cue || !translatedText) continue;

      await prisma.subtitleCue.updateMany({
        where: { videoId, sortOrder: cue.sortOrder },
        data: {
          translatedText,
        },
      });

      if (cue.sourceStartSortOrder === cue.sourceEndSortOrder) {
        await prisma.subtitle.updateMany({
          where: { videoId, sortOrder: cue.sourceStartSortOrder },
          data: { translatedText },
        });

        const vec = await getEmbedding(translatedText);
        await prisma.$executeRawUnsafe(
          `UPDATE subtitles SET "translated_embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
          `[${vec.join(',')}]`,
          videoId,
          cue.sourceStartSortOrder
        );
      }

      translatedCount += 1;
    }
  }

  return translatedCount;
}

export async function videoRoutes(fastify: FastifyInstance) {
  fastify.post('/api/videos/:videoId/keyword-glossary', {
    schema: {
      tags: ['Videos'],
      summary: '新增关键词词条',
      description: '为当前视频追加一个关键单词或短语词条；若缺少中文、音标或类型，会自动补全。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      body: {
        type: 'object',
        required: ['english'],
        properties: {
          english: { type: 'string' },
          phonetic: { type: 'string' },
          chinese: { type: 'string' },
          type: { type: 'string', enum: ['word', 'phrase'] },
          sourceText: { type: 'string', description: '该词条所在的原始字幕，用于辅助生成更准确的释义和音标' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            added: { type: 'boolean' },
            item: Schemas.KeywordGlossaryItem,
            message: { type: 'string' },
            data: {
              type: 'array',
              items: Schemas.KeywordGlossaryItem,
            },
          },
        },
        400: Schemas.ErrorResponse,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string }; Body: { english: string; phonetic?: string; chinese?: string; type?: 'word' | 'phrase'; sourceText?: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const english = normalizeKeywordGlossaryEnglish(request.body.english);
    const phonetic = String(request.body.phonetic || '').trim();
    const chinese = String(request.body.chinese || '').trim();
    const type = request.body.type === 'word' || request.body.type === 'phrase'
      ? request.body.type
      : undefined;
    const sourceText = String(request.body.sourceText || '').trim();

    if (!english) {
      return reply.status(400).send({ error: '英文单词或短语不能为空' });
    }

    if (!isValidKeywordGlossaryEnglish(english)) {
      return reply.status(400).send({ error: '请选择一个英文单词或短语，长度不要太长，也不要包含整句字幕。' });
    }

    const video = await prisma.video.findUnique({
      where: { videoId },
      select: { videoId: true, keywordGlossary: true },
    });

    if (!video) {
      return reply.status(404).send({ error: '视频不存在' });
    }

    const normalizedItem = await enrichKeywordGlossaryItem({
      english,
      phonetic,
      chinese,
      type,
      sourceText,
    });

    if (!normalizedItem.chinese) {
      return reply.status(400).send({ error: '无法为当前词条生成中文释义，请换一个更短的单词或短语再试。' });
    }

    const existing = Array.isArray(video.keywordGlossary) ? video.keywordGlossary as any[] : [];
    const existingIndex = existing.findIndex((item) => (
      normalizeKeywordGlossaryEnglish(String(item?.english || '')).toLowerCase() === english.toLowerCase()
    ));

    let added = false;
    let nextItem = normalizedItem;
    let nextGlossary = existing;

    if (existingIndex >= 0) {
      const existingItem = existing[existingIndex] || {};
      nextItem = {
        english,
        phonetic: String(existingItem?.phonetic || '').trim() || normalizedItem.phonetic || '',
        chinese: String(existingItem?.chinese || '').trim() || normalizedItem.chinese,
        type: existingItem?.type === 'word' || existingItem?.type === 'phrase'
          ? existingItem.type
          : normalizedItem.type,
      };

      nextGlossary = existing.map((item, index) => (
        index === existingIndex ? nextItem : item
      ));
    } else {
      added = true;
      nextGlossary = [...existing, normalizedItem];
    }

    await prisma.video.update({
      where: { videoId },
      data: {
        keywordGlossary: nextGlossary as unknown as Prisma.InputJsonValue,
      },
    });

    return reply.send({
      success: true,
      added,
      item: nextItem,
      message: added ? '关键词词条已加入当前视频。' : '该词条已存在，已自动补全缺失信息。',
      data: nextGlossary,
    });
  });

  fastify.delete('/api/videos/:videoId/keyword-glossary', {
    schema: {
      tags: ['Videos'],
      summary: '删除关键词词条',
      description: '从当前视频的关键词词表中删除一个单词或短语。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      body: {
        type: 'object',
        required: ['english'],
        properties: {
          english: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            removed: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'array',
              items: Schemas.KeywordGlossaryItem,
            },
          },
        },
        400: Schemas.ErrorResponse,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string }; Body: { english: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const english = normalizeKeywordGlossaryEnglish(request.body.english);

    if (!english) {
      return reply.status(400).send({ error: '要删除的关键词不能为空' });
    }

    const video = await prisma.video.findUnique({
      where: { videoId },
      select: { videoId: true, keywordGlossary: true },
    });

    if (!video) {
      return reply.status(404).send({ error: '视频不存在' });
    }

    const existing = Array.isArray(video.keywordGlossary) ? video.keywordGlossary as any[] : [];
    const nextGlossary = existing.filter((item) => (
      normalizeKeywordGlossaryEnglish(String(item?.english || '')).toLowerCase() !== english.toLowerCase()
    ));

    const removed = nextGlossary.length !== existing.length;
    if (!removed) {
      return reply.status(404).send({ error: '未找到要删除的关键词词条' });
    }

    await prisma.video.update({
      where: { videoId },
      data: {
        keywordGlossary: nextGlossary as unknown as Prisma.InputJsonValue,
      },
    });

    return reply.send({
      success: true,
      removed: true,
      message: '关键词词条已删除。',
      data: nextGlossary,
    });
  });

  /**
   * GET /api/videos
   * 获取分析过的视频列表。如果用户已登录，获取该用户的历史记录；否则返回空。
   */
  fastify.get('/api/videos', {
    schema: {
      tags: ['Videos'],
      summary: '获取视频列表',
      description: '获取已分析的视频列表。如果用户已登录，返回该用户的历史记录。支持分页。',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: Schemas.VideoListItem,
            },
            meta: {
              type: 'object',
              properties: {
                totalCount: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                hasMore: { type: 'boolean' },
              }
            }
          },
        },
      },
    },
  }, async (
    request: FastifyRequest<{ Querystring: { page?: number; limit?: number; startDate?: string; endDate?: string } }>,
    reply: FastifyReply,
  ) => {
    const userId = getUserId(request);
    const { page = 1, limit = 20, startDate, endDate } = request.query;

    if (userId) {
      const skip = (page - 1) * limit;

      const where: any = { userId };
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
      }

      const [totalCount, history] = await Promise.all([
        prisma.userHistory.count({ where }),
        prisma.userHistory.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            video: {
              include: { _count: { select: { takeaways: true } } }
            }
          }
        })
      ]);

      // 提取本页所有的 videoId 用于查向量状态
      const videoIds = history.map(h => h.video.videoId);
      const indexedResult: { video_id: string }[] = videoIds.length > 0
        ? await prisma.$queryRaw`SELECT video_id FROM videos WHERE video_id IN (${Prisma.join(videoIds)}) AND embedding IS NOT NULL`
        : [];
      const indexedIds = new Set(indexedResult.map(r => r.video_id));

      return reply.send({
        success: true,
        data: history.map(h => ({
          videoId: h.video.videoId,
          title: h.video.title,
          url: h.video.url,
          platform: h.video.platform,
          duration: h.video.duration,
          takeawayCount: h.video._count.takeaways,
          analyzedAt: h.createdAt,
          isIndexed: indexedIds.has(h.video.videoId),
          category: h.video.category,
          tags: h.video.tags ? h.video.tags.split(',') : [],
        })),
        meta: {
          totalCount,
          page,
          limit,
          hasMore: skip + history.length < totalCount
        }
      });
    }

    return reply.send({
      success: true,
      data: [],
      meta: { totalCount: 0, page, limit, hasMore: false }
    });
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
                mindmap: { type: 'string', nullable: true, description: '视频结构脑图 Markdown' },
                videoDescription: { type: 'string', nullable: true },
                videoHashtags: { type: 'string', nullable: true },
                keywordGlossary: { type: 'array', items: Schemas.KeywordGlossaryItem, nullable: true },
                redbookTitle: { type: 'string', nullable: true },
                redbookDescription: { type: 'string', nullable: true },
                redbookHashtags: { type: 'string', nullable: true },
                summaryReady: { type: 'boolean' },
                publishReady: { type: 'boolean' },
                redbookReady: { type: 'boolean' },
                mindmapReady: { type: 'boolean' },
                isIndexed: { type: 'boolean', description: '是否已完成向量化索引' },
                transcriptSource: { type: 'string', enum: ['raw', 'cue'] },
                transcript: {
                  type: 'array',
                  items: Schemas.TranscriptSegment,
                }
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
        subtitleCues: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    const videoIndexedResult: any[] = await prisma.$queryRaw`SELECT 1 FROM videos WHERE video_id = ${videoId} AND "embedding" IS NOT NULL`;
    const subtitlesIndexedResult: any[] = await prisma.$queryRaw`SELECT 1 FROM subtitles WHERE video_id = ${videoId} AND "embedding" IS NOT NULL LIMIT 1`;
    const isIndexed = videoIndexedResult.length > 0 || subtitlesIndexedResult.length > 0;
    const transcript = await getPreferredTranscriptForVideo(prisma, videoId);

    console.log(`[Video Route] ID: ${videoId}, isIndexed: ${isIndexed} (Video: ${videoIndexedResult.length}, Subtitles: ${subtitlesIndexedResult.length})`);

    return reply.send({
      success: true,
      data: {
        videoTitle: video.title,
        mindmap: video.mindmap,
        videoDescription: video.videoDescription,
        videoHashtags: video.videoHashtags,
        keywordGlossary: Array.isArray(video.keywordGlossary) ? video.keywordGlossary : [],
        redbookTitle: video.redbookTitle,
        redbookDescription: video.redbookDescription,
        redbookHashtags: video.redbookHashtags,
        summaryReady: video.takeaways.length > 0,
        publishReady: Boolean(video.videoDescription || video.videoHashtags || (Array.isArray(video.keywordGlossary) && video.keywordGlossary.length > 0)),
        redbookReady: Boolean(video.redbookTitle || video.redbookDescription),
        mindmapReady: Boolean(video.mindmap),
        isIndexed,
        transcriptSource: video.subtitleCues.length > 0 ? 'cue' : 'raw',
        takeaways: video.takeaways.map((t) => ({
          id: t.id,
          title: t.title,
          summary: t.summary,
          timestamp: t.timestamp,
          duration: t.duration,
        })),
        transcript,
        category: video.category,
        tags: video.tags ? video.tags.split(',') : [],
      },
    });
  });

  /**
   * GET /api/videos/:videoId/download
   * 下载完整视频文件
   */
  fastify.get('/api/videos/:videoId/download', {
    schema: {
      tags: ['Videos'],
      summary: '下载完整视频',
      description: '根据视频 ID 下载完整视频文件，支持指定期望清晰度。',
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
          quality: {
            type: 'string',
            enum: ['1080', '1440', '2160', 'best'],
            default: '1080',
            description: '目标清晰度',
          },
        },
      },
      response: {
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string }, Querystring: { quality?: '1080' | '1440' | '2160' | 'best' } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const quality = request.query.quality || '1080';

    const video = await prisma.video.findUnique({
      where: { videoId },
      select: {
        videoId: true,
        title: true,
        url: true,
        platform: true,
        subtitles: {
          orderBy: { sortOrder: 'asc' },
          select: {
            text: true,
            translatedText: true,
            offset: true,
            duration: true,
          },
        },
      },
    });

    if (!video) {
      return reply.status(404).send({ error: 'Video not found', message: '视频不存在' });
    }

    try {
      const subtitleSample = video.subtitles.slice(0, 20);
      const chineseSubtitleCount = subtitleSample.filter((s) => /[\u4e00-\u9fa5]/.test(s.text)).length;
      const isChinese = subtitleSample.length > 0
        ? chineseSubtitleCount >= Math.ceil(subtitleSample.length / 3)
        : /[\u4e00-\u9fa5]/.test(video.title || '');

      const transcript = await getPreferredTranscriptForVideo(prisma, videoId);
      const cueCount = await prisma.subtitleCue.count({ where: { videoId } });

      const filePath = await downloadFullVideo({
        videoId: video.videoId,
        title: video.title || 'video',
        url: video.url,
        platform: video.platform,
        quality,
        language: isChinese ? 'zh' : undefined,
        subtitles: transcript.map((s) => ({
          text: s.text,
          translatedText: s.translatedText || undefined,
          offset: s.offset,
          duration: s.duration,
        })),
        subtitlesAreCues: cueCount > 0,
      });

      const filename = path.basename(filePath);
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return reply.send(createReadStream(filePath));
    } catch (error: any) {
      request.log.error({ err: error, videoId, quality }, 'Full video download failed');
      return reply.status(500).send({
        error: 'Download failed',
        message: error?.message || '视频下载失败，请稍后重试',
      });
    }
  });

  /**
   * POST /api/videos/:videoId/re-embed
   * 重新生成视频及字幕的向量索引
   */
  fastify.post('/api/videos/:videoId/re-embed', {
    schema: {
      tags: ['Videos'],
      summary: '重新生成向量索引',
      description: '当视频分析成功但向量生成失败时，调用此接口重新根据当前配置生成索引，无需重新分析视频。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string', description: '视频 ID' },
        },
      },
      response: {
        200: Schemas.SuccessMessage,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    // 1. 验证视频是否存在并获取基础信息
    const video = await prisma.video.findUnique({
      where: { videoId },
      include: { subtitles: { orderBy: { sortOrder: 'asc' } } }
    });

    if (!video) return reply.status(404).send({ error: '视频不存在' });

    // 2. 将耗时的向量生成过程转入后台任务，立即返回响应
    const backgroundReindex = async () => {
      try {
        const { getEmbedding, getEmbeddings } = await import('../services/ai.js');
        console.log(`[Re-index] Starting background indexing for ${videoId}...`);

        // A. 标题向量 (原文 & 译文)
        const titleEmbedding = await getEmbedding(video.title || '');
        await prisma.$executeRawUnsafe(
          `UPDATE videos SET "embedding" = $1::vector WHERE video_id = $2`,
          `[${titleEmbedding.join(',')}]`,
          videoId
        );

        // 如果已经有译文，也重构译文向量
        const hasChinese = /[\u4e00-\u9fa5]/.test(video.title || '');
        if (!hasChinese) {
           // 简单探测是否需要重新生成译文向量（暂时先重构原文，译文逻辑通常随翻译流程走）
        }

        // B. 批量处理字幕向量 (每批 50 条)
        const BATCH_SIZE = 50;
        const totalSegments = video.subtitles.length;

        for (let i = 0; i < totalSegments; i += BATCH_SIZE) {
          const batch = video.subtitles.slice(i, i + BATCH_SIZE);

          // 原文向量
          const batchTexts = batch.map(s => s.text);
          const embeddings = await getEmbeddings(batchTexts);

          for (let j = 0; j < batch.length; j++) {
            const vec = embeddings[j];
            const sortOrder = batch[j].sortOrder;
            await prisma.$executeRawUnsafe(
              `UPDATE subtitles SET "embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
              `[${vec.join(',')}]`,
              videoId,
              sortOrder
            );
          }

          // 译文向量 (如果有)
          const batchTransTexts = batch.map(s => s.translatedText).filter((t): t is string => !!t);
          if (batchTransTexts.length > 0) {
            const transEmbeddings = await getEmbeddings(batchTransTexts);
            let transIdx = 0;
            for (let j = 0; j < batch.length; j++) {
              if (batch[j].translatedText) {
                const vec = transEmbeddings[transIdx++];
                const sortOrder = batch[j].sortOrder;
                await prisma.$executeRawUnsafe(
                  `UPDATE subtitles SET "translated_embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
                  `[${vec.join(',')}]`,
                  videoId,
                  sortOrder
                );
              }
            }
          }
          console.log(`[Re-index] Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalSegments / BATCH_SIZE)} for ${videoId}`);
        }

        console.log(`[Re-index] Successfully completed background indexing for ${videoId}`);
      } catch (err: any) {
        console.error(`[Re-index Failed] ${videoId}:`, err);
      }
    };

    // 触发后台任务
    backgroundReindex();

    return reply.send({
      success: true,
      message: '语义索引重构已在后台启动，您可以继续浏览其他页面'
    });
  });

  /**
   * GET /api/videos/search
   * 全局语义搜索记录
   */
  fastify.get('/api/videos/search', {
    schema: {
      tags: ['Videos'],
      summary: '全局语义搜索',
      description: '基于向量相似度，在所有已索引的视频及其字幕内容中进行语义检索。',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: '搜索关键词或描述' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: { q: string; page?: number; limit?: number } }>, reply) => {
    const { q, page = 1, limit = 20 } = request.query;
    const { getEmbedding } = await import('../services/ai.js');
    const offset = (page - 1) * limit;

    try {
      const queryVector = await getEmbedding(q);
      const vectorStr = `[${queryVector.join(',')}]`;
      const threshold = 0.35; // Base threshold
      const isPlainNumber = /^\d+$/.test(q);

      // 使用原生 SQL 进行跨表向量搜索并去重
      const [results, totalResult] = await Promise.all([
        prisma.$queryRaw<any[]>`
          WITH all_raw_matches AS (
            SELECT
              v.video_id,
              v.title,
              v.platform,
              v.duration,
              v.category,
              v.tags,
              v.url,
              'title' as match_type,
              v.title as matched_text,
              0 as match_offset,
              GREATEST(
                COALESCE(1 - (v.embedding <=> ${vectorStr}::vector), 0),
                COALESCE(1 - (v.translated_embedding <=> ${vectorStr}::vector), 0)
              ) as base_score
            FROM videos v
            WHERE v.embedding IS NOT NULL OR v.translated_embedding IS NOT NULL

            UNION ALL

            SELECT
              v.video_id,
              v.title,
              v.platform,
              v.duration,
              v.category,
              v.tags,
              v.url,
              'subtitle' as match_type,
              COALESCE(s.translated_text, s.text) as matched_text,
              s.offset as match_offset,
              GREATEST(
                COALESCE(1 - (s.embedding <=> ${vectorStr}::vector), 0),
                COALESCE(1 - (s.translated_embedding <=> ${vectorStr}::vector), 0)
              ) as base_score
            FROM subtitles s
            JOIN videos v ON s.video_id = v.video_id
            WHERE s.embedding IS NOT NULL OR s.translated_embedding IS NOT NULL
              -- 排除短噪音
              AND LENGTH(COALESCE(s.translated_text, s.text)) >= 2
          ),
          scored_matches AS (
            SELECT
              *,
              LEAST(1.0, (
                CASE
                  WHEN ${isPlainNumber} THEN (
                    CASE
                      WHEN matched_text ILIKE ${'%' + q + '%'} THEN base_score + 0.5
                      ELSE base_score * 0.4
                    END
                  )
                  ELSE (
                    base_score *
                    (CASE WHEN LENGTH(matched_text) <= 5 AND NOT (matched_text ILIKE ${'%' + q + '%'}) THEN 0.6 ELSE 1.0 END) +
                    (CASE WHEN matched_text ILIKE ${'%' + q + '%'} THEN 0.15 ELSE 0 END)
                  )
                END
              )) as score
            FROM all_raw_matches
          ),
          filtered_matches AS (
            SELECT * FROM scored_matches
            WHERE (
              (${isPlainNumber} AND (score >= 0.7 OR matched_text ILIKE ${'%' + q + '%'}))
              OR (NOT ${isPlainNumber} AND score >= ${threshold})
            )
          ),
          best_matches_per_video AS (
            SELECT DISTINCT ON (video_id) *
            FROM filtered_matches
            ORDER BY video_id, score DESC
          )
          SELECT * FROM best_matches_per_video
          ORDER BY (CASE WHEN matched_text ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END) DESC, score DESC
          OFFSET ${offset}
          LIMIT ${limit}
        `,
        prisma.$queryRaw<any[]>`
          WITH all_raw_matches AS (
            SELECT video_id, GREATEST(COALESCE(1 - (embedding <=> ${vectorStr}::vector), 0), COALESCE(1 - (translated_embedding <=> ${vectorStr}::vector), 0)) as score, title as text FROM videos
            UNION ALL
            SELECT video_id, GREATEST(COALESCE(1 - (embedding <=> ${vectorStr}::vector), 0), COALESCE(1 - (translated_embedding <=> ${vectorStr}::vector), 0)) as score, COALESCE(translated_text, text) as text FROM subtitles
          ),
          scored AS (
            SELECT video_id,
            LEAST(1.0, (
              CASE
                WHEN ${isPlainNumber} THEN (CASE WHEN text ILIKE ${'%' + q + '%'} THEN score + 0.5 ELSE score * 0.4 END)
                ELSE score
              END
            )) as final_score, text FROM all_raw_matches
          )
          SELECT COUNT(DISTINCT video_id)::integer as count FROM scored
          WHERE (
            (${isPlainNumber} AND (final_score >= 0.7 OR text ILIKE ${'%' + q + '%'}))
            OR (NOT ${isPlainNumber} AND final_score >= ${threshold})
          )
        `
      ]);

      const totalCount = totalResult[0]?.count || 0;
      const hasMore = offset + results.length < totalCount;

      return reply.send({
        success: true,
        data: results.map(r => ({
          videoId: r.video_id,
          title: r.title,
          platform: r.platform,
          duration: r.duration,
          category: r.category,
          tags: r.tags ? r.tags.split(',') : [],
          url: r.url,
          matchType: r.match_type,
          matchedText: r.matched_text,
          offset: Number(r.match_offset),
          score: Number(r.score)
        })),
        meta: {
          page,
          limit,
          totalCount,
          hasMore
        }
      });
    } catch (err: any) {
      fastify.log.error(`Semantic search failed: ${err.message}`);
      return reply.status(500).send({ error: '搜索服务异常' });
    }
  });

  /**
   * DELETE /api/videos/:videoId
   * 删除视频分析数据
   */
  fastify.delete('/api/videos/:videoId', {
    schema: {
      tags: ['Videos'],
      summary: '彻底删除视频数据',
      description: '从全局数据库中彻底删除视频记录及其所有的字幕、AI 分析要点以及所有效用户的历史记录。',
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
      await prisma.video.delete({
        where: { videoId },
      });

      fastify.log.info(`Deleted video globally: ${videoId}`);
      return reply.send({ success: true, message: '视频及相关所有数据已彻底删除' });
    } catch (error: any) {
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
   * POST /api/videos/:videoId/export/notion
   * 导出视频笔记到 Notion
   */
  fastify.post('/api/videos/:videoId/export/notion', {
    schema: {
      tags: ['Videos'],
      summary: '导出到 Notion',
      description: '将当前视频的分析结果（标题、URL、要点、脑图）导出到配置好的 Notion 数据库中。',
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
            message: { type: 'string' },
            url: { type: 'string', nullable: true },
          },
        },
        400: Schemas.ErrorResponse,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    try {
      const video = await prisma.video.findUnique({
        where: { videoId },
        include: {
          takeaways: { orderBy: { sortOrder: 'asc' } },
        },
      });

      if (!video) {
        return reply.status(404).send({ error: '视频不存在' });
      }

      const result = await exportToNotion({
        title: video.title || '无标题视频',
        url: video.url,
        takeaways: video.takeaways.map(t => ({
          title: t.title,
          summary: t.summary || '',
          timestamp: t.timestamp,
        })),
        mindmap: video.mindmap,
      });

      return reply.send({
        success: true,
        message: '已成功导出到 Notion',
        url: (result as any).url,
      });
    } catch (error: any) {
      request.log.error(`Notion export failed: ${error.message}`);
      return reply.status(500).send({
        error: '导出失败',
        message: error.message || '请检查 Notion API 配置 (NOTION_API_KEY & NOTION_DATABASE_ID)',
      });
    }
  });

  /**
   * POST /api/videos/:videoId/clip
   * 创建并导出视频切片
   */
  fastify.post('/api/videos/:videoId/clip', {
    schema: {
      tags: ['Videos'],
      summary: '生成视频切片',
      description: '根据起始时间和时长，生成视频片段并返回。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['start', 'duration'],
        properties: {
          start: { type: 'number', description: '起始秒数' },
          duration: { type: 'number', description: '持续秒数' },
          quality: {
            type: 'string',
            enum: ['1080', '1440', '2160', 'best'],
            default: '1080',
            description: '目标清晰度',
          },
          format: { type: 'string', default: 'mp4' },
          burnSubtitles: { type: 'boolean', default: false }
        }
      },
      response: {
        200: { type: 'string', format: 'binary' },
        400: Schemas.ErrorResponse,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { videoId: string }; Body: { start: number; duration: number; quality?: '1080' | '1440' | '2160' | 'best'; format?: string; burnSubtitles?: boolean } }>,
    reply: FastifyReply
  ) => {
    const { videoId } = request.params;
    const { start, duration, quality = '1080', format = 'mp4', burnSubtitles = false } = request.body;
    const video = await prisma.video.findUnique({ where: { videoId } });
    if (!video) return reply.status(404).send({ error: '视频不存在' });

    // 获取该时间段内的所有字幕片段
    const startMs = start * 1000;
    const endMs = (start + duration) * 1000;
    const subtitles = await prisma.subtitle.findMany({
      where: {
        videoId,
        offset: { gte: startMs - 2000, lte: endMs + 2000 } // 稍微扩大范围确保覆盖
      },
      orderBy: { sortOrder: 'asc' }
    });

    try {
      const subtitleSample = subtitles.slice(0, 20);
      const chineseSubtitleCount = subtitleSample.filter((s) => /[\u4e00-\u9fa5]/.test(s.text)).length;
      const isChinese = subtitleSample.length > 0
        ? chineseSubtitleCount >= Math.ceil(subtitleSample.length / 3)
        : /[\u4e00-\u9fa5]/.test(video.title || '');
      
      const preferredTranscript = await getPreferredTranscriptForVideo(prisma, videoId);
      const clipTranscript = preferredTranscript.filter((seg) =>
        seg.offset >= startMs - 2000 && seg.offset <= endMs + 2000
      );
      const cueCount = await prisma.subtitleCue.count({ where: { videoId } });

      const { createVideoClip } = await import('../services/clipping.js');
      const filePath = await createVideoClip({
        videoId,
        title: video.title || 'clip',
        url: video.url,
        start,
        duration,
        platform: video.platform,
        quality,
        language: isChinese ? 'zh' : undefined,
        format,
        burnSubtitles,
        subtitles: (clipTranscript.length > 0 ? clipTranscript : subtitles).map(s => ({
          text: s.text,
          translatedText: s.translatedText || undefined,
          offset: s.offset,
          duration: s.duration
        })),
        subtitlesAreCues: cueCount > 0,
      });

      // 提取文件名并进行 RFC 5987 编码以支持中文
      const fileName = path.basename(filePath);
      const encodedFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
      const stream = (await import('fs')).createReadStream(filePath);

      reply.header('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}`);
      return reply.send(stream);
    } catch (error: any) {
      fastify.log.error(`[Clipping Error] ${error.message}`);
      return reply.status(500).send({
        error: '视频切片生成失败',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/videos/:videoId/subtitles/:sortOrder
   * 手动更新/修复某一条字幕及翻译
   */
  fastify.put('/api/videos/:videoId/subtitles/:sortOrder', {
    schema: {
      tags: ['Videos'],
      summary: '手动修复字幕和翻译',
      description: '手动更新特定顺序的字幕原文或翻译内容，并自动重新生成该片段的向量索引。',
      params: {
        type: 'object',
        required: ['videoId', 'sortOrder'],
        properties: {
          videoId: { type: 'string' },
          sortOrder: { type: 'integer' }
        }
      },
      body: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          translatedText: { type: 'string' }
        }
      },
      response: {
        200: Schemas.SuccessMessage,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { videoId: string, sortOrder: number }; Body: { text?: string; translatedText?: string } }>,
    reply: FastifyReply
  ) => {
    const { videoId, sortOrder } = request.params;
    const { text, translatedText } = request.body;

    try {
      // 1. 获取旧数据确认存在
      const subtitle = await prisma.subtitle.findFirst({
        where: { videoId, sortOrder: Number(sortOrder) }
      });

      if (!subtitle) return reply.status(404).send({ error: '字幕片段不存在' });

      // 2. 更新数据库
      const updateData: any = {};
      if (text !== undefined) updateData.text = text;
      if (translatedText !== undefined) updateData.translatedText = translatedText;

      await prisma.subtitle.updateMany({
        where: { videoId, sortOrder: Number(sortOrder) },
        data: updateData
      });
      await rebuildSubtitleCuesForVideo(prisma, videoId);

      // 3. 异步重构向量（由于是单条，速度极快，不使用 backgroundTask 也可以，但为了接口性能还是异步）
      const reindexSingle = async () => {
        try {
          const { getEmbedding } = await import('../services/ai.js');
          if (text) {
             const vec = await getEmbedding(text);
             await prisma.$executeRawUnsafe(
               `UPDATE subtitles SET "embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
               `[${vec.join(',')}]`,
               videoId,
               Number(sortOrder)
             );
          }
          if (translatedText) {
             const transVec = await getEmbedding(translatedText);
             await prisma.$executeRawUnsafe(
               `UPDATE subtitles SET "translated_embedding" = $1::vector WHERE video_id = $2 AND "sort_order" = $3`,
               `[${transVec.join(',')}]`,
               videoId,
               Number(sortOrder)
             );
          }
        } catch (err) {
          console.error(`[Manual Re-index Failed] ${videoId}-${sortOrder}:`, err);
        }
      };
      
      reindexSingle();

      return reply.send({ success: true, message: '字幕已更新并重新索引' });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '更新失败', message: error.message });
    }
  });

  fastify.put('/api/videos/:videoId/subtitles', {
    schema: {
      tags: ['Videos'],
      summary: '修复展示字幕 cue',
      description: '仅更新展示/烧录使用的 cue override，不修改原始字幕。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          cueSortOrder: { type: 'integer' },
          sourceSortOrders: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
          },
          text: { type: 'string' },
          translatedText: { type: 'string' }
        }
      },
      response: {
        200: Schemas.SuccessMessage,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { videoId: string }; Body: { cueSortOrder?: number; sourceSortOrders?: number[]; text?: string; translatedText?: string } }>,
    reply: FastifyReply
  ) => {
    const { videoId } = request.params;
    const { cueSortOrder, sourceSortOrders = [], text, translatedText } = request.body;

    const normalizedSortOrders = Array.from(new Set(sourceSortOrders.map((value) => Number(value)).filter(Number.isInteger))).sort((a, b) => a - b);
    const targetCueSortOrder = Number.isInteger(Number(cueSortOrder))
      ? Number(cueSortOrder)
      : normalizedSortOrders[0];

    if (!Number.isInteger(targetCueSortOrder)) {
      return reply.status(404).send({ error: '字幕片段不存在' });
    }

    try {
      const cue = await prisma.subtitleCue.findFirst({
        where: { videoId, sortOrder: targetCueSortOrder },
      });

      if (!cue) {
        return reply.status(404).send({ error: '字幕片段不存在' });
      }

      const updateData: Record<string, string | null> = {};
      if (text !== undefined) {
        updateData.text = text;
        updateData.overrideText = text;
      }
      if (translatedText !== undefined) {
        updateData.translatedText = translatedText;
        updateData.overrideTranslatedText = translatedText;
      }

      await prisma.subtitleCue.updateMany({
        where: { videoId, sortOrder: targetCueSortOrder },
        data: updateData,
      });

      return reply.send({ success: true, message: '字幕 cue 已更新' });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '更新失败', message: error.message });
    }
  });

  fastify.post('/api/videos/:videoId/rebuild-cues', {
    schema: {
      tags: ['Videos'],
      summary: '重建视频字幕 cues',
      description: '根据当前原始字幕重建展示/烧录使用的 cues，并自动补齐缺失的展示翻译。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      response: {
        200: Schemas.SuccessMessage,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply
  ) => {
    const { videoId } = request.params;

    try {
      const video = await prisma.video.findUnique({
        where: { videoId },
        select: { videoId: true },
      });

      if (!video) {
        return reply.status(404).send({ error: '视频不存在' });
      }

      await rebuildSubtitleCuesForVideo(prisma, videoId);
      const translatedCount = await retranslateCueSegmentsForVideo(videoId);
      return reply.send({
        success: true,
        message: translatedCount > 0
          ? `字幕 cues 已重建，并补齐了 ${translatedCount} 条展示翻译`
          : '字幕 cues 已重建',
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '重建失败', message: error.message });
    }
  });

  fastify.post('/api/videos/:videoId/retranslate-cues', {
    schema: {
      tags: ['Videos'],
      summary: '仅重翻译展示字幕 cues',
      description: '基于当前字幕重建 cues，并仅重新翻译展示用的 cue，不重新抓取字幕，也不重新生成摘要/脑图。',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: {
          videoId: { type: 'string' }
        }
      },
      response: {
        200: Schemas.SuccessMessage,
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      }
    }
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply
  ) => {
    const { videoId } = request.params;

    try {
      const video = await prisma.video.findUnique({
        where: { videoId },
        select: { videoId: true },
      });

      if (!video) {
        return reply.status(404).send({ error: '视频不存在' });
      }

      await rebuildSubtitleCuesForVideo(prisma, videoId);
      const translatedCount = await retranslateCueSegmentsForVideo(videoId);
      return reply.send({
        success: true,
        message: translatedCount > 0 ? `字幕 cues 已重新翻译 ${translatedCount} 条` : '字幕 cues 已重新翻译',
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '重翻译失败', message: error.message });
    }
  });

  /**
   * POST /api/videos/:videoId/regenerate-channels
   * 重新生成视频号发布辅助文案
   */
  fastify.post('/api/videos/:videoId/regenerate-channels', {
    schema: {
      tags: ['Videos'],
      summary: '重新生成视频号发布文案',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: { videoId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                videoDescription: { type: 'string', nullable: true },
                videoHashtags: { type: 'string', nullable: true },
              },
            },
          },
        },
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    const video = await prisma.video.findUnique({
      where: { videoId },
      include: { subtitles: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!video) return reply.status(404).send({ error: '视频不存在' });
    if (!video.subtitles.length) return reply.status(400).send({ error: '视频无字幕数据' });

    try {
      const { formatTranscriptForAI } = await import('../services/transcript.js');
      const formattedText = formatTranscriptForAI(
        video.subtitles.map(s => ({ text: s.text, offset: s.offset, duration: s.duration }))
      );

      const result = await generatePublishAssist(formattedText);

      await prisma.video.update({
        where: { videoId },
        data: {
          videoDescription: result.videoDescription,
          videoHashtags: result.videoHashtags,
          keywordGlossary: (result.keywordGlossary || []) as unknown as Prisma.InputJsonValue,
        },
      });

      return reply.send({
        success: true,
        data: {
          videoDescription: result.videoDescription,
          videoHashtags: result.videoHashtags,
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '重新生成视频号文案失败', message: error.message });
    }
  });

  /**
   * POST /api/videos/:videoId/regenerate-summary
   * 重新生成核心摘要
   */
  fastify.post('/api/videos/:videoId/regenerate-summary', {
    schema: {
      tags: ['Videos'],
      summary: '重新生成核心摘要',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: { videoId: { type: 'string' } },
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
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    const video = await prisma.video.findUnique({
      where: { videoId },
      include: { subtitles: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!video) return reply.status(404).send({ error: '视频不存在' });
    if (!video.subtitles.length) return reply.status(400).send({ error: '视频无字幕数据' });

    try {
      const { formatTranscriptForAI } = await import('../services/transcript.js');
      const transcript = video.subtitles.map((s) => ({
        text: s.text,
        offset: s.offset,
        duration: s.duration,
      }));
      const formattedText = formatTranscriptForAI(transcript);
      const lastSegment = transcript[transcript.length - 1];
      const maxDurationSeconds = lastSegment
        ? Math.ceil((lastSegment.offset + lastSegment.duration) / 1000)
        : 0;
      const result = await analyzeTranscriptSummary(formattedText, maxDurationSeconds);

      await prisma.video.update({
        where: { videoId },
        data: {
          title: result.title,
          category: result.category,
          tags: Array.isArray(result.tags) ? result.tags.join(',') : '',
          duration: maxDurationSeconds,
        },
      });

      const newTitleEmbedding = await getEmbedding(result.title);
      await prisma.$executeRawUnsafe(
        `UPDATE videos SET "embedding" = $1::vector WHERE video_id = $2`,
        `[${newTitleEmbedding.join(',')}]`,
        videoId
      );

      await prisma.takeaway.deleteMany({ where: { videoId } });
      await prisma.takeaway.createMany({
        data: result.takeaways.map((t, i) => ({
          videoId,
          title: t.title,
          summary: t.summary,
          timestamp: t.timestamp,
          duration: t.duration,
          sortOrder: i,
        })),
      });

      return reply.send({
        success: true,
        data: {
          videoTitle: result.title,
          takeaways: result.takeaways.map((t, index) => ({
            id: `regen-${videoId}-${index}`,
            title: t.title,
            summary: t.summary,
            timestamp: t.timestamp,
            duration: t.duration,
          })),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '重新生成核心摘要失败', message: error.message });
    }
  });

  /**
   * POST /api/videos/:videoId/regenerate-redbook
   * 重新生成小红书发布辅助文案
   */
  fastify.post('/api/videos/:videoId/regenerate-redbook', {
    schema: {
      tags: ['Videos'],
      summary: '重新生成小红书发布文案',
      params: {
        type: 'object',
        required: ['videoId'],
        properties: { videoId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                redbookTitle: { type: 'string', nullable: true },
                redbookDescription: { type: 'string', nullable: true },
                redbookHashtags: { type: 'string', nullable: true },
              },
            },
          },
        },
        404: Schemas.ErrorResponse,
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;

    const video = await prisma.video.findUnique({
      where: { videoId },
      include: { subtitles: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!video) return reply.status(404).send({ error: '视频不存在' });
    if (!video.subtitles.length) return reply.status(400).send({ error: '视频无字幕数据' });

    try {
      const { formatTranscriptForAI } = await import('../services/transcript.js');
      const formattedText = formatTranscriptForAI(
        video.subtitles.map(s => ({ text: s.text, offset: s.offset, duration: s.duration }))
      );

      const result = await generateRedbookAssist(formattedText);

      await prisma.video.update({
        where: { videoId },
        data: {
          redbookTitle: result.redbookTitle,
          redbookDescription: result.redbookDescription,
          redbookHashtags: result.redbookHashtags,
        },
      });

      return reply.send({
        success: true,
        data: {
          redbookTitle: result.redbookTitle,
          redbookDescription: result.redbookDescription,
          redbookHashtags: result.redbookHashtags,
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: '重新生成小红书文案失败', message: error.message });
    }
  });
}
