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

    // 提取时间参数 (优先从 query 里取，作为后备再从 multipart fields 取)
    const query = request.query as any;
    const startQuery = query?.start;
    const endQuery = query?.end;

    const startField = data.fields?.start as any;
    const endField = data.fields?.end as any;

    const startVal = startQuery !== undefined ? startQuery : startField?.value;
    const endVal = endQuery !== undefined ? endQuery : endField?.value;

    const start = parseFloat(String(startVal || '0'));
    const end = parseFloat(String(endVal || '0'));

    request.log.info({ 
      start, 
      end, 
      startQuery, 
      endQuery, 
      startFieldValue: startField?.value, 
      endFieldValue: endField?.value 
    }, '[Trim Local] Time Parameters');

    if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
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

    // 🔍 详细调试日志：对比 fields 和 query 中的值
    request.log.info({
      hasWatermark,
      wmType,
      wmScale,
      wmXPercent,
      wmYPercent,
      wmOpacity,
      wmBase64ImageLength: wmBase64Image.length,
      'fields.wmScale': fields.wmScale?.value,
      'fields.wmBase64Image_exists': !!fields.wmBase64Image?.value,
      'query.wmScale': query?.wmScale,
      'all_field_keys': Object.keys(fields),
    }, '[Trim Local] Watermark params');

    // 随机生成临时文件名，避免并发冲突
    const fileId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const originalExt = path.extname(data.filename) || '.mp4';
    const inputPath = path.join(TEMP_DIR, `input_${fileId}${originalExt}`);
    const wmImagePath = path.join(TEMP_DIR, `wm_${fileId}.png`);
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
      let cmd = '';

      if (hasWatermark && wmType === 'image' && hasValidWmImage) {
        // scale2ref 滤镜说明：
        // 输入: [1:v]=水印图片, [0:v]=原始视频(参考)
        // 在 scale2ref 表达式中:
        //   - main_w/main_h = 第一个输入(水印)的原始宽高
        //   - iw/ih = 第二个输入(参考视频)的宽高  
        // 因此要让水印宽度 = 视频宽度 * scale%，必须用 iw (视频宽)
        const scaleFactor = (wmScale / 100).toFixed(4);
        const xFactor = (wmXPercent / 100).toFixed(4);
        const yFactor = (wmYPercent / 100).toFixed(4);

        // 缩放: iw = 参考视频宽, ow/mdar = 等比缩放高度
        // overlay 坐标: W = 底层视频宽度, H = 底层视频高度
        const filterComplex = [
          `[1:v][0:v]scale2ref=iw*${scaleFactor}:ow/mdar[wm_scaled][main_vid]`,
          `[wm_scaled]format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`,
          `[main_vid][wm]overlay=x='W*${xFactor}':y='H*${yFactor}'`
        ].join(';');

        cmd = `"${ffmpegLocation}" -y -i "${inputPath}" -i "${wmImagePath}" -ss ${start} -t ${duration} -filter_complex "${filterComplex}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;

      } else if (hasWatermark && wmType === 'text' && wmText) {
        // 构造文字水印 filter
        // 坐标转换为基于 main_w, main_h 的相对百分比
        const xPos = `(w*${(wmXPercent / 100).toFixed(4)})`;
        const yPos = `(h*${(wmYPercent / 100).toFixed(4)})`;
        
        // 适当转义文本中的特殊字符
        const escapedText = wmText.replace(/'/g, "'\\\\''").replace(/:/g, '\\:');
        
        let drawtextFilter = `drawtext=text='${escapedText}':x=${xPos}:y=${yPos}:fontsize=${wmFontSize}:fontcolor=${wmTextColor}@${wmOpacity}`;
        
        // 字体兼容性配置 (macOS / Linux)
        if (process.platform === 'darwin') {
          drawtextFilter += `:font='PingFang SC'`;
        }
        
        if (wmHasBg) {
          drawtextFilter += `:box=1:boxcolor=${wmBgColor}@${wmOpacity}:boxborderw=6`;
        }

        cmd = `"${ffmpegLocation}" -y -i "${inputPath}" -ss ${start} -t ${duration} -vf "${drawtextFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
      } else {
        // 无水印标准裁剪
        cmd = `"${ffmpegLocation}" -y -i "${inputPath}" -ss ${start} -t ${duration} -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`;
      }
      
      request.log.info(`[Trim Local] Running command: ${cmd}`);
      await execAsync(cmd);

      // 检查输出文件是否存在并获取状态
      if (!(await fs.pathExists(outputPath))) {
        throw new Error('ffmpeg 裁剪失败，未生成输出文件');
      }

      const stat = await fs.stat(outputPath);
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
