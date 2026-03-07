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
      const queryEmbedding = await getEmbedding(q);
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const threshold = Number(min_score);
      const isShortQuery = q.length <= 3;
      const isPlainNumber = /^\d+$/.test(q); // 是否是纯数字查询，如 "12"

      const query = Prisma.sql`
        WITH matches AS (
          -- 视频标题匹配
          SELECT
            v.video_id AS "videoId",
            v.title AS "videoTitle",
            v.title AS "text",
            NULL AS "translatedText",
            0 AS "offset",
            v.duration AS "duration",
            'title' AS "matchType",
            GREATEST(
              COALESCE(1 - (v.embedding <=> ${vectorStr}::vector), 0),
              COALESCE(1 - (v.translated_embedding <=> ${vectorStr}::vector), 0)
            ) AS "base_similarity"
          FROM videos v
          WHERE (v.embedding IS NOT NULL OR v.translated_embedding IS NOT NULL)
            ${videoId ? Prisma.sql`AND v.video_id = ${videoId}` : Prisma.empty}

          UNION ALL

          -- 字幕内容匹配
          SELECT
            s.video_id AS "videoId",
            v.title AS "videoTitle",
            s.text AS "text",
            s.translated_text AS "translatedText",
            s."offset" AS "offset",
            v.duration AS "duration",
            'subtitle' AS "matchType",
            GREATEST(
              COALESCE(1 - (s.embedding <=> ${vectorStr}::vector), 0),
              COALESCE(1 - (s.translated_embedding <=> ${vectorStr}::vector), 0)
            ) AS "base_similarity"
          FROM subtitles s
          JOIN videos v ON s.video_id = v.video_id
          WHERE (s.embedding IS NOT NULL OR s.translated_embedding IS NOT NULL)
            ${videoId ? Prisma.sql`AND s.video_id = ${videoId}` : Prisma.empty}
            -- 即使是字幕匹配，也要排除极端短句噪音
            AND LENGTH(COALESCE(s.translated_text, s.text)) >= 2
        ),
        scored_matches AS (
          SELECT
            *,
            LEAST(1.0, (
              -- 针对数字类查询，极大提高文本匹配的权重。
              CASE
                WHEN ${isPlainNumber} THEN (
                  CASE
                    WHEN text ILIKE ${'%' + q + '%'} THEN base_similarity + 0.5
                    ELSE base_similarity * 0.4 -- 非数字包含的内容，分数大幅折损
                  END
                )
                ELSE (
                   base_similarity *
                   -- 长度惩罚：短句如果没有精确匹配，降权
                   (CASE
                      WHEN LENGTH(text) <= 5 AND NOT (text ILIKE ${'%' + q + '%'}) THEN 0.6
                      ELSE 1.0
                   END) +
                   -- 普通文本精确匹配加分
                   (CASE
                      WHEN text ILIKE ${q} THEN 0.3
                      WHEN text ILIKE ${'%' + q + '%'} THEN 0.1
                      ELSE 0
                   END)
                )
              END
            )) AS "similarity"
          FROM matches
        )
        SELECT * FROM scored_matches
        WHERE (
          -- 针对数字查询，如果没有精确包含，则相似度必须极高（防止干扰）
          (${isPlainNumber} AND ("similarity" >= 0.7 OR text ILIKE ${'%' + q + '%'}))
          OR (NOT ${isPlainNumber} AND "similarity" >= ${threshold})
        )
        ORDER BY
          (CASE WHEN text ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END) DESC,
          "similarity" DESC
        LIMIT ${limit}
      `;

      const results: any[] = await prisma.$queryRaw(query);

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
