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

      // 拆分关键词以进行多词匹配奖励（特别是技术术语）
      const words = q.split(/\s+/).filter(w => w.length > 1);

      const results: any[] = await prisma.$queryRaw`
        SELECT
           s.video_id AS "videoId",
           v.title AS "videoTitle",
           s.text AS "text",
           s.translated_text AS "translatedText",
           s."offset" AS "offset",
           LEAST(1.0,
             GREATEST(
               COALESCE(1 - (s.embedding <=> ${vectorStr}::vector), 0),
               COALESCE(1 - (s.translated_embedding <=> ${vectorStr}::vector), 0)
             ) +
             -- 精确或包含匹配奖励 (最高 0.3)
             (CASE
                WHEN s.text ILIKE ${q} OR s.translated_text ILIKE ${q} THEN 0.3
                WHEN s.text ILIKE ${'%' + q + '%'} OR s.translated_text ILIKE ${'%' + q + '%'} THEN 0.15
                -- 单词点击奖励（处理中英文混合匹配，如 "json mode" 匹配 "JSON 模式" 中的 "JSON"）
                ELSE LEAST(0.14, (
                  ${words.length > 0 ? words.map(w => Prisma.sql`(CASE WHEN s.text ILIKE ${'%' + w + '%'} OR s.translated_text ILIKE ${'%' + w + '%'} THEN 0.05 ELSE 0 END)`).reduce((a, b) => Prisma.sql`${a} + ${b}`) : Prisma.sql`0`}
                ))
              END)
           ) AS "similarity"
        FROM subtitles s
        JOIN videos v ON s.video_id = v.video_id
        WHERE (s.embedding IS NOT NULL OR s.translated_embedding IS NOT NULL)
          AND (
            GREATEST(
              COALESCE(1 - (s.embedding <=> ${vectorStr}::vector), 0),
              COALESCE(1 - (s.translated_embedding <=> ${vectorStr}::vector), 0)
            ) +
            (CASE
               WHEN s.text ILIKE ${q} OR s.translated_text ILIKE ${q} THEN 0.3
               WHEN s.text ILIKE ${'%' + q + '%'} OR s.translated_text ILIKE ${'%' + q + '%'} THEN 0.15
               ELSE LEAST(0.14, (
                 ${words.length > 0 ? words.map(w => Prisma.sql`(CASE WHEN s.text ILIKE ${'%' + w + '%'} OR s.translated_text ILIKE ${'%' + w + '%'} THEN 0.05 ELSE 0 END)`).reduce((a, b) => Prisma.sql`${a} + ${b}`) : Prisma.sql`0`}
               ))
             END)
          ) > ${Number(min_score)}
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
