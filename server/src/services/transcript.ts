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
 * 回退策略: 英文系列 → 中文系列 → 自动检测 (取第一个)
 * @param videoId YouTube video ID
 * @returns 转录文本片段数组
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  // 更加详尽的语言回退列表，优先匹配中文和英文的各种变体
  const langs = ['en', 'zh' ,'zh-CN'];

  let lastError: any = null;
  let availableLangs: string[] = [];

  for (const lang of langs) {
    try {
      const label = lang ?? 'auto-detect';
      console.log(`[Transcript] Trying lang="${label}" for video: ${videoId}`);

      // 尝试从环境变量获取 Cookie (与 whisper.ts 保持一致)
      const cookieHeader = parseNetscapeCookies(process.env.YOUTUBE_COOKIES || '');

      // 如果有 Cookie，需要通过自定义 fetch 函数传入，因为 TranscriptConfig 不直接支持 headers
      const customFetch = cookieHeader
        ? async (params: any) => {
            const { url, lang: fetchLang, userAgent, method = 'GET', body, headers = {} } = params;
            const fetchHeaders: any = {
              'User-Agent': userAgent || USER_AGENT,
              ...(fetchLang && { 'Accept-Language': fetchLang }),
              ...headers,
              'Cookie': cookieHeader,
            };
            return fetch(url, { method, headers: fetchHeaders, body });
          }
        : undefined;

      const transcriptItems = await fetchYTTranscript(videoId, {
        lang,
        userAgent: USER_AGENT,
        videoFetch: customFetch,
        playerFetch: customFetch,
        transcriptFetch: customFetch,
      });

      if (transcriptItems && transcriptItems.length > 0) {
        console.log(`✅ [Transcript] Got ${transcriptItems.length} segments (lang=${label})`);
        return transcriptItems.map((item) => ({
          text: item.text,
          offset: Math.round(item.offset * 1000),   // 秒 → 毫秒
          duration: Math.round(item.duration * 1000), // 秒 → 毫秒
        }));
      }
    } catch (error: any) {
      lastError = error;
      const label = lang ?? 'auto-detect';

      // 如果报错中包含可用语言信息，记录下来以便后续分析
      if (error.availableLangs) {
        availableLangs = error.availableLangs;
      }

      console.warn(`[Transcript] Lang="${label}" failed: ${error.message}`);

      // 如果是 IP 被封锁，则没必要继续尝试其他语言了
      if (error.message.includes('too many requests') || error.message.includes('429')) {
        break;
      }
    }
  }

  // 如果遍历完所有语言都失败了
  const errorMsg = lastError?.message || 'Unknown error';
  const availableInfo = availableLangs.length > 0 ? ` Available languages: ${availableLangs.join(', ')}` : '';

  console.error(`❌ [Transcript] All attempts failed for ${videoId}.${availableInfo} Error: ${errorMsg}`);

  // 如果是因为 IP 限制，给出更具体的建议
  if (errorMsg.includes('too many requests') || errorMsg.includes('429')) {
    throw new Error(`YouTube 访问受限 (Too Many Requests)。线上环境建议在环境变量中配置 YOUTUBE_COOKIES 以绕过机器人检测。`);
  }

  throw new Error(`No transcript available for video ${videoId}.${availableInfo}`);
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
