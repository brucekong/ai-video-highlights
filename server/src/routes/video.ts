import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma, { Prisma } from '../lib/prisma.js';
import { Schemas } from '../docs/openapi.js';
import { getUserId } from '../utils/auth.js';

export async function videoRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/videos
   * 获取分析过的视频列表。如果用户已登录，获取该用户的历史记录；否则返回空。
   */
  fastify.get('/api/videos', {
    schema: {
      tags: ['Videos'],
      summary: '获取视频列表',
      description: '获取已分析的视频列表。如果用户已登录（携带 Bearer Token），返回该用户的历史记录（最多50条）。',
      security: [{ bearerAuth: [] }],
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
        }))
      });
    }

    return reply.send({
      success: true,
      data: [],
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
      },
    });

    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    return reply.send({
      success: true,
      data: {
        videoTitle: video.title,
        mindmap: video.mindmap,
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
    const { getEmbedding, getEmbeddings } = await import('../services/ai.js');

    try {
      // 1. 获取现有视频和字幕
      const video = await prisma.video.findUnique({
        where: { videoId },
        include: { subtitles: { orderBy: { sortOrder: 'asc' } } }
      });

      if (!video) return reply.status(404).send({ error: '视频不存在' });

      // 2. 生成标题向量
      const titleEmbedding = await getEmbedding(video.title || '');
      await prisma.$executeRaw`UPDATE videos SET embedding = ${`[${titleEmbedding.join(',')}]`}::vector WHERE video_id = ${videoId}`;

      // 3. 批量生成字幕向量
      const subtitleTexts = video.subtitles.map(s => s.translatedText || s.text);
      if (subtitleTexts.length > 0) {
        const embeddings = await getEmbeddings(subtitleTexts);

        // 逐个更新（由于 $executeRaw 的限制，批量更新较为复杂）
        await Promise.all(embeddings.map((vec, idx) => {
          const vectorStr = `[${vec.join(',')}]`;
          const offset = video.subtitles[idx].offset;
          return prisma.$executeRaw`UPDATE subtitles SET embedding = ${vectorStr}::vector WHERE video_id = ${videoId} AND "offset" = ${offset}`;
        }));
      }

      return reply.send({ success: true, message: '语义索引重构完成' });
    } catch (error: any) {
      fastify.log.error(`Re-embed failed: ${error.message}`);
      return reply.status(500).send({
        error: '重构索引失败',
        message: error.message,
      });
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
}
