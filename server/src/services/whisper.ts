import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import youtubedl from 'youtube-dl-exec';
import Groq from 'groq-sdk';
import { TranscriptSegment } from './transcript.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * 尝试下载视频纯音频，并通过 Whisper 转换为字幕格式的兜底方案
 */
export async function fallbackToWhisper(videoId: string, platform: 'youtube' | 'bilibili'): Promise<TranscriptSegment[]> {
  const url = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.bilibili.com/video/${videoId}`;

  const tmpFile = path.join(os.tmpdir(), `${videoId}_audio.m4a`);
  const cookieFile = path.join(os.tmpdir(), `youtube_cookies_${Date.now()}.txt`);

  try {
    console.log(`[Whisper Fallback] Downloading audio for ${platform} video: ${videoId}...`);

    const dlFlags: any = {
      extractAudio: true,
      audioFormat: 'm4a',
      format: 'worstaudio/bestaudio',
      output: tmpFile,
      maxFilesize: '25m',
      // 添加 User-Agent 和 Header 伪装成浏览器，降低被识别为爬虫的概率
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      addHeader: [
        'referer:https://www.youtube.com/',
        'accept-language:zh-CN,zh;q=0.9,en;q=0.8'
      ]
    };

    // 如果环境变量设置了 YouTube Cookies，则写入临时文件供 yt-dlp 使用
    if (process.env.YOUTUBE_COOKIES && platform === 'youtube') {
      await fs.writeFile(cookieFile, process.env.YOUTUBE_COOKIES);
      dlFlags.cookies = cookieFile;
      console.log(`[Whisper Fallback] Using provided YouTube cookies.`);
    }

    // 使用 yt-dlp 抓取并转化为最小体积的 m4a 音频
    await youtubedl(url, dlFlags);

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
    if (fs.existsSync(cookieFile)) {
      await fs.remove(cookieFile).catch(console.error);
    }
  }
}
