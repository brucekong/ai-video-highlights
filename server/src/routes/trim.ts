import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { resolveFfmpegLocation } from '../services/ytdlp.js';
import { getSubtitleFontFile, escapeDrawtextPath, escapeDrawtextText } from '../services/clipping.js';

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), 'cache', 'trim-temp');

/**
 * 清理临时目录中超过 30 分钟的废弃文件
 */
async function cleanupOldTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    for (const f of files) {
      const fullPath = path.join(TEMP_DIR, f);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && now - stat.mtimeMs > 30 * 60 * 1000) {
        await fs.remove(fullPath).catch(() => {});
      }
    }
  } catch {
    // 忽略清理异常
  }
}

export async function trimRoutes(fastify: FastifyInstance) {
  // 确保临时目录存在并清理陈旧文件
  await fs.ensureDir(TEMP_DIR);
  await cleanupOldTempFiles();

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

    // 提取时间参数 (优先从 query 里取，作为后备再从 multipart fields 取)
    const query = request.query as any;
    const startQuery = query?.start;
    const endQuery = query?.end;

    const startField = data.fields?.start as any;
    const endField = data.fields?.end as any;

    const startVal = startQuery !== undefined ? startQuery : startField?.value;
    const endVal = endQuery !== undefined ? endQuery : endField?.value;

    const start = Math.max(0, parseFloat(String(startVal || '0')));
    const end = parseFloat(String(endVal || '0'));

    request.log.info({ 
      start, 
      end, 
      startQuery, 
      endQuery, 
      startFieldValue: startField?.value, 
      endFieldValue: endField?.value 
    }, '[Trim Local] Time Parameters');

    if (isNaN(start) || isNaN(end) || end <= start) {
      return reply.status(400).send({ error: '无效的裁剪时间范围' });
    }

    const duration = end - start;

    // 水印参数解析 (优先从 query 或 fields 中提取)
    const fields = (data.fields || {}) as Record<string, any>;
    const hasWatermark = fields.hasWatermark?.value === 'true' || query?.hasWatermark === 'true';
    const wmType = String(fields.wmType?.value || query?.wmType || 'text');
    const wmXPercent = parseFloat(String(fields.wmXPercent?.value || query?.wmXPercent || '80'));
    const wmYPercent = parseFloat(String(fields.wmYPercent?.value || query?.wmYPercent || '8'));
    const wmOpacity = parseFloat(String(fields.wmOpacity?.value || query?.wmOpacity || '0.85'));

    // 文字水印参数
    const wmText = String(fields.wmText?.value || query?.wmText || '');
    const wmFontSize = parseInt(String(fields.wmFontSize?.value || query?.wmFontSize || '24'), 10);
    const wmTextColor = String(fields.wmTextColor?.value || query?.wmTextColor || '#ffffff');
    const wmHasBg = fields.wmHasBg?.value === 'true' || query?.wmHasBg === 'true';
    const wmBgColor = String(fields.wmBgColor?.value || query?.wmBgColor || '#000000');

    // 图片水印参数
    const wmScale = parseFloat(String(fields.wmScale?.value || query?.wmScale || '25'));
    const wmBase64Image = String(fields.wmBase64Image?.value || '');

    // 随机生成临时文件名，避免并发冲突
    const fileId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const originalExt = path.extname(data.filename) || '.mp4';
    const inputPath = path.join(TEMP_DIR, `input_${fileId}${originalExt}`);
    const wmImagePath = path.join(TEMP_DIR, `wm_${fileId}.png`);
    const outputPath = path.join(TEMP_DIR, `output_${fileId}${originalExt}`);

    try {
      // 写入上传视频文件，使用 pipeline 确保完全刷新到磁盘并关闭文件句柄
      const writeStream = fs.createWriteStream(inputPath);
      await pipeline(data.file, writeStream);

      // 严格检查文件上传是否由于体积超限被 busboy 截断
      if (data.file.truncated) {
        throw new Error('上传的视频体积超出最大限制，上传已被截断。');
      }

      const inputStat = await fs.stat(inputPath);
      if (inputStat.size === 0) {
        throw new Error('上传的视频文件为空。');
      }

      request.log.info({ inputSize: inputStat.size, filename: data.filename }, '[Trim Local] Upload saved successfully');

      // 验证 ffmpeg 是否可用
      const ffmpegLocation = resolveFfmpegLocation();
      if (!ffmpegLocation) {
        throw new Error('当前运行环境未安装 ffmpeg，无法执行裁剪。请配置 FFMPEG_PATH 或将 ffmpeg 添加到 PATH 环境变量。');
      }

      // 如果是图片水印且包含 base64 数据，先解码落盘
      let hasValidWmImage = false;
      if (hasWatermark && wmType === 'image') {
        if (wmBase64Image) {
          try {
            const base64Data = wmBase64Image.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(wmImagePath, buffer);
            hasValidWmImage = await fs.pathExists(wmImagePath);
            request.log.info({ wmImagePath, bufferSize: buffer.length, hasValidWmImage }, '[Trim Local] Watermark image written to disk');
          } catch (imgErr) {
            request.log.error(imgErr, '[Trim Local] Failed to save watermark image');
          }
        } else {
          request.log.warn('[Trim Local] wmType is image but wmBase64Image is empty');
        }
      }

      // 构造 FFmpeg 命令与滤镜
      // 核心优化：将 -ss 放在 -i 之前实现毫秒级快速跳转，避免从第 0 秒慢速逐帧解码，
      // 并配合 -avoid_negative_ts make_zero 规范化 PTS 时间戳。
      let cmd = '';

      if (hasWatermark && wmType === 'image' && hasValidWmImage) {
        const scaleFactor = (wmScale / 100).toFixed(4);
        const xFactor = (wmXPercent / 100).toFixed(4);
        const yFactor = (wmYPercent / 100).toFixed(4);

        const filterComplex = [
          `[1:v][0:v]scale2ref=iw*${scaleFactor}:ow/mdar[wm_scaled][main_vid]`,
          `[wm_scaled]format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`,
          `[main_vid][wm]overlay=x='W*${xFactor}':y='H*${yFactor}'`
        ].join(';');

        cmd = `"${ffmpegLocation}" -y -ss ${start} -i "${inputPath}" -i "${wmImagePath}" -t ${duration} -filter_complex "${filterComplex}" -avoid_negative_ts make_zero -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;

      } else if (hasWatermark && wmType === 'text' && wmText) {
        const xPos = `(w*${(wmXPercent / 100).toFixed(4)})`;
        const yPos = `(h*${(wmYPercent / 100).toFixed(4)})`;
        
        const escapedText = escapeDrawtextText(wmText);
        const fontFile = escapeDrawtextPath(getSubtitleFontFile());
        
        let drawtextFilter = `drawtext=fontfile='${fontFile}':text='${escapedText}':x=${xPos}:y=${yPos}:fontsize=${wmFontSize}:fontcolor=${wmTextColor}@${wmOpacity}`;
        
        if (wmHasBg) {
          drawtextFilter += `:box=1:boxcolor=${wmBgColor}@${wmOpacity}:boxborderw=6`;
        }

        cmd = `"${ffmpegLocation}" -y -ss ${start} -i "${inputPath}" -t ${duration} -vf "${drawtextFilter}" -avoid_negative_ts make_zero -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
      } else {
        // 无水印标准快速裁剪
        cmd = `"${ffmpegLocation}" -y -ss ${start} -i "${inputPath}" -t ${duration} -avoid_negative_ts make_zero -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
      }
      
      request.log.info(`[Trim Local] Running command: ${cmd}`);
      const startTimeMs = Date.now();
      await execAsync(cmd);
      const elapsedMs = Date.now() - startTimeMs;
      request.log.info({ elapsedMs }, '[Trim Local] FFmpeg command completed');

      // 检查输出文件是否存在并获取状态
      if (!(await fs.pathExists(outputPath))) {
        throw new Error('ffmpeg 裁剪失败，未生成输出文件');
      }

      const stat = await fs.stat(outputPath);
      // 避免输出只有 261 字节的空文件（无任何视频/音频帧）被当成正常结果下载
      if (stat.size <= 1024) {
        throw new Error('视频裁剪生成的文件为空（0 字节有效数据），请检查裁剪起止时间是否在视频有效时长范围内。');
      }

      const downloadName = `processed_${path.basename(data.filename)}`;

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
        await fs.remove(wmImagePath).catch(() => {});
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
      await fs.remove(wmImagePath).catch(() => {});
      await fs.remove(outputPath).catch(() => {});

      return reply.status(500).send({
        error: 'Trim failed',
        message: error.message || '视频裁剪失败，请稍后重试。',
      });
    }
  });
}
