import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegLocation } from '../services/ytdlp.js';

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), 'cache', 'trim-temp');

export async function trimRoutes(fastify: FastifyInstance) {
  // 确保临时目录存在
  await fs.ensureDir(TEMP_DIR);

  fastify.post('/api/video/trim-local', {
    schema: {
      tags: ['Trim'],
      summary: '裁剪本地视频',
      description: '接收上传的本地视频文件以及裁剪起止时间，使用 ffmpeg 裁剪后直接流式下载。',
      response: {
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // 检查是否上传了文件
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: '未上传视频文件' });
    }

    // 提取时间参数 (start 和 end 均为秒数)
    const startField = data.fields?.start as any;
    const endField = data.fields?.end as any;

    const start = startField ? parseFloat(startField.value) : 0;
    const end = endField ? parseFloat(endField.value) : 0;

    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
      return reply.status(400).send({ error: '无效的裁剪时间范围' });
    }

    const duration = end - start;

    // 随机生成临时文件名，避免并发冲突
    const fileId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const originalExt = path.extname(data.filename) || '.mp4';
    const inputPath = path.join(TEMP_DIR, `input_${fileId}${originalExt}`);
    const outputPath = path.join(TEMP_DIR, `output_${fileId}${originalExt}`);

    try {
      // 写入上传视频文件
      const writeStream = fs.createWriteStream(inputPath);
      await new Promise<void>((resolve, reject) => {
        data.file.pipe(writeStream);
        data.file.on('end', () => resolve());
        data.file.on('error', (err) => reject(err));
      });

      // 验证 ffmpeg 是否可用
      const ffmpegLocation = resolveFfmpegLocation();
      if (!ffmpegLocation) {
        throw new Error('当前运行环境未安装 ffmpeg，无法执行裁剪。请配置 FFMPEG_PATH 或将 ffmpeg 添加到 PATH 环境变量。');
      }

      // 执行 ffmpeg 裁剪
      // 这里将 -ss 放在 -i 之后以确保对于部分无良好关键帧索引的视频也能做高精度的帧切片
      // 使用 libx264 ultrafast 以获得最快编码速度，aac 做音频重编码保证音画同步与极高兼容性
      const cmd = `"${ffmpegLocation}" -y -i "${inputPath}" -ss ${start} -t ${duration} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
      
      request.log.info(`[Trim Local] Running command: ${cmd}`);
      await execAsync(cmd);

      // 检查输出文件是否存在并获取状态
      if (!(await fs.pathExists(outputPath))) {
        throw new Error('ffmpeg 裁剪失败，未生成输出文件');
      }

      const stat = await fs.stat(outputPath);
      const downloadName = `trimmed_${path.basename(data.filename)}`;

      // 设置响应头
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);

      // 发送可读流
      const readStream = fs.createReadStream(outputPath);
      
      // 监听流关闭和响应完成事件，自动清理临时文件
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        await fs.remove(inputPath).catch(() => {});
        await fs.remove(outputPath).catch(() => {});
        request.log.info(`[Trim Local] Cleaned up temporary files for ${fileId}`);
      };

      reply.raw.on('close', cleanup);
      reply.raw.on('finish', cleanup);

      return reply.send(readStream);

    } catch (error: any) {
      request.log.error(error, `❌ [Trim Local] Failed for ${fileId}`);
      
      // 出错时清理临时文件
      await fs.remove(inputPath).catch(() => {});
      await fs.remove(outputPath).catch(() => {});

      return reply.status(500).send({
        error: 'Trim failed',
        message: error.message || '视频裁剪失败，请稍后重试。',
      });
    }
  });
}
