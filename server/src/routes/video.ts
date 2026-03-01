import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
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
