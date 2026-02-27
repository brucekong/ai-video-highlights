import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import youtubedlDefault, { create } from 'youtube-dl-exec';
import Groq from 'groq-sdk';
import { TranscriptSegment } from './transcript.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const systemYoutubedl = create('yt-dlp');

/**
 * 尝试下载视频纯音频，并通过 Whisper 转换为字幕格式的兜底方案
 */
export async function fallbackToWhisper(videoId: string, platform: 'youtube' | 'bilibili'): Promise<TranscriptSegment[]> {
  const url = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.bilibili.com/video/${videoId}`;

  const tmpFile = path.join(os.tmpdir(), `${videoId}_audio.m4a`);

  try {
    console.log(`[Whisper Fallback] Downloading audio for ${platform} video: ${videoId}...`);

    const dlOptions = {
      extractAudio: true,
      audioFormat: 'm4a',
      format: 'worstaudio/bestaudio', // 尽量取较小的音频流
      output: tmpFile,
      maxFilesize: '25m', // Groq Whisper API Limit is also 25MB
    };

    try {
      // 优先尝试系统安装的 yt-dlp (通常自带依赖环境)
      await systemYoutubedl(url, dlOptions);
    } catch (err: any) {
      console.warn(`[Whisper Fallback] System yt-dlp failed, trying internal: ${err.message}`);
      // 回退到 youtube-dl-exec 自带的
      await youtubedlDefault(url, dlOptions);
    }

    // 检查文件是否下载成功
    if (!fs.existsSync(tmpFile)) {
      throw new Error(`[Whisper Fallback] Audio file not found at ${tmpFile}`);
    }

    const stats = await fs.stat(tmpFile);
    console.log(`[Whisper Fallback] Downloaded audio file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    if (stats.size > 25 * 1024 * 1024) {
      throw new Error(`[Whisper Fallback] Audio file is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Groq limit is 25MB.`);
    }

    console.log(`[Whisper Fallback] Invoking Groq Whisper API...`);
    // 调用 Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json', // 请求带时间戳的输出
    });

    const segmentsList = (transcription as any).segments || [];
    console.log(`[Whisper Fallback] Groq Whisper response received, parsing ${segmentsList.length} segments.`);

    // 转换为前端所需的 TranscriptSegment[]
    const formattedSegments: TranscriptSegment[] = segmentsList.map((seg: any) => {
      const startMs = Math.round(seg.start * 1000);
      const endMs = Math.round(seg.end * 1000);
      return {
        text: seg.text.trim(),
        offset: startMs,
        duration: endMs - startMs,
      };
    });

    return formattedSegments;
  } catch (error: any) {
    console.error(`[Whisper Fallback Failed]`, error.message);
    throw error;
  } finally {
    // 垃圾回收：删除临时文件
    if (fs.existsSync(tmpFile)) {
      await fs.remove(tmpFile).catch(console.error);
    }
  }
}
