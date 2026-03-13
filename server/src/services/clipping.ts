import youtubedl from 'youtube-dl-exec';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 缓存目录
const CLIPS_DIR = path.join(process.cwd(), 'cache', 'clips');

interface SubtitleItem {
  text: string;
  translatedText?: string;
  offset: number;   // 毫秒
  duration: number; // 毫秒
}

interface ClipOptions {
  videoId: string;
  url: string;
  start: number;      // 秒
  duration: number;   // 秒
  platform: string;
  subtitles?: SubtitleItem[];
  language?: string;
}

/**
 * 格式化秒数为 SRT 时间格式 (HH:MM:SS,ms)
 */
function formatSrtTime(totalSeconds: number): string {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * 将字幕数组转换为 SRT 文本
 */
function generateSrt(subtitles: SubtitleItem[], startTimeSec: number): string {
  return subtitles
    .map((s, i) => {
      const start = (s.offset / 1000) - startTimeSec;
      const end = ((s.offset + s.duration) / 1000) - startTimeSec;
      
      // 过滤掉不在片段范围内的字幕
      if (end <= 0) return null;
      
      const text = s.translatedText 
        ? `${s.translatedText}\n${s.text}` // 双语
        : s.text;
        
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 格式化秒数为 HH:MM:SS.ms (用于 yt-dlp)
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * 核心剪辑函数
 */
export async function createVideoClip({ videoId, url, start, duration, platform, subtitles, language }: ClipOptions): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);
  
  const end = start + duration;
  // 增加 subtitles 特征到文件名，以便在字幕变化时重新生成
  const hasSubs = subtitles && subtitles.length > 0;
  // 如果是中文视频，跳过字幕 muxing
  const shouldMuxSubs = hasSubs && language !== 'zh';
  const clipId = `${videoId}_${Math.floor(start)}_${Math.floor(duration)}${shouldMuxSubs ? '_subs_v2' : ''}`;
  const outputPath = path.join(CLIPS_DIR, `${clipId}.mp4`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  const tempRawPath = path.join(os.tmpdir(), `raw_${clipId}.mp4`);
  const srtPath = path.join(os.tmpdir(), `${clipId}.srt`);

  try {
    const dlFlags: any = {
      output: tempRawPath,
      format: 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a]/best[ext=mp4]/best',
      downloadSections: `*${formatTime(start)}-${formatTime(end)}`,
      mergeOutputFormat: 'mp4',
      noOverwrites: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (platform === 'youtube' && process.env.YOUTUBE_COOKIES) {
      const cookiePath = path.join(CLIPS_DIR, 'cookies_temp.txt');
      await fs.writeFile(cookiePath, process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n'));
      dlFlags.cookies = cookiePath;
    }

    await youtubedl(url, dlFlags);
 
     if (shouldMuxSubs) {
      // 1. 生成 SRT 文件
      const srtContent = generateSrt(subtitles!, start);
      await fs.writeFile(srtPath, srtContent);

      // 2. 利用 FFmpeg 将字幕作为软字幕流 Mux 进 MP4 (不重新编码，极速)
      // 注意：使用 mov_text 是 MP4 标准字幕格式，兼容性好
      // -disposition:s:0 default 标记该轨道为默认开启
      console.log(`[Clipping] Muxing subtitles into ${outputPath}...`);
      await execAsync(`ffmpeg -y -i "${tempRawPath}" -i "${srtPath}" -c copy -c:s mov_text -metadata:s:s:0 language=chi -disposition:s:0 default "${outputPath}"`);
    } else {
      // 如果没有字幕，加一个 faststart 直接移动
      await execAsync(`ffmpeg -y -i "${tempRawPath}" -c copy -movflags faststart "${outputPath}"`);
    }

    return outputPath;
  } catch (error: any) {
    console.error(`❌ [Clipping] Failed:`, error.message);
    throw error;
  } finally {
    // 清理临时文件
    await fs.remove(tempRawPath).catch(() => {});
    await fs.remove(srtPath).catch(() => {});
  }
}

/**
 * 下载完整视频
 */
export async function downloadFullVideo({ videoId, url, platform }: { videoId: string, url: string, platform: string }): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);
  
  const outputPath = path.join(CLIPS_DIR, `${videoId}_full.mp4`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  try {
    const dlFlags: any = {
      output: outputPath,
      format: 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[acodec^=mp4a]/best[ext=mp4]/best',
      mergeOutputFormat: 'mp4',
      noOverwrites: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (platform === 'youtube' && process.env.YOUTUBE_COOKIES) {
      const cookiePath = path.join(CLIPS_DIR, 'cookies_temp.txt');
      await fs.writeFile(cookiePath, process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n'));
      dlFlags.cookies = cookiePath;
    }

    console.log(`[Full Download] Downloading ${url} to ${outputPath}...`);
    await youtubedl(url, dlFlags);
    
    // 增加 faststart 优化
    const tempPath = path.join(CLIPS_DIR, `${videoId}_full_temp.mp4`);
    if (await fs.pathExists(outputPath)) {
      await fs.move(outputPath, tempPath);
      await execAsync(`ffmpeg -y -i "${tempPath}" -c copy -movflags faststart "${outputPath}"`);
      await fs.remove(tempPath);
    }

    return outputPath;
  } catch (error: any) {
    console.error(`❌ [Full Download] Failed:`, error.message);
    throw error;
  }
}

export async function clearOldClips(maxAgeHours: number = 24) {
  const files = await fs.readdir(CLIPS_DIR);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(CLIPS_DIR, file);
    const stats = await fs.stat(filePath);
    if ((now - stats.mtimeMs) / (1000 * 60 * 60) > maxAgeHours) {
      await fs.remove(filePath);
    }
  }
}
