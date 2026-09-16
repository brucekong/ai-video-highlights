import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { runPiVideoAgent, getSupportedAgentModels, type PiAgentActionEvent } from '../services/piAgent.js';
import { getUserId } from '../utils/auth.js';

export async function chatRoutes(fastify: FastifyInstance) {
  // 获取支持的模型列表
  fastify.get('/api/chat/models', async (_request, reply: FastifyReply) => {
    return reply.send({
      success: true,
      data: getSupportedAgentModels(),
      defaultModelKey: 'deepseek:deepseek-chat',
    });
  });

  fastify.post('/api/chat/stream', async (
    request: FastifyRequest<{ Body: { videoId: string; message: string; modelKey?: string; currentPlayTime?: number } }>,
    reply: FastifyReply
  ) => {
    const { videoId, message, modelKey, currentPlayTime } = request.body;
    const userId = getUserId(request);

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (!videoId || !message) {
      return reply.status(400).send({ error: 'Missing videoId or message' });
    }

    // 1. 获取视频字幕作为上下文
    const subtitles = await prisma.subtitle.findMany({
      where: { videoId },
      orderBy: { sortOrder: 'asc' },
      select: { text: true, offset: true },
    });

    if (!subtitles || subtitles.length === 0) {
      return reply.status(404).send({ error: 'Transcript not found for this video' });
    }

    // 2. 获取历史聊天记录（最近 10 条）
    const history = await prisma.chatMessage.findMany({
      where: { videoId, userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const formattedHistory = history.reverse().map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));

    // 3. 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    let fullAssistantResponse = '';
    const executedActions: PiAgentActionEvent[] = [];

    try {
      // 4. 开始 Pi Agent 分析流
      fullAssistantResponse = await runPiVideoAgent({
        videoId,
        transcriptItems: subtitles,
        userMessage: message,
        modelKey,
        currentPlayTime,
        history: formattedHistory,
        onText: (chunk) => {
          reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
        },
        onAction: (action) => {
          executedActions.push(action);
          reply.raw.write(`data: ${JSON.stringify({ type: 'action', action })}\n\n`);
        },
        onStatus: (status) => {
          reply.raw.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
        },
      });

      // 5. 保存对话记录到数据库（仅当存在有效回复时）
      if (fullAssistantResponse && fullAssistantResponse.trim()) {
        await prisma.$transaction([
          prisma.chatMessage.create({
            data: {
              videoId,
              userId,
              role: 'user',
              content: message,
            },
          }),
          prisma.chatMessage.create({
            data: {
              videoId,
              userId,
              role: 'assistant',
              content: fullAssistantResponse,
            },
          }),
        ]);
      }

      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (error: any) {
      fastify.log.error(`Chat stream error: ${error.message}`);
      reply.raw.write(`data: ${JSON.stringify({ error: error.message || 'Chat failed' })}\n\n`);
      reply.raw.end();
    }
  });

  // 获取历史聊天记录接口
  fastify.get('/api/chat/history/:videoId', async (
    request: FastifyRequest<{ Params: { videoId: string } }>,
    reply: FastifyReply
  ) => {
    const { videoId } = request.params;
    const userId = getUserId(request);

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { videoId, userId },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({
      success: true,
      data: messages.map(m => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  });
}
