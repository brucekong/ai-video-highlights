import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { imageSize } from 'image-size';

const prisma = new PrismaClient();

// Managed asset store root directory
const ASSET_STORE_ROOT = process.env.ASSET_STORE_ROOT
  || path.join(process.env.HOME || '/tmp', 'PublishAssets');

// Ensure root directory exists
if (!fs.existsSync(ASSET_STORE_ROOT)) {
  fs.mkdirSync(ASSET_STORE_ROOT, { recursive: true });
}

/** Resolve relative asset path to absolute */
function resolveAssetPath(relativePath: string): string {
  return path.join(ASSET_STORE_ROOT, relativePath);
}

/** Sanitize string for use as filename */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').substring(0, 100);
}

/** Move file into managed store, return relative path */
function importFileToStore(assetId: string, sourcePath: string, filename: string): string {
  const assetDir = path.join(ASSET_STORE_ROOT, assetId);
  if (!fs.existsSync(assetDir)) {
    fs.mkdirSync(assetDir, { recursive: true });
  }
  const destPath = path.join(assetDir, filename);
  fs.renameSync(sourcePath, destPath);
  return path.join(assetId, filename);
}

/** Copy file into managed store (keeps original), return relative path */
function copyFileToStore(assetId: string, sourcePath: string, filename: string): string {
  const assetDir = path.join(ASSET_STORE_ROOT, assetId);
  if (!fs.existsSync(assetDir)) {
    fs.mkdirSync(assetDir, { recursive: true });
  }
  const destPath = path.join(assetDir, filename);
  fs.copyFileSync(sourcePath, destPath);
  return path.join(assetId, filename);
}

export async function assetsRoutes(app: FastifyInstance) {
  // Get asset store root config
  app.get('/api/assets/store-root', async () => {
    return { root: ASSET_STORE_ROOT };
  });

  // Stream video file for preview
  app.get('/api/assets/:id/video', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await prisma.publishAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    const filePath = path.isAbsolute(asset.videoFilePath)
      ? asset.videoFilePath
      : resolveAssetPath(asset.videoFilePath);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Video file not found' });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    };
    const contentType = mimeMap[ext] || 'video/mp4';

    // Support range requests for seeking
    const range = request.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      reply.status(206).headers({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }

    reply.headers({
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    return reply.send(fs.createReadStream(filePath));
  });

  // Stream cover image for preview (supports ratio: '43' or '34')
  app.get('/api/assets/:id/cover', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { ratio } = request.query as { ratio?: string };
    const asset = await prisma.publishAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: 'Asset not found' });

    // Pick cover by ratio, default to 4:3, fallback to whichever exists
    let coverPath: string | null = null;
    if (ratio === '34') {
      coverPath = asset.cover34Path || asset.cover43Path;
    } else {
      coverPath = asset.cover43Path || asset.cover34Path;
    }

    if (!coverPath) return reply.status(404).send({ error: 'Cover not found' });

    const filePath = path.isAbsolute(coverPath) ? coverPath : resolveAssetPath(coverPath);

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Cover file not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp',
    };

    reply.headers({ 'Content-Type': mimeMap[ext] || 'image/png' });
    return reply.send(fs.createReadStream(filePath));
  });

  // List assets with pagination and filtering
  app.get('/api/assets', async (request, reply) => {
    const { status, page = 1, limit = 20 } = request.query as {
      status?: string;
      page?: number;
      limit?: number;
    };

    const where = status ? { status } : {};
    const [assets, total] = await Promise.all([
      prisma.publishAsset.findMany({
        where,
        include: { publishTasks: true },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.publishAsset.count({ where }),
    ]);

    // Resolve relative paths to absolute for client
    const resolved = assets.map(a => ({
      ...a,
      videoFilePathAbsolute: resolveAssetPath(a.videoFilePath),
      cover43PathAbsolute: a.cover43Path ? resolveAssetPath(a.cover43Path) : null,
      cover34PathAbsolute: a.cover34Path ? resolveAssetPath(a.cover34Path) : null,
    }));

    return { assets: resolved, total, page: Number(page), limit: Number(limit) };
  });

  // Import asset: move files into managed store
  app.post('/api/assets/import', async (request, reply) => {
    const body = request.body as {
      title: string;
      description?: string;
      hashtags?: string;
      videoFilePath: string;      // absolute source path
      cover43FilePath?: string;   // 4:3 cover source path
      cover34FilePath?: string;   // 3:4 cover source path
      videoId?: string;
    };

    // Validate source files exist
    if (!fs.existsSync(body.videoFilePath)) {
      return reply.status(400).send({ error: `Video file not found: ${body.videoFilePath}` });
    }
    if (body.cover43FilePath && !fs.existsSync(body.cover43FilePath)) {
      return reply.status(400).send({ error: `4:3 cover not found: ${body.cover43FilePath}` });
    }
    if (body.cover34FilePath && !fs.existsSync(body.cover34FilePath)) {
      return reply.status(400).send({ error: `3:4 cover not found: ${body.cover34FilePath}` });
    }

    // Create DB record first to get ID
    const asset = await prisma.publishAsset.create({
      data: {
        title: body.title,
        description: body.description,
        hashtags: body.hashtags,
        videoFilePath: '', // placeholder
        videoId: body.videoId,
        status: 'draft',
      },
    });

    try {
      // Move video into store — use title as filename
      const videoExt = path.extname(body.videoFilePath);
      const videoFileName = sanitizeFilename(body.title) + videoExt;
      const videoRelPath = importFileToStore(asset.id, body.videoFilePath, videoFileName);

      // Move covers — name follows video title
      let cover43RelPath: string | undefined;
      let cover34RelPath: string | undefined;

      if (body.cover43FilePath) {
        const ext = path.extname(body.cover43FilePath);
        const coverName = sanitizeFilename(body.title) + '_4x3' + ext;
        cover43RelPath = importFileToStore(asset.id, body.cover43FilePath, coverName);
      }
      if (body.cover34FilePath) {
        const ext = path.extname(body.cover34FilePath);
        const coverName = sanitizeFilename(body.title) + '_3x4' + ext;
        cover34RelPath = importFileToStore(asset.id, body.cover34FilePath, coverName);
      }

      const hasCover = !!(cover43RelPath || cover34RelPath);
      const updated = await prisma.publishAsset.update({
        where: { id: asset.id },
        data: {
          videoFilePath: videoRelPath,
          cover43Path: cover43RelPath,
          cover34Path: cover34RelPath,
          status: hasCover ? 'ready' : 'draft',
        },
      });

      return updated;
    } catch (err) {
      await prisma.publishAsset.delete({ where: { id: asset.id } }).catch(() => {});
      return reply.status(500).send({ error: `Import failed: ${(err as Error).message}` });
    }
  });

  // Update asset
  app.patch('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{
      title: string;
      description: string;
      hashtags: string;
      status: string;
      cover43Path: string;
      cover34Path: string;
    }>;

    // Get current asset for title (used for cover naming)
    const current = await prisma.publishAsset.findUnique({ where: { id } });
    if (!current) return reply.status(404).send({ error: 'Asset not found' });

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.hashtags !== undefined) data.hashtags = body.hashtags;
    if (body.status !== undefined) data.status = body.status;

    const titleForFile = sanitizeFilename(body.title || current.title);

    // Handle cover43Path — if it's a new absolute path, import it
    if (body.cover43Path !== undefined) {
      if (!body.cover43Path) {
        data.cover43Path = null;
      } else if (path.isAbsolute(body.cover43Path) && fs.existsSync(body.cover43Path)) {
        const ext = path.extname(body.cover43Path);
        const coverName = titleForFile + '_4x3' + ext;
        const relPath = copyFileToStore(id, body.cover43Path, coverName);
        data.cover43Path = relPath;
      } else {
        data.cover43Path = body.cover43Path;
      }
    }

    // Handle cover34Path — if it's a new absolute path, import it
    if (body.cover34Path !== undefined) {
      if (!body.cover34Path) {
        data.cover34Path = null;
      } else if (path.isAbsolute(body.cover34Path) && fs.existsSync(body.cover34Path)) {
        const ext = path.extname(body.cover34Path);
        const coverName = titleForFile + '_3x4' + ext;
        const relPath = copyFileToStore(id, body.cover34Path, coverName);
        data.cover34Path = relPath;
      } else {
        data.cover34Path = body.cover34Path;
      }
    }

    const asset = await prisma.publishAsset.update({
      where: { id },
      data,
    });

    return asset;
  });

  // Delete asset (also removes files from store)
  app.delete('/api/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Remove directory from store
    const assetDir = path.join(ASSET_STORE_ROOT, id);
    if (fs.existsSync(assetDir)) {
      fs.rmSync(assetDir, { recursive: true, force: true });
    }

    await prisma.publishAsset.delete({ where: { id } });
    return { ok: true };
  });

  // Browse local filesystem directories and files
  app.get('/api/fs/browse', async (request, reply) => {
    const { dir } = request.query as { dir?: string };
    const targetDir = dir || process.env.HOME || '/';

    try {
      if (!fs.existsSync(targetDir)) {
        return reply.status(400).send({ error: 'Directory not found' });
      }

      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: 'Not a directory' });
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });

      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

      // Only show directories that contain media or have subdirectories (shallow check)
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
          const dirPath = path.join(targetDir, e.name);
          let hasMedia = false;
          let hasSubdirs = false;
          try {
            const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
            hasMedia = subEntries.some(f =>
              f.isFile() && (videoExtensions.includes(path.extname(f.name).toLowerCase())
                || imageExtensions.includes(path.extname(f.name).toLowerCase()))
            );
            if (!hasMedia) {
              hasSubdirs = subEntries.some(f => f.isDirectory() && !f.name.startsWith('.'));
            }
          } catch { /* permission denied */ }
          return { name: e.name, path: dirPath, hasMedia, hasSubdirs };
        })
        .filter(d => d.hasMedia || d.hasSubdirs)
        .sort((a, b) => {
          if (a.hasMedia && !b.hasMedia) return -1;
          if (!a.hasMedia && b.hasMedia) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(({ name, path: p, hasMedia }) => ({ name, path: p, hasMedia }));

      const videos = entries
        .filter(e => e.isFile() && videoExtensions.includes(path.extname(e.name).toLowerCase()))
        .map(e => {
          const filePath = path.join(targetDir, e.name);
          const fileStat = fs.statSync(filePath);
          return { name: e.name, path: filePath, size: fileStat.size };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const images = entries
        .filter(e => e.isFile() && imageExtensions.includes(path.extname(e.name).toLowerCase()))
        .map(e => {
          const filePath = path.join(targetDir, e.name);
          const fileStat = fs.statSync(filePath);
          let width: number | undefined, height: number | undefined;
          try {
            // Read only first 64KB for header parsing (sufficient for all image formats)
            const fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(Math.min(65536, fileStat.size));
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            const dims = imageSize(buf);
            width = dims.width;
            height = dims.height;
          } catch { /* ignore */ }
          return { name: e.name, path: filePath, size: fileStat.size, mtime: fileStat.mtimeMs, width, height };
        })
        .sort((a, b) => b.mtime - a.mtime);

      return {
        current: targetDir,
        parent: path.dirname(targetDir),
        dirs,
        videos,
        images,
      };
    } catch (e) {
      return reply.status(500).send({ error: (e as Error).message });
    }
  });

  // Preview local file (for file browser preview before import)
  app.get('/api/fs/preview', async (request, reply) => {
    const { path: filePath } = request.query as { path?: string };
    if (!filePath) return reply.status(400).send({ error: 'path parameter required' });

    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return reply.status(400).send({ error: 'Not a file' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
      '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.gif': 'image/gif',
    };

    const contentType = mimeMap[ext] || 'application/octet-stream';

    // Support range requests for video seeking
    const range = request.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      reply.status(206).headers({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }

    reply.headers({
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    return reply.send(fs.createReadStream(filePath));
  });

  // List analyzed videos (for association in import)
  app.get('/api/videos/all', async (_request, reply) => {
    const videos = await prisma.video.findMany({
      where: { title: { not: null } },
      select: {
        videoId: true,
        title: true,
        channelsTitle: true,
        videoDescription: true,
        videoHashtags: true,
        redbookTitle: true,
        redbookDescription: true,
        redbookHashtags: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return reply.send({ videos });
  });
}
