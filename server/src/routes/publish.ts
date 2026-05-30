import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { getBridgeClient } from '../services/bridge.js';
import { Publisher } from '../services/publisher.js';
import { getTemplate, listTemplates, type PublishContext } from '../templates/index.js';
import { cleanWxVideoTitle } from '../templates/wxvideo.js';

const prisma = new PrismaClient();

const ASSET_STORE_ROOT = process.env.ASSET_STORE_ROOT
  || path.join(process.env.HOME || '/tmp', 'PublishAssets');

/** Resolve asset path: if relative, prepend store root; if absolute, use as-is */
function resolveAssetPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(ASSET_STORE_ROOT, filePath);
}

export async function publishRoutes(app: FastifyInstance) {
  // List publish tasks
  app.get('/api/publish/tasks', async (request) => {
    const { status, assetId, page = 1, limit = 20 } = request.query as {
      status?: string;
      assetId?: string;
      page?: number;
      limit?: number;
    };

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (assetId) where.assetId = assetId;

    const [tasks, total] = await Promise.all([
      prisma.publishTask.findMany({
        where,
        include: { asset: true },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.publishTask.count({ where }),
    ]);

    return { tasks, total, page: Number(page), limit: Number(limit) };
  });

  // Create publish task
  app.post('/api/publish/tasks', async (request, reply) => {
    const body = request.body as {
      assetId: string;
      platform: string;
      platformTitle?: string;
      platformDesc?: string;
      publishMode?: 'draft' | 'publish';
    };

    const asset = await prisma.publishAsset.findUnique({ where: { id: body.assetId } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const template = getTemplate(body.platform);
    if (!template) return reply.status(400).send({ error: `Unsupported platform: ${body.platform}` });

    const task = await prisma.publishTask.create({
      data: {
        assetId: body.assetId,
        platform: body.platform,
        platformTitle: body.platformTitle,
        platformDesc: body.platformDesc,
        publishMode: body.publishMode ?? 'draft',
      },
    });

    return task;
  });

  // Execute a publish task
  app.post('/api/publish/tasks/:id/run', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await prisma.publishTask.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status === 'running') return reply.status(409).send({ error: 'Task already running' });

    // Update status
    await prisma.publishTask.update({ where: { id }, data: { status: 'running' } });

    const publishMode = (task.publishMode as 'draft' | 'publish') ?? 'draft';

    const ctx: PublishContext = {
      title: task.asset.title,
      description: task.asset.description ?? undefined,
      hashtags: task.asset.hashtags ?? undefined,
      videoFilePath: resolveAssetPath(task.asset.videoFilePath),
      cover43FilePath: task.asset.cover43Path ? resolveAssetPath(task.asset.cover43Path) : undefined,
      cover34FilePath: task.asset.cover34Path ? resolveAssetPath(task.asset.cover34Path) : undefined,
      platformTitle: task.platformTitle ?? undefined,
      platformDesc: task.platformDesc ?? undefined,
      publishMode,
    };

    // Apply platform-specific title/text cleaning
    if (task.platform === 'wxvideo') {
      ctx._platformCleaner = (text: string, selector: string) => {
        // Clean title field only (short title has character restrictions)
        if (selector.includes('短标题') || selector.includes('placeholder')) {
          return cleanWxVideoTitle(text);
        }
        return text;
      };
    }

    const publisher = new Publisher(undefined, async (taskId, step, total, action) => {
      // Update progress info so frontend can poll it
      const progress = `${step}/${total}: ${action}`;
      console.log(`[Publish] ${taskId} ${progress}`);
      await prisma.publishTask.update({
        where: { id: taskId },
        data: { errorMessage: progress },
      }).catch(() => {});
    });

    // Determine final status based on publishMode
    const successStatus = publishMode === 'publish' ? 'published' : 'draft_saved';

    // Execute async - return immediately
    publisher.execute({ taskId: id, platform: task.platform, context: ctx }).then(async (result) => {
      console.log(`[Publish] Task ${id} result:`, result.success ? 'SUCCESS' : `FAILED: ${result.error}`);
      if (result.success) {
        await prisma.publishTask.update({
          where: { id },
          data: { status: successStatus, publishedAt: new Date(), errorMessage: null },
        });
        await prisma.publishAsset.update({
          where: { id: task.assetId },
          data: { status: publishMode === 'publish' ? 'published' : 'draft_saved' },
        });
      } else {
        await prisma.publishTask.update({
          where: { id },
          data: {
            status: 'failed',
            errorMessage: result.error,
            retryCount: { increment: 1 },
          },
        });
      }
    }).catch(async (err) => {
      console.error(`[Publish] Task ${id} error:`, (err as Error).message);
      await prisma.publishTask.update({
        where: { id },
        data: { status: 'failed', errorMessage: (err as Error).message },
      });
    });

    return { ok: true, message: 'Task started' };
  });

  // Get task status
  app.get('/api/publish/tasks/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.publishTask.findUnique({ where: { id } });
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  // Batch publish
  app.post('/api/publish/batch', async (request, reply) => {
    const { assetIds, platforms } = request.body as {
      assetIds: string[];
      platforms: string[];
    };

    const tasks = [];
    for (const assetId of assetIds) {
      for (const platform of platforms) {
        const task = await prisma.publishTask.create({
          data: { assetId, platform },
        });
        tasks.push(task);
      }
    }

    return { created: tasks.length, tasks };
  });

  // Bridge status
  app.get('/api/bridge/status', async () => {
    const bridge = getBridgeClient();
    return { status: bridge.status };
  });

  // Connect bridge
  app.post('/api/bridge/connect', async (request, reply) => {
    const bridge = getBridgeClient();
    try {
      await bridge.connect();
      return { ok: true, status: bridge.status };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // List available platforms/templates
  app.get('/api/platforms', async () => {
    const templates = listTemplates();
    const accounts = await prisma.platformAccount.findMany();

    return templates.map((t) => {
      const account = accounts.find((a) => a.platform === t.platform);
      return {
        platform: t.platform,
        displayName: t.displayName,
        isActive: account?.isActive ?? false,
        config: account?.config,
      };
    });
  });
}
