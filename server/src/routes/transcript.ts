import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { fetchTranscript, type TranscriptSegment } from '../services/transcript.js';
import { fetchBilibiliTranscript } from '../services/bilibili.js';
import { fallbackToWhisper } from '../services/whisper.js';
import { Schemas } from '../docs/openapi.js';

interface TranscriptParams {
  videoId: string;
}

export async function transcriptRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/transcript/:videoId
   * 仅获取视频字幕，不做 AI 分析
   */
  fastify.get('/api/transcript/:videoId', {
    schema: {
      tags: ['Transcript'],
      summary: '获取视频字幕',
      description: '仅获取视频字幕。优先从数据库缓存读取，缓存未命中时从平台实时获取并保存到数据库。',
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
          platform: { type: 'string', enum: ['youtube', 'bilibili'], default: 'youtube', description: '视频平台' },
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
                videoId: { type: 'string' },
                segmentCount: { type: 'integer' },
                segments: {
                  type: 'array',
                  items: Schemas.TranscriptSegment,
                },
              },
            },
          },
        },
        500: Schemas.ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{ Params: TranscriptParams, Querystring: { platform?: string } }>,
    reply: FastifyReply,
  ) => {
    const { videoId } = request.params;
    const platform = request.query.platform || 'youtube';

    try {
      // 1. 先查数据库缓存
      const cachedSubtitles = await prisma.subtitle.findMany({
        where: { videoId },
        orderBy: { sortOrder: 'asc' },
      });

      if (cachedSubtitles.length > 0) {
        return reply.send({
          success: true,
          cached: true,
          data: {
            videoId,
            segmentCount: cachedSubtitles.length,
            segments: cachedSubtitles.map((s) => ({
              text: s.text,
              translatedText: s.translatedText,
              offset: s.offset,
              duration: s.duration,
            })),
          },
        });
      }

      // 2. 缓存未命中，从平台获取
      let transcript: TranscriptSegment[] = [];
      try {
        transcript = platform === 'bilibili'
          ? await fetchBilibiliTranscript(videoId)
          : await fetchTranscript(videoId);
      } catch (e: any) {
        fastify.log.warn(`Transcript fetch failed: ${e.message}. Attempting Whisper fallback...`);
      }

      // 3. 兜底方案
      if (!transcript || transcript.length === 0) {
        try {
          transcript = await fallbackToWhisper(videoId, platform as 'youtube' | 'bilibili');
        } catch (fbError: any) {
          fastify.log.error(`Whisper Fallback Failed: ${fbError.message}`);
        }
      }

      if (!transcript || transcript.length === 0) {
        return reply.status(422).send({
          error: 'No transcript available for this video.',
        });
      }

      // 4. 保存到数据库 (确保 Video 存在)
      await prisma.video.upsert({
        where: { videoId },
        create: { videoId, url: '', platform },
        update: { platform },
      });

      await prisma.subtitle.deleteMany({ where: { videoId } });
      await prisma.subtitle.createMany({
        data: transcript.map((seg, index) => ({
          videoId,
          text: seg.text,
          offset: seg.offset,
          duration: seg.duration,
          sortOrder: index,
        })),
      });

      return reply.send({
        success: true,
        cached: false,
        data: {
          videoId,
          segmentCount: transcript.length,
          segments: transcript.map((seg) => ({
            text: seg.text,
            translatedText: null, // 新生成的此时还没翻译
            offset: seg.offset,
            duration: seg.duration,
          })),
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Failed to fetch transcript.',
        message: error.message,
      });
    }
  });
}
