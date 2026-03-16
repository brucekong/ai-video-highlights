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
  format?: string;
  burnSubtitles?: boolean;
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
export async function createVideoClip({ videoId, url, start, duration, platform, subtitles, language, format = 'mp4', burnSubtitles = false }: ClipOptions): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);
  
  const end = start + duration;
  const hasSubs = subtitles && subtitles.length > 0;
  // 是否需要制作软字幕(只在你选择mp4且不硬字幕且非中文时产生软字幕)
  const shouldMuxSubs = hasSubs && language !== 'zh' && format === 'mp4' && !burnSubtitles;
  const isMp3 = format === 'mp3';
  
  // 生成缓存文件名
  const clipId = `${videoId}_${Math.floor(start)}_${Math.floor(duration)}${shouldMuxSubs ? '_subs_v2' : ''}${burnSubtitles ? '_burned' : ''}${isMp3 ? '_mp3' : ''}`;
  const ext = isMp3 ? 'mp3' : 'mp4';
  const outputPath = path.join(CLIPS_DIR, `${clipId}.${ext}`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  // ==== 优化 1：尝试寻找本地是否存在完整版视频文件 ====
  const fullVideoPath = path.join(CLIPS_DIR, `${videoId}_full.mp4`);
  const hasLocalFullVideo = await fs.pathExists(fullVideoPath);
  
  const tempRawPath = path.join(os.tmpdir(), `raw_${clipId}.mp4`);
  const srtPath = path.join(os.tmpdir(), `${clipId}.srt`);

  try {
    if (hasLocalFullVideo) {
      console.log(`[Clipping] Found local full video, fast seeking...`);
      if (isMp3) {
        await execAsync(`ffmpeg -y -ss ${start} -i "${fullVideoPath}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${outputPath}"`);
        return outputPath;
      }
      
      if (burnSubtitles && hasSubs) {
         // 硬字幕需要重新编码
         const srtContent = generateSrt(subtitles!, start);
         await fs.writeFile(srtPath, srtContent);
         // 替换反斜杠和冒号防止 Windows/FFmpeg 路径解析错误
         const safeSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
         await execAsync(`ffmpeg -y -ss ${start} -i "${fullVideoPath}" -t ${duration} -vf "subtitles=${safeSrtPath}:force_style='Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=10'" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k "${outputPath}"`);
         return outputPath;
      }
      
      await execAsync(`ffmpeg -y -ss ${start} -i "${fullVideoPath}" -t ${duration} -c copy "${tempRawPath}"`);
    } else {
      console.log(`[Clipping] Local video not found, downloading segment online using extreme fast mode...`);
      
      // ==== 优化 2/方案 3：使用极限线上截取策略 ====
      const dlFlags: Record<string, any> = {
        output: tempRawPath,
        // 提升画质至 1080p（大多数 1080p 只有分离流，因此分离流合并也是刚需，在保证不过度重压且有 copy 加持下，速度依然很快）
        // 修正：强制要求 vcodec 为 avc1 (H.264)，音频为 m4a (AAC)，这是兼容性的黄金组合
        format: isMp3 ? 'bestaudio/best' : 'bestvideo[height<=1080][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best',
        downloadSections: `*${formatTime(start)}-${formatTime(end)}`,
        downloader: 'ffmpeg',
        downloaderArgs: 'ffmpeg:-c:v libx264 -c:a aac', // 下载时即尝试标准化
        noPlaylist: true,
        noCheckCertificates: true,
        noOverwrites: true,
      };

      if (!isMp3) {
        dlFlags.mergeOutputFormat = 'mp4';
      } else {
        dlFlags.extractAudio = true;
        dlFlags.audioFormat = 'mp3';
      }

      if (platform === 'youtube' && process.env.YOUTUBE_COOKIES) {
        const cookiePath = path.join(CLIPS_DIR, 'cookies_temp.txt');
        await fs.writeFile(cookiePath, process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n'));
        dlFlags.cookies = cookiePath;
      }

      await youtubedl(url, dlFlags);
      
      // 如果是在线下的 mp3，yt-dlp 就可以直接输出最后的成品了
      if (isMp3) {
        // 如果 extractAudio 成功，文件可能直接在 tempRawPath (.mp3). 如果是mp4需转一遍
        if (await fs.pathExists(tempRawPath.replace('.mp4', '.mp3'))) {
            await fs.move(tempRawPath.replace('.mp4', '.mp3'), outputPath);
            return outputPath;
        } else {
            await execAsync(`ffmpeg -y -i "${tempRawPath}" -vn -c:a libmp3lame -q:a 2 "${outputPath}"`);
            return outputPath;
        }
      }
      
      // 在线提取下处理硬字幕
      if (burnSubtitles && hasSubs && !isMp3) {
         console.log(`[Clipping] Burning subtitles...`);
         const srtContent = generateSrt(subtitles!, 0); // 在线切出来的本身就是从 0 开始的
         await fs.writeFile(srtPath, srtContent);
         const safeSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
         await execAsync(`ffmpeg -y -i "${tempRawPath}" -vf "subtitles=${safeSrtPath}:force_style='Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=10'" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k "${outputPath}"`);
         return outputPath;
      }
    }
 
    if (shouldMuxSubs && !isMp3 && !burnSubtitles) {
      // 在线拉取的 raw 往往时间戳已经是从 0 开始，所以不用减去 start
      const srtContent = generateSrt(subtitles!, hasLocalFullVideo ? start : 0);
      await fs.writeFile(srtPath, srtContent);
      console.log(`[Clipping] Muxing soft subtitles into ${outputPath}...`);
      await execAsync(`ffmpeg -y -i "${tempRawPath}" -i "${srtPath}" -c copy -c:s mov_text -metadata:s:s:0 language=chi -disposition:s:0 default "${outputPath}"`);
    } else if (!isMp3 && !burnSubtitles) {
      // 最终封装阶段：强制重编码为兼容性最高的 H.264 + YUV420P
      console.log(`[Clipping] Finalizing video with high-compatibility settings...`);
      await execAsync(`ffmpeg -y -i "${tempRawPath}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`);
    }

    return outputPath;
  } catch (error: any) {
    console.error(`❌ [Clipping] Failed:`, error.message);
    throw error;
  } finally {
    await fs.remove(tempRawPath).catch(() => {});
    await fs.remove(tempRawPath.replace('.mp4', '.mp3')).catch(() => {});
    await fs.remove(srtPath).catch(() => {});
  }
}

/**
 * 下载完整视频
 */
export async function downloadFullVideo({ videoId, url, platform, quality = '1080' }: { videoId: string, url: string, platform: string, quality?: string }): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);
  
  const outputPath = path.join(CLIPS_DIR, `${videoId}_full.mp4`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  try {
    let formatOption = 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best'; // 优先 H.264
    if (quality && quality !== 'best') {
      formatOption = `bestvideo[height<=${quality}][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best`;
    }

    const dlFlags: any = {
      output: outputPath,
      format: formatOption,
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
      const isHighRes = quality === '1440' || quality === '2160' || quality === 'best';
      if (isHighRes) {
        console.log(`[Full Download] High-res detected, transcoding to H.264 for compatibility...`);
        // 2K/4K 强制转码，确保 H.264 + YUV420P，否则微信无法播放
        await execAsync(`ffmpeg -y -i "${tempPath}" -c:v libx264 -preset superfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`);
      } else {
        await execAsync(`ffmpeg -y -i "${tempPath}" -c copy -movflags faststart "${outputPath}"`);
      }
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
