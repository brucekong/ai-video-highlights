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
 * 将 Netscape 格式的 Cookie 文本转化为 HTTP Header 中的 Cookie 字符串
 */
function parseNetscapeCookies(content: string): string {
  if (!content) return '';
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split('\t');
      if (parts.length >= 7) {
        return `${parts[5]}=${parts[6]}`;
      }
      return null;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * 获取 YouTube 视频的字幕/转录文本
 * 策略: 优先级列表尝试 -> 动态探测 fallback
 * @param videoId YouTube video ID
 * @returns 转录文本片段数组
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  // 1. 扩大首选语言尝试列表，涵盖 YouTube 常用的中文变体
  const preferredLangs = ['en','zh-CN', 'zh-Hans', 'zh', 'zh-Hant', 'zh-TW'];

  let lastError: any = null;
  let availableLangs: string[] = [];
  const triedLangs = new Set<string>();

  const tryLang = async (lang: string | undefined): Promise<TranscriptSegment[] | null> => {
    const label = lang ?? 'auto-detect';
    console.log(`[Transcript] Trying lang="${label}" for video: ${videoId}`);
    triedLangs.add(label);

    const attempt = async (useCookies: boolean) => {
      const cookieHeader = useCookies ? parseNetscapeCookies(process.env.YOUTUBE_COOKIES || '') : '';
      const customFetch = cookieHeader
        ? async (params: any) => {
            const { url, lang: fetchLang, userAgent, method = 'GET', headers = {} } = params;
            const fetchHeaders: any = {
              'User-Agent': userAgent || USER_AGENT,
              ...(fetchLang && { 'Accept-Language': fetchLang }),
              ...headers,
              'Cookie': cookieHeader,
            };
            return fetch(url, { method, headers: fetchHeaders });
          }
        : undefined;

      try {
        const transcriptItems = await fetchYTTranscript(videoId, {
          lang,
          userAgent: USER_AGENT,
          videoFetch: customFetch,
          playerFetch: customFetch,
          transcriptFetch: customFetch,
        });

        if (transcriptItems && transcriptItems.length > 0) {
          console.log(`✅ [Transcript] Got ${transcriptItems.length} segments (lang=${label}, cookies=${useCookies})`);
          return transcriptItems.map((item) => ({
            text: item.text,
            offset: Math.round(item.offset * 1000),
            duration: Math.round(item.duration * 1000),
          }));
        }
      } catch (error: any) {
        // 如果不带 Cookie 失败了，且我们还没尝试带 Cookie，则允许继续下一次 attempt
        if (!useCookies && process.env.YOUTUBE_COOKIES) {
          console.warn(`[Transcript] Fetch without cookies failed for ${label}, retrying with cookies...`);
          return null;
        }
        throw error;
      }
      return null;
    };

    try {
      // 策略：先尝试不带 Cookie (用户反馈不带 Cookie 反而容易成功)
      let result = await attempt(false);
      // 如果没有结果且有 Cookie 配置，尝试带 Cookie
      if (!result && process.env.YOUTUBE_COOKIES) {
        result = await attempt(true);
      }
      return result;
    } catch (error: any) {
      lastError = error;

      // 关键修复：从错误消息中解析可用语言 (格式: "Available languages: zh-Hans, en...")
      const match = error.message.match(/Available languages: ([^.]+)/);
      if (match && match[1]) {
        const foundLangs = match[1].split(',').map((l: string) => l.trim());
        availableLangs = Array.from(new Set([...availableLangs, ...foundLangs]));
      }

      // 如果视频本身不可用（被删或私密），标记后退出
      if (error.message.includes('is no longer available or has been removed') || error.message.includes('owner disabling captions or the video not supporting transcripts')) {
        console.warn(`[Transcript] Video ${videoId} is unavailable according to YouTube. Stopping fallback attempts.`);
      }

      console.warn(`[Transcript] Lang="${label}" failed: ${error.message}`);
      return null;
    }
  };

  // 2. 依次尝试首选语言
  for (const lang of preferredLangs) {
    // 关键提前判定：如果是致命错误 (429 或 视频不存在)，直接熔断，不再发起任何后续请求
    if (
      lastError?.message.includes('429') ||
      lastError?.message.includes('too many requests') ||
      lastError?.message.includes('is no longer available or has been removed')
    ) {
      throw lastError;
    }

    // 如果上一个请求已经返回了有哪些可用语种，直接停止盲目探测首选列表
    if (availableLangs.length > 0) {
      console.log(`[Transcript] Available languages already detected (${availableLangs.join(', ')}). Skipping further preferred list attempts.`);
      break;
    }

    const result = await tryLang(lang);
    if (result) return result;
  }

  // 3. 动态探测逻辑: 尝试列表中未曾尝试过的可用语言
  const remainingLangs = availableLangs.filter(l => !triedLangs.has(l));
  for (const fallbackLang of remainingLangs) {
    // 同样在动态探测开始前也要检查
    if (lastError?.message.includes('429') || lastError?.message.includes('too many requests')) {
      throw lastError;
    }

    const result = await tryLang(fallbackLang);
    if (result) return result;
  }

  // 4. 最终失败处理
  const errorMsg = lastError?.message || 'Unknown error';
  const availableInfo = availableLangs.length > 0 ? ` Available: ${availableLangs.join(', ')}` : '';

  if (errorMsg.includes('too many requests') || errorMsg.includes('429')) {
    throw new Error(`YouTube 访问受限 (429)。请在 .env 中更新 YOUTUBE_COOKIES。`);
  }

  throw new Error(`No transcript found for ${videoId}.${availableInfo}`);
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
