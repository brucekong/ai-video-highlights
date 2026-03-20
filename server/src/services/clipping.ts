import youtubedl from 'youtube-dl-exec';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 缓存目录
const CLIPS_DIR = path.join(process.cwd(), 'cache', 'clips');
const BURN_SUBTITLE_PAD_HEIGHT = 320;
const BURN_SUBTITLE_SIDE_MARGIN = 90;

interface SubtitleItem {
  text: string;
  translatedText?: string;
  offset: number;   // 毫秒
  duration: number; // 毫秒
}

interface SrtOptions {
  translatedOnly?: boolean;
}

function measureBurnTextWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += 0.45;
    } else if (/[\u4e00-\u9fa5]/.test(char)) {
      width += 2;
    } else if (/[A-Z]/.test(char)) {
      width += 1.15;
    } else {
      width += 1;
    }
  }
  return width;
}

function tokenizeMixedText(text: string): string[] {
  return text
    .match(/[\u4e00-\u9fa5]|[A-Za-z0-9']+|[^\s]/g)
    ?.filter(Boolean) || [];
}

function joinMixedTokens(tokens: string[]): string {
  let result = '';

  for (const token of tokens) {
    const needsSpace =
      result.length > 0 &&
      /[A-Za-z0-9']$/.test(result) &&
      /^[A-Za-z0-9']/.test(token);

    result += needsSpace ? ` ${token}` : token;
  }

  return result;
}

function findBestMixedBreakIndex(tokens: string[], targetWidth: number): number {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 1; i < tokens.length; i++) {
    const first = joinMixedTokens(tokens.slice(0, i));
    const second = joinMixedTokens(tokens.slice(i));
    const firstWidth = measureBurnTextWidth(first);
    const secondWidth = measureBurnTextWidth(second);

    if (firstWidth > targetWidth * 1.12 || secondWidth > targetWidth * 1.35) {
      continue;
    }

    let score = Math.abs(firstWidth - secondWidth);
    if (firstWidth < targetWidth * 0.72) score += 8;
    if (secondWidth < targetWidth * 0.45) score += 10;
    if (/[，。！？；：,.!?]$/.test(first)) score -= 2;
    if (/^[，。！？；：,.!?]/.test(second)) score += 8;
    if (/^[A-Za-z0-9']/.test(tokens[i]) && /[A-Za-z0-9']$/.test(tokens[i - 1])) score += 3;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex !== -1) {
    return bestIndex;
  }

  let accumWidth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tokenWidth = measureBurnTextWidth(tokens[i]);
    if (i > 0) {
      const preview = joinMixedTokens(tokens.slice(0, i + 1));
      accumWidth = measureBurnTextWidth(preview);
    } else {
      accumWidth = tokenWidth;
    }
    if (accumWidth >= targetWidth) {
      return Math.max(1, i);
    }
  }

  return Math.max(1, Math.floor(tokens.length / 2));
}

function layoutChineseTextForBurn(text: string, maxWidth: number = 20): string {
  const normalized = text.replace(/\s+/g, '').trim();
  if (!normalized) return normalized;

  const tokens = tokenizeMixedText(normalized);
  if (tokens.length < 2 || measureBurnTextWidth(joinMixedTokens(tokens)) <= maxWidth) {
    return joinMixedTokens(tokens);
  }

  const breakIndex = findBestMixedBreakIndex(tokens, maxWidth);
  return `${joinMixedTokens(tokens.slice(0, breakIndex))}\n${joinMixedTokens(tokens.slice(breakIndex))}`;
}

function formatSubtitleTextForBurn(text: string): string {
  const normalized = text.trim();
  if (!normalized) return normalized;

  const chineseCount = (normalized.match(/[\u4e00-\u9fa5]/g) || []).length;
  const isMostlyChinese = chineseCount >= Math.max(4, Math.floor(normalized.length / 3));
  if (!isMostlyChinese) {
    return normalized;
  }

  return layoutChineseTextForBurn(normalized, 20);
}

function mergeSubtitlesForExport(subtitles: SubtitleItem[]): SubtitleItem[] {
  const normalized = subtitles.filter((s) => (s.text || '').trim() || (s.translatedText || '').trim());
  if (normalized.length === 0) return [];

  const merged: SubtitleItem[] = [];
  let current: SubtitleItem | null = null;

  for (const seg of normalized) {
    if (!current) {
      current = { ...seg };
      continue;
    }

    const lastChar = (current.text || '').trim().slice(-1);
    const hasEndingPunctuation = /[.?!。？！]/.test(lastChar);
    const currentDuration = current.duration || 0;
    const combinedDuration = (seg.offset + seg.duration) - current.offset;

    let shouldMerge = false;
    if (!hasEndingPunctuation) {
      shouldMerge = combinedDuration < 28000;
    } else {
      shouldMerge = currentDuration < 3500 && combinedDuration < 10000;
    }

    if (!shouldMerge) {
      merged.push(current);
      current = { ...seg };
      continue;
    }

    const isChinese = /[\u4e00-\u9fa5]/.test(seg.text);
    const lastTextChar = (current.text || '').trim().slice(-1);
    const hasAnyPunc = /[.,?!，。？！、;；]/.test(lastTextChar);
    const textSep = hasAnyPunc ? ' ' : (isChinese ? '，' : ' ');
    current.text = `${(current.text || '').trim()}${textSep}${(seg.text || '').trim()}`.trim();

    if (seg.translatedText) {
      const lastTransChar = (current.translatedText || '').trim().slice(-1);
      const hasTransPunc = /[.,?!，。？！、;；]/.test(lastTransChar);
      const transSep = current.translatedText && !hasTransPunc ? '，' : '';
      current.translatedText = `${(current.translatedText || '').trim()}${transSep}${seg.translatedText.trim()}`.trim();
    }

    current.duration = combinedDuration;
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

interface FullDownloadOptions {
  videoId: string;
  title?: string;
  url: string;
  platform: string;
  quality?: string;
  subtitles?: SubtitleItem[];
  subtitlesAreCues?: boolean;
  language?: string;
}

/**
 * 过滤文件名非法字符
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

interface ClipOptions {
  videoId: string;
  title?: string;
  url: string;
  start: number;      // 秒
  duration: number;   // 秒
  platform: string;
  subtitles?: SubtitleItem[];
  subtitlesAreCues?: boolean;
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
function generateSrt(subtitles: SubtitleItem[], startTimeSec: number, options: SrtOptions = {}): string {
  return subtitles
    .map((s, i) => {
      const start = (s.offset / 1000) - startTimeSec;
      const rawEnd = ((s.offset + s.duration) / 1000) - startTimeSec;
      const nextStart = i < subtitles.length - 1
        ? (subtitles[i + 1].offset / 1000) - startTimeSec
        : rawEnd;
      // 避免相邻字幕时间重叠，导致画面上同时出现两条中文字幕
      const end = Math.max(start + 0.1, Math.min(rawEnd, nextStart - 0.05));
      
      // 过滤掉不在片段范围内的字幕
      if (end <= 0 || end <= start) return null;

      const rawText = options.translatedOnly
        ? (s.translatedText || s.text)
        : (s.translatedText ? `${s.translatedText}\n${s.text}` : s.text);
      const text = options.translatedOnly
        ? formatSubtitleTextForBurn(rawText)
        : rawText;
        
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildHardSubtitleFilter(srtPath: string): string {
  const safeSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const padFilter = `setpts=PTS-STARTPTS,pad=iw:ih+${BURN_SUBTITLE_PAD_HEIGHT}:0:0:color=black`;
  const fontName = process.env.SUBTITLE_FONT
    || (process.platform === 'darwin' ? 'PingFang SC' : process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC');
  const fontsDir = process.platform === 'darwin'
    ? '/System/Library/Fonts'
    : process.platform === 'win32'
      ? 'C\\\\:/Windows/Fonts'
      : '/usr/share/fonts';
  const subStyle = `FontName=${fontName},Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=34,MarginL=${BURN_SUBTITLE_SIDE_MARGIN},MarginR=${BURN_SUBTITLE_SIDE_MARGIN},Alignment=2`;
  return `${padFilter},subtitles=${safeSrtPath}:fontsdir=${fontsDir}:force_style='${subStyle}'`;
}

function getSubtitleFontFile(): string {
  if (process.env.SUBTITLE_FONT_FILE) {
    return process.env.SUBTITLE_FONT_FILE;
  }

  if (process.platform === 'darwin') {
    return '/System/Library/Fonts/PingFang.ttc';
  }

  if (process.platform === 'win32') {
    return 'C\\\\:/Windows/Fonts/msyh.ttc';
  }

  return '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
}

function escapeDrawtextPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function escapeDrawtextText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

async function findCachedFullVideoPath(videoId: string): Promise<string | null> {
  const preferredLegacyPath = path.join(CLIPS_DIR, `${videoId}_full.mp4`);
  if (await fs.pathExists(preferredLegacyPath)) {
    return preferredLegacyPath;
  }

  const files = await fs.readdir(CLIPS_DIR).catch(() => []);
  const match = files.find((file) =>
    file.includes(`_${videoId}_full_`) && file.endsWith('.mp4')
  );

  return match ? path.join(CLIPS_DIR, match) : null;
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
export async function createVideoClip({ videoId, title = 'clip', url, start, duration, platform, subtitles, subtitlesAreCues = false, language, format = 'mp4', burnSubtitles = false }: ClipOptions): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);
  
  const end = start + duration;
  const hasSubs = subtitles && subtitles.length > 0;
  const mergedSubtitles = subtitlesAreCues
    ? (subtitles || []).filter((s) => (s.text || '').trim() || (s.translatedText || '').trim())
    : mergeSubtitlesForExport(subtitles || []);
  const hasTranslatedSubs = mergedSubtitles.some((s) => s.translatedText && s.translatedText.trim());
  // 英文视频切片统一输出中文字幕硬字幕
  const shouldBurnTranslatedSubtitles = format === 'mp4' && language !== 'zh' && hasTranslatedSubs;
  const isMp3 = format === 'mp3';
  
  // 生成更友好的缓存文件名
  const safeTitle = sanitizeFilename(title);
  const clipId = `${safeTitle}_${videoId}_${Math.floor(start)}_${Math.floor(duration)}${shouldBurnTranslatedSubtitles ? '_burned_zh_v21' : ''}${burnSubtitles && !shouldBurnTranslatedSubtitles ? '_burned' : ''}${isMp3 ? '_mp3' : ''}`;
  const ext = isMp3 ? 'mp3' : 'mp4';
  const outputPath = path.join(CLIPS_DIR, `${clipId}.${ext}`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  // ==== 优化 1：尝试寻找本地是否存在完整版视频文件 ====
  const fullVideoPath = await findCachedFullVideoPath(videoId);
  const hasLocalFullVideo = Boolean(fullVideoPath);
  
  const tempRawPath = path.join(os.tmpdir(), `raw_${clipId}.mp4`);
  const srtPath = path.join(os.tmpdir(), `${clipId}.srt`);
  const subtitleWorkdir = path.join(os.tmpdir(), `subtitle_drawtext_${clipId}`);

  try {
    await fs.ensureDir(subtitleWorkdir);
    if (hasLocalFullVideo) {
      console.log(`[Clipping] Found local full video, fast seeking...`);
      if (isMp3) {
        await execAsync(`ffmpeg -y -ss ${start} -i "${fullVideoPath}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${outputPath}"`);
        return outputPath;
      }
      
      if (shouldBurnTranslatedSubtitles) {
        const srtContent = generateSrt(mergedSubtitles, start, { translatedOnly: true });
        await fs.writeFile(srtPath, srtContent);
        const vfFilter = buildHardSubtitleFilter(srtPath);
        await execAsync(`ffmpeg -y -ss ${start} -i "${fullVideoPath}" -t ${duration} -vf "${vfFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k "${outputPath}"`);
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
      if (shouldBurnTranslatedSubtitles) {
        console.log(`[Clipping] Burning translated subtitles...`);
        const srtContent = generateSrt(mergedSubtitles, start, { translatedOnly: true });
        await fs.writeFile(srtPath, srtContent);
        const vfFilter = buildHardSubtitleFilter(srtPath);
        await execAsync(`ffmpeg -y -i "${tempRawPath}" -vf "${vfFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k "${outputPath}"`);
        return outputPath;
      }
    }
 
    if (!isMp3 && !shouldBurnTranslatedSubtitles) {
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
    await fs.remove(subtitleWorkdir).catch(() => {});
  }
}

/**
 * 下载完整视频
 */
export async function downloadFullVideo({
  videoId,
  title = 'video',
  url,
  platform,
  quality = '1080',
  subtitles,
  subtitlesAreCues = false,
  language,
}: FullDownloadOptions): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);

  const safeTitle = sanitizeFilename(title);
  const hasTranslatedSubs = Boolean(
    subtitles?.some((s) => s.translatedText && s.translatedText.trim())
  );
  const shouldBurnSubtitles = language !== 'zh' && hasTranslatedSubs;
  const mergedSubtitles = subtitlesAreCues
    ? (subtitles || []).filter((s) => (s.text || '').trim() || (s.translatedText || '').trim())
    : mergeSubtitlesForExport(subtitles || []);
  const outputPath = path.join(
    CLIPS_DIR,
    `${safeTitle}_${videoId}_full_${quality}${shouldBurnSubtitles ? '_burned_zh_v21' : ''}.mp4`
  );

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  const rawPath = path.join(CLIPS_DIR, `${videoId}_full_${quality}_raw.mp4`);
  const preparedPath = path.join(CLIPS_DIR, `${videoId}_full_${quality}_prepared.mp4`);
  const srtPath = path.join(os.tmpdir(), `${videoId}_full_${quality}.srt`);

  try {
    let formatOption = 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best'; // 优先 H.264
    if (quality && quality !== 'best') {
      formatOption = `bestvideo[height<=${quality}][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best`;
    }

    const dlFlags: any = {
      output: rawPath,
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

    console.log(`[Full Download] Downloading ${url} to ${rawPath}...`);
    await youtubedl(url, dlFlags);

    if (await fs.pathExists(rawPath)) {
      const isHighRes = quality === '1440' || quality === '2160' || quality === 'best';
      if (isHighRes) {
        console.log(`[Full Download] High-res detected, transcoding to H.264 for compatibility...`);
        // 2K/4K 强制转码，确保 H.264 + YUV420P，否则微信无法播放
        await execAsync(`ffmpeg -y -i "${rawPath}" -c:v libx264 -preset superfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${preparedPath}"`);
      } else {
        await execAsync(`ffmpeg -y -i "${rawPath}" -c copy -movflags faststart "${preparedPath}"`);
      }
    }

    if (shouldBurnSubtitles && mergedSubtitles.length > 0) {
      const srtContent = generateSrt(mergedSubtitles, 0, { translatedOnly: true });
      await fs.writeFile(srtPath, srtContent);
      const vfFilter = buildHardSubtitleFilter(srtPath);
      console.log(`[Full Download] Burning translated subtitles into ${outputPath}...`);
      await execAsync(`ffmpeg -y -i "${preparedPath}" -vf "${vfFilter}" -c:v libx264 -preset superfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`);
    } else {
      await fs.move(preparedPath, outputPath, { overwrite: true });
    }

    return outputPath;
  } catch (error: any) {
    console.error(`❌ [Full Download] Failed:`, error.message);
    throw error;
  } finally {
    await fs.remove(rawPath).catch(() => {});
    await fs.remove(preparedPath).catch(() => {});
    await fs.remove(srtPath).catch(() => {});
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
