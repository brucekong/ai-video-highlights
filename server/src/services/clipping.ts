import youtubedl from 'youtube-dl-exec';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { downloadWithYtDlpFallback, resolveFfmpegLocation } from './ytdlp.js';

const execAsync = (cmd: string) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(cmd, { shell: true });
  let errorMsg = '';
  
  child.stderr.on('data', (data) => {
    errorMsg += data.toString();
    if (errorMsg.length > 5000) {
      errorMsg = errorMsg.slice(-5000);
    }
  });

  child.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(`Command failed with code ${code}:\n${errorMsg}`));
    } else {
      resolve({ stdout: '', stderr: '' });
    }
  });
  
  child.on('error', (err) => {
    reject(err);
  });
});

// 缓存目录
const CLIPS_DIR = path.join(process.cwd(), 'cache', 'clips');
const BURN_SUBTITLE_PAD_HEIGHT = 320;
const BURN_SUBTITLE_SIDE_MARGIN = 90;
const BURN_SUBTITLE_REFERENCE_WIDTH = 1080;
const BURN_SUBTITLE_FONT_SIZE = 18;

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

    if (firstWidth > targetWidth * 1.18 || secondWidth > targetWidth * 1.42) {
      continue;
    }

    let score = Math.abs(firstWidth - secondWidth);
    if (firstWidth < targetWidth * 0.66) score += 10;
    if (secondWidth < targetWidth * 0.4) score += 12;

    // Favor the common short-video rhythm: shorter first line, longer second line.
    // Penalize "top heavy" layouts where the first line is noticeably wider.
    if (firstWidth > secondWidth) {
      score += (firstWidth - secondWidth) * 1.8;
    } else {
      score -= Math.min(secondWidth - firstWidth, 6) * 0.6;
    }

    // Avoid extremes: first line too packed, or second line too tiny.
    if (firstWidth > targetWidth * 0.96) score += 8;
    if (secondWidth < targetWidth * 0.52) score += 6;

    // Strongly prefer breaking after punctuation, and avoid starting a line
    // with punctuation marks.
    if (/[，。！？；：,.!?]$/.test(first)) score -= 12;
    if (/[、，；：]$/.test(first)) score -= 4;
    if (/^[，。！？；：,.!?]/.test(second)) score += 16;

    // Avoid awkward splits inside English word groups when possible.
    if (/^[A-Za-z0-9']/.test(tokens[i]) && /[A-Za-z0-9']$/.test(tokens[i - 1])) score += 6;
    if (/^(了|吗|呢|呀|啊|吧)$/.test(tokens[i])) score += 6;
    if (/^(和|与|及|并且|但是|所以|因为)$/.test(tokens[i])) score += 5;

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

function getBurnSubtitleMaxWidth(text: string): number {
  const hasLatin = /[A-Za-z]/.test(text);
  if (!hasLatin) {
    // Chinese characters are measured as width 2 in `measureBurnTextWidth`,
    // so a wider single-line target of ~24 Han chars needs about 48 units.
    return 48;
  }

  const referenceUsableWidth = BURN_SUBTITLE_REFERENCE_WIDTH - BURN_SUBTITLE_SIDE_MARGIN * 2;
  const estimatedUnitWidth = BURN_SUBTITLE_FONT_SIZE * 1.25;

  // Keep mixed/Latin subtitles slightly more conservative, while allowing
  // mostly-Chinese lines to stay on one row up to about 20 chars.
  return Math.max(22, Math.min(30, Math.round(referenceUsableWidth / estimatedUnitWidth)));
}

function layoutChineseTextForBurn(text: string, maxWidth: number = getBurnSubtitleMaxWidth(text)): string {
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

  return layoutChineseTextForBurn(normalized, getBurnSubtitleMaxWidth(normalized));
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

    const lastTextChar = (current.text || '').trim().slice(-1);
    const hasAnyPunc = /[.,?!，。？！、;；]/.test(lastTextChar);
    const textSep = hasAnyPunc ? ' ' : '';
    current.text = `${(current.text || '').trim()}${textSep}${(seg.text || '').trim()}`.trim();

    if (seg.translatedText) {
      const lastTransChar = (current.translatedText || '').trim().slice(-1);
      const hasTransPunc = /[.,?!，。？！、;；]/.test(lastTransChar);
      const transSep = current.translatedText && !hasTransPunc ? '' : '';
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
  quality?: '1080' | '1440' | '2160' | 'best';
  subtitles?: SubtitleItem[];
  subtitlesAreCues?: boolean;
  language?: string;
}

interface SourceVideoOptions {
  videoId: string;
  title?: string;
  url: string;
  platform: string;
  quality?: '1080' | '1440' | '2160' | 'best';
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
  quality?: '1080' | '1440' | '2160' | 'best';
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
  let fontsDir = '';
  const localFontsDir = path.join(process.cwd(), 'fonts');
  if (fs.existsSync(localFontsDir)) {
    fontsDir = localFontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');
  } else {
    fontsDir = process.platform === 'darwin'
      ? '/System/Library/Fonts'
      : process.platform === 'win32'
        ? 'C\\\\:/Windows/Fonts'
        : '/usr/share/fonts';
  }
  const subStyle = `FontName=${fontName},Fontsize=${BURN_SUBTITLE_FONT_SIZE},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=34,MarginL=${BURN_SUBTITLE_SIDE_MARGIN},MarginR=${BURN_SUBTITLE_SIDE_MARGIN},Alignment=2`;
  return `${padFilter},subtitles=${safeSrtPath}:fontsdir=${fontsDir}:force_style='${subStyle}'`;
}

const DEFAULT_WATERMARK_TEXT = '@慢速英语动画';
const DEFAULT_WATERMARK_ALPHA = 0.5;
const DEFAULT_WATERMARK_MARGIN = 28;
const WATERMARK_VERSION = 'wm_v1';
const CLIP_PIPELINE_VERSION = 'clip_v5';

function buildWatermarkFilter(): string {
  const fontFile = escapeDrawtextPath(getSubtitleFontFile());
  const text = escapeDrawtextText(DEFAULT_WATERMARK_TEXT);
  return `drawtext=fontfile='${fontFile}':text='${text}':fontcolor=white@${DEFAULT_WATERMARK_ALPHA}:fontsize=24:x=w-text_w-${DEFAULT_WATERMARK_MARGIN}:y=${DEFAULT_WATERMARK_MARGIN}`;
}

function appendWatermarkFilter(baseFilter?: string): string {
  const watermarkFilter = buildWatermarkFilter();
  return baseFilter ? `${baseFilter},${watermarkFilter}` : watermarkFilter;
}

export function getSubtitleFontFile(): string {
  if (process.env.SUBTITLE_FONT_FILE) {
    return process.env.SUBTITLE_FONT_FILE;
  }

  const localFontTtc = path.join(process.cwd(), 'fonts', 'PingFang.ttc');
  const localFontTtf = path.join(process.cwd(), 'fonts', 'PingFang.ttf');
  if (fs.existsSync(localFontTtc)) {
    return localFontTtc;
  }
  if (fs.existsSync(localFontTtf)) {
    return localFontTtf;
  }

  if (process.platform === 'darwin') {
    let assetsPingFangPath = '';
    const assetsDir = '/System/Library/AssetsV2';
    if (fs.existsSync(assetsDir)) {
      try {
        const subDirs = fs.readdirSync(assetsDir);
        for (const subDir of subDirs) {
          if (subDir.includes('MobileAsset_Font')) {
            const fontParent = path.join(assetsDir, subDir);
            const hashDirs = fs.readdirSync(fontParent);
            for (const hashDir of hashDirs) {
              const testPath = path.join(fontParent, hashDir, 'AssetData', 'PingFang.ttc');
              if (fs.existsSync(testPath)) {
                assetsPingFangPath = testPath;
                break;
              }
            }
          }
          if (assetsPingFangPath) break;
        }
      } catch (e) {
        // ignore
      }
    }

    const candidatePaths = [
      '/System/Library/Fonts/PingFang.ttc',
      '/Library/Fonts/PingFang.ttc',
      assetsPingFangPath,
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
    ];

    for (const p of candidatePaths) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
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

async function findCachedFullVideoPath(
  videoId: string,
  quality?: '1080' | '1440' | '2160' | 'best',
): Promise<string | null> {
  const preferredLegacyPath = path.join(CLIPS_DIR, `${videoId}_full.mp4`);
  if ((!quality || quality === '1080') && await fs.pathExists(preferredLegacyPath)) {
    return preferredLegacyPath;
  }

  const files = await fs.readdir(CLIPS_DIR).catch(() => []);

  const isMatch = (file: string, targetQuality?: string) => {
    if (!file.endsWith('.mp4')) return false;
    if (file.endsWith('_raw.mp4') || file.endsWith('_prepared.mp4')) return false;

    const hasVideoId =
      file.includes(`_${videoId}_full_`) ||
      file.includes(`_${videoId}_source_`) ||
      file.startsWith(`${videoId}_full_`) ||
      file.startsWith(`${videoId}_source_`);

    if (!hasVideoId) return false;

    if (targetQuality) {
      return file.includes(`_${targetQuality}.`) || file.includes(`_${targetQuality}_`);
    }
    return true;
  };

  if (quality) {
    const exactMatch = files.find((file) => isMatch(file, quality));
    if (exactMatch) {
      return path.join(CLIPS_DIR, exactMatch);
    }

    // When the user explicitly requests a quality, do not silently fall back
    // to another cached resolution (for example reuse a 1440p full cache for
    // a 2160p clip request). Missing exact cache should trigger a fresh fetch.
    return null;
  }
  const match = files.find((file) => isMatch(file));

  return match ? path.join(CLIPS_DIR, match) : null;
}

function buildPreferredVideoFormat(quality: '1080' | '1440' | '2160' | 'best' = '1080'): string {
  if (quality === 'best') {
    return 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best';
  }

  return `bestvideo[height<=${quality}][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/best`;
}

async function ensureClipSourceVideo({
  videoId,
  title = 'video',
  url,
  platform,
  quality = '1080',
}: SourceVideoOptions): Promise<string> {
  const cachedFullVideoPath = await findCachedFullVideoPath(videoId, quality);
  if (cachedFullVideoPath) {
    return cachedFullVideoPath;
  }

  const safeTitle = sanitizeFilename(title);
  const sourcePath = path.join(CLIPS_DIR, `${safeTitle}_${videoId}_source_${quality}.mp4`);
  if (await fs.pathExists(sourcePath)) {
    return sourcePath;
  }

  const rawPath = path.join(CLIPS_DIR, `${videoId}_source_${quality}_raw.mp4`);

  try {
    const dlFlags: Record<string, any> = {
      output: rawPath,
      format: buildPreferredVideoFormat(quality),
      mergeOutputFormat: 'mp4',
      noPlaylist: true,
      noCheckCertificates: true,
      noOverwrites: true,
    };

    console.log(`[Clipping] No cached full/source video found, downloading full source for ${videoId}...`);
    await downloadWithYtDlpFallback(youtubedl, url, dlFlags, {
      cookieContents: process.env.YOUTUBE_COOKIES,
      cookieFile: path.join(CLIPS_DIR, 'cookies_temp.txt'),
      context: `clip source download for ${videoId}`,
      isYoutube: platform === 'youtube',
    });

    // Normalize audio timestamps once on the reusable source asset. We keep the
    // video bitstream as-is to avoid a full transcode, but rebuild the audio
    // track so later local trims do not inherit broken/short audio indexes.
    await execAsync(`ffmpeg -y -fflags +genpts -i "${rawPath}" -map 0:v:0 -map 0:a:0? -c:v copy -c:a aac -b:a 192k -af "aresample=async=1:first_pts=0" -movflags +faststart "${sourcePath}"`);

    await fs.remove(rawPath).catch(() => {});
    return sourcePath;
  } catch (error) {
    await fs.remove(sourcePath).catch(() => {});
    throw error;
  }
}

/**
 * 核心剪辑函数
 */
export async function createVideoClip({
  videoId,
  title = 'clip',
  url,
  start,
  duration,
  platform,
  subtitles,
  subtitlesAreCues = false,
  language,
  quality = '1080',
  format = 'mp4',
  burnSubtitles = false,
}: ClipOptions): Promise<string> {
  await fs.ensureDir(CLIPS_DIR);

  const mergedSubtitles = subtitlesAreCues
    ? (subtitles || []).filter((s) => (s.text || '').trim() || (s.translatedText || '').trim())
    : mergeSubtitlesForExport(subtitles || []);
  const hasTranslatedSubs = mergedSubtitles.some((s) => s.translatedText && s.translatedText.trim());
  // 英文视频切片统一输出中文字幕硬字幕
  const shouldBurnTranslatedSubtitles = format === 'mp4' && language !== 'zh' && hasTranslatedSubs;
  const shouldBurnRequestedSubtitles = format === 'mp4' && burnSubtitles && mergedSubtitles.length > 0;
  const shouldBurnAnySubtitles = shouldBurnTranslatedSubtitles || shouldBurnRequestedSubtitles;
  const isMp3 = format === 'mp3';

  // 生成更友好的缓存文件名
  const safeTitle = sanitizeFilename(title);
  const clipId = `${safeTitle}_${videoId}_${Math.floor(start)}_${Math.floor(duration)}_${quality}${shouldBurnTranslatedSubtitles ? '_burned_zh_v21' : ''}${shouldBurnRequestedSubtitles && !shouldBurnTranslatedSubtitles ? '_burned' : ''}${isMp3 ? '_mp3' : ''}_${CLIP_PIPELINE_VERSION}_${WATERMARK_VERSION}`;
  const ext = isMp3 ? 'mp3' : 'mp4';
  const outputPath = path.join(CLIPS_DIR, `${clipId}.${ext}`);

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  const tempRawPath = path.join(os.tmpdir(), `raw_${clipId}.mp4`);
  const srtPath = path.join(os.tmpdir(), `${clipId}.srt`);
  const subtitleWorkdir = path.join(os.tmpdir(), `subtitle_drawtext_${clipId}`);

  try {
    await fs.ensureDir(subtitleWorkdir);
    const ffmpegLocation = resolveFfmpegLocation();
    if (!ffmpegLocation) {
      throw new Error('当前运行环境未安装 ffmpeg，无法执行视频切片。请先安装 ffmpeg 或配置 FFMPEG_PATH。');
    }

    const sourceVideoPath = await ensureClipSourceVideo({
      videoId,
      title,
      url,
      platform,
      quality,
    });

    console.log(`[Clipping] Cutting locally from source video: ${sourceVideoPath}`);
    if (isMp3) {
      await execAsync(`ffmpeg -y -ss ${start} -i "${sourceVideoPath}" -t ${duration} -vn -c:a libmp3lame -q:a 2 "${outputPath}"`);
      return outputPath;
    }

    // First produce a local clip with normalized timestamps. Burning subtitles
    // directly while trimming from the source can desync ASS/SRT timing on some
    // sources even when the rendered result "looks" successful in single-frame tests.
    await execAsync(`ffmpeg -y -i "${sourceVideoPath}" -ss ${start} -t ${duration} -map 0:v:0 -map 0:a:0? -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -af "aresample=async=1:first_pts=0" -movflags +faststart "${tempRawPath}"`);

    if (shouldBurnAnySubtitles) {
      const srtContent = generateSrt(mergedSubtitles, start, {
        translatedOnly: shouldBurnTranslatedSubtitles,
      });
      await fs.writeFile(srtPath, srtContent);
      const vfFilter = appendWatermarkFilter(buildHardSubtitleFilter(srtPath));
      console.log(`[Clipping] Burning ${shouldBurnTranslatedSubtitles ? 'translated' : 'original/bilingual'} subtitles into clip output...`);
      await execAsync(`ffmpeg -y -i "${tempRawPath}" -map 0:v:0 -map 0:a:0? -vf "${vfFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -af "aresample=async=1:first_pts=0" -movflags +faststart "${outputPath}"`);
      return outputPath;
    }

    // 最终封装阶段：强制重编码为兼容性最高的 H.264 + YUV420P
    console.log(`[Clipping] Finalizing video with high-compatibility settings...`);
    const vfFilter = appendWatermarkFilter();
    await execAsync(`ffmpeg -y -i "${tempRawPath}" -map 0:v:0 -map 0:a:0? -vf "${vfFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -af "aresample=async=1:first_pts=0" -movflags +faststart "${outputPath}"`);

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
    `${safeTitle}_${videoId}_full_${quality}${shouldBurnSubtitles ? '_burned_zh_v21' : ''}_${WATERMARK_VERSION}.mp4`
  );

  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  const rawPath = path.join(CLIPS_DIR, `${videoId}_full_${quality}_raw.mp4`);
  const preparedPath = path.join(CLIPS_DIR, `${videoId}_full_${quality}_prepared.mp4`);
  const srtPath = path.join(os.tmpdir(), `${videoId}_full_${quality}.srt`);

  try {
    const dlFlags: any = {
      output: rawPath,
      format: buildPreferredVideoFormat(quality),
      mergeOutputFormat: 'mp4',
      noOverwrites: true,
    };

    console.log(`[Full Download] Downloading ${url} to ${rawPath}...`);
    await downloadWithYtDlpFallback(youtubedl, url, dlFlags, {
      cookieContents: process.env.YOUTUBE_COOKIES,
      cookieFile: path.join(CLIPS_DIR, 'cookies_temp.txt'),
      context: `full download for ${videoId}`,
      isYoutube: platform === 'youtube',
    });

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
      const vfFilter = appendWatermarkFilter(buildHardSubtitleFilter(srtPath));
      console.log(`[Full Download] Burning translated subtitles into ${outputPath}...`);
      await execAsync(`ffmpeg -y -i "${preparedPath}" -vf "${vfFilter}" -c:v libx264 -preset superfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`);
    } else {
      const vfFilter = appendWatermarkFilter();
      await execAsync(`ffmpeg -y -i "${preparedPath}" -vf "${vfFilter}" -c:v libx264 -preset superfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`);
    }

    await fs.remove(rawPath).catch(() => {});
    await fs.remove(preparedPath).catch(() => {});
    await fs.remove(srtPath).catch(() => {});
    
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
