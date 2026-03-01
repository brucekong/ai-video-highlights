import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { getEmbedding } from '../services/ai.js';

export async function searchRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/search
   * 语义搜索视频内容
   */
  fastify.get('/api/search', {
    schema: {
      tags: ['Search'],
      summary: '全库语义搜索',
      description: '输入自然语言描述，AI 会在所有已分析视频的字幕中进行向量相似度检索并返回片段。',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: '搜索关键词或语义描述' },
          limit: { type: 'integer', default: 10, description: '返回结果数量' },
        },
      },
    },
  }, async (
    request: FastifyRequest<{ Querystring: { q: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    const { q, limit = 10 } = request.query;

    try {
      // 1. 生成查询语义向量
      const queryEmbedding = await getEmbedding(q);
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      // 2. 向量检索：使用余弦相似度的距离运算符 <=>
      // 相似度得分 = 1 - 距离
      const results: any[] = await prisma.$queryRaw`
        SELECT
           s.video_id AS "videoId",
           v.title AS "videoTitle",
           s.text AS "text",
           s.translated_text AS "translatedText",
           s."offset" AS "offset",
           (1 - (s.embedding <=> ${vectorStr}::vector)) AS "similarity"
        FROM subtitles s
        JOIN videos v ON s.video_id = v.video_id
        WHERE s.embedding IS NOT NULL
        ORDER BY similarity DESC
        LIMIT ${limit}
      `;

      return reply.send({
        success: true,
        data: results.map(r => ({
          ...r,
          similarity: Number(r.similarity),
        })),
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Semantic search failed.',
        message: error.message,
      });
    }
  });
}
