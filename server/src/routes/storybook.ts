import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import prisma from '../lib/prisma.js';
import { buildStorybookDraft } from '../features/storybook/service.js';

export async function storybookRoutes(fastify: FastifyInstance) {
  fastify.get('/api/storybooks/:videoId/draft', {
    schema: {
      tags: ['Storybook'],
      summary: '生成视频画册草稿',
      description: '基于当前视频已有的字幕 cues，返回一个只读的画册页草稿结构。',
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
              additionalProperties: true,
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const draft = await buildStorybookDraft(prisma, videoId);

    if (!draft) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    return reply.send({
      success: true,
      data: draft,
    });
  });
}
