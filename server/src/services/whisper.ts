import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import youtubedl from 'youtube-dl-exec';
import OpenAI from 'openai';
import { TranscriptSegment, cleanSubtitleText } from './transcript.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 本地开发缓存配置
const AUTH_CACHE_DIR = path.join(process.cwd(), 'cache', 'audio');
const IS_DEV = process.env.NODE_ENV !== 'production';


/**
 * 使用 Groq 的 Whisper-v3 极速接口识别小段音频（二进制直传，稳定性高，速度快）
 */
async function transcribeSegment(filePath: string, offsetMs: number): Promise<TranscriptSegment[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('未配置 GROQ_API_KEY');

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  console.log(`[ASR] Transcribing via Groq (Whisper-v3)... File: ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB)`);

  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    language: 'zh'
  });

  const segments = (response as any).segments || [];

  if (segments.length === 0 && (response as any).text) {
     return [{
       text: cleanSubtitleText((response as any).text),
       offset: offsetMs,
       duration: 0
     }];
  }

  return segments.map((seg: any) => ({
    text: cleanSubtitleText(seg.text),
    offset: Math.round(seg.start * 1000) + offsetMs,
    duration: Math.round((seg.end - seg.start) * 1000)
  }));
}


/**
 * 尝试下载视频纯音频，并通过 Groq ASR 进行转录
 */
export async function fallbackToWhisper(videoId: string, platform: 'youtube' | 'bilibili'): Promise<TranscriptSegment[]> {
  const url = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.bilibili.com/video/${videoId}`;

  const sessionId = `${videoId}_${Date.now()}`;
  const sessionDir = path.join(os.tmpdir(), sessionId);

  const tmpFile = path.join(sessionDir, `full_audio.m4a`);
  const cookieFile = path.join(sessionDir, `cookies.txt`);
  const cacheFile = path.join(AUTH_CACHE_DIR, `${videoId}.m4a`);

  try {
    await fs.ensureDir(sessionDir);
    if (IS_DEV) await fs.ensureDir(AUTH_CACHE_DIR);

    // 检查缓存
    if (IS_DEV && await fs.pathExists(cacheFile)) {
      console.log(`[ASR] Found cached audio for ${videoId}, skipping download.`);
      await fs.copy(cacheFile, tmpFile);
    } else {
      console.log(`[ASR] Downloading audio for ${platform} video: ${videoId}...`);

      const dlFlags: any = {
        extractAudio: true,
        audioFormat: 'm4a',
        format: 'worstaudio/bestaudio',
        output: tmpFile,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        addHeader: [
          'referer:https://www.youtube.com/',
          'accept-language:zh-CN,zh;q=0.9,en;q=0.8'
        ]
      };

      if (process.env.YOUTUBE_COOKIES && platform === 'youtube') {
        const cookieContent = process.env.YOUTUBE_COOKIES.replace(/\\n/g, '\n');
        await fs.writeFile(cookieFile, cookieContent);
        dlFlags.cookies = cookieFile;
      }

      await youtubedl(url, dlFlags);

      if (IS_DEV && await fs.pathExists(tmpFile)) {
        await fs.copy(tmpFile, cacheFile);
      }
    }

    if (!fs.existsSync(tmpFile)) {
      throw new Error(`[ASR] Audio file not found at ${tmpFile}`);
    }

    // --- 核心优化方案：并行转录 ---
    const segmentDuration = 240; // 4 分钟一段比较平衡
    const segmentPattern = path.join(sessionDir, 'seg_%03d.m4a');

    //打印文件大小
    const stats = await fs.stat(tmpFile);
    console.log(`[Whisper Fallback] Downloaded audio file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[ASR] Splitting audio into ${segmentDuration}s segments for Groq...`);
    await execAsync(`ffmpeg -i "${tmpFile}" -f segment -segment_time ${segmentDuration} -c copy "${segmentPattern}"`);

    const files = await fs.readdir(sessionDir);
    const segmentFiles = files.filter(f => f.startsWith('seg_')).sort();

    console.log(`[ASR] Starting parallel transcription for ${segmentFiles.length} segments...`);

    // 并发限制逻辑
    const CONCURRENCY = 4; // 同时处理 4 个分片
    const results: TranscriptSegment[][] = new Array(segmentFiles.length);

    // 任务队列处理函数
    const processBatch = async (indices: number[]) => {
      await Promise.all(indices.map(async (i) => {
        const filePath = path.join(sessionDir, segmentFiles[i]);
        const offsetMs = i * segmentDuration * 1000;

        let retryCount = 0;
        while (retryCount <= 2) {
          try {
            console.log(`[ASR] [Parallel] Processing Segment ${i + 1}/${segmentFiles.length}...`);
            results[i] = await transcribeSegment(filePath, offsetMs);
            break;
          } catch (err: any) {
            retryCount++;
            console.warn(`[ASR] Segment ${i + 1} failed (Attempt ${retryCount}): ${err.message}`);
            if (retryCount > 2) throw err;
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }));
    };

    // 分批次执行
    for (let i = 0; i < segmentFiles.length; i += CONCURRENCY) {
      const batchIndices = Array.from({ length: Math.min(CONCURRENCY, segmentFiles.length - i) }, (_, k) => i + k);
      await processBatch(batchIndices);
    }

    const finalTranscript = results.flat();
    console.log(`[ASR] All segments processed. Total: ${finalTranscript.length} segments.`);
    return finalTranscript;




  } catch (error: any) {
    console.error(`[Whisper Fallback Failed]`, error.message);
    throw error;
  } finally {
    await fs.remove(sessionDir).catch(() => {});
  }
}
