import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma, { Prisma } from '../lib/prisma.js';
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
      description: '输入自然语言描述，AI 会在所有已分析视频的字幕中进行向量相似度检索并返回片段。支持筛选特定视频。',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: '搜索关键词或语义描述' },
          videoId: { type: 'string', description: '（可选）限定搜索的视频 ID' },
          limit: { type: 'integer', default: 10, description: '返回结果数量' },
          min_score: { type: 'number', default: 0.5, description: '相似度阈值' },
        },
      },
    },
  }, async (
    request: FastifyRequest<{ Querystring: { q: string; videoId?: string; limit?: number; min_score?: number } }>,
    reply: FastifyReply,
  ) => {
    const { q, videoId, limit = 10, min_score = 0.5 } = request.query;

    try {
      // 1. 生成查询语义向量
      const queryEmbedding = await getEmbedding(q);
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      // 2. 向量检索：使用余弦相似度的距离运算符 <=>
      // 相似度得分 = 1 - 距离
      // 增加 min_score 过滤，剔除相关性极低的结果
      // 如果指定了 videoId，则增加 video_id 过滤
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
          AND (1 - (s.embedding <=> ${vectorStr}::vector)) > ${Number(min_score)}
          ${videoId ? Prisma.sql`AND s.video_id = ${videoId}` : Prisma.empty}
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
