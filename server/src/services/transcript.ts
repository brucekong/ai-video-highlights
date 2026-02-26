import { fetchTranscript as fetchYTTranscript } from 'youtube-transcript-plus';

export interface TranscriptSegment {
  text: string;
  offset: number;   // 毫秒
  duration: number;  // 毫秒
}

// 模拟真实浏览器的 User-Agent，避免被 YouTube 封锁
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 获取 YouTube 视频的字幕/转录文本
 * 回退策略: 中文 → 英文 → 自动检测
 * @param videoId YouTube video ID
 * @returns 转录文本片段数组
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  const langs = ['zh', 'en', undefined]; // 回退语言列表

  for (const lang of langs) {
    try {
      const label = lang ?? 'auto-detect';
      console.log(`Trying transcript with lang="${label}" for video: ${videoId}`);

      const transcriptItems = await fetchYTTranscript(videoId, {
        lang,
        userAgent: USER_AGENT,
      });

      if (transcriptItems && transcriptItems.length > 0) {
        console.log(`✅ Got ${transcriptItems.length} segments (lang=${label})`);
        return transcriptItems.map((item) => ({
          text: item.text,
          offset: Math.round(item.offset * 1000),   // 秒 → 毫秒
          duration: Math.round(item.duration * 1000), // 秒 → 毫秒
        }));
      }
    } catch (error: any) {
      const label = lang ?? 'auto-detect';
      console.log(`❌ Transcript lang="${label}" failed: ${error.message}`);
    }
  }

  throw new Error(`No transcript available for video: ${videoId}`);
}

/**
 * 将转录片段拼接成完整的带时间标记的文本
 */
export function formatTranscriptForAI(segments: TranscriptSegment[]): string {
  return segments.map((seg) => {
    const seconds = Math.floor(seg.offset / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timeLabel = `[${minutes}:${secs.toString().padStart(2, '0')}]`;
    return `${timeLabel} ${seg.text}`;
  }).join('\n');
}
