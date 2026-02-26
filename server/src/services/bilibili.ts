import { TranscriptSegment } from './transcript.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * B站字幕 JSON 中的单条内容
 */
interface BilibiliSubtitleItem {
  from: number;      // 开始时间（秒）
  to: number;        // 结束时间（秒）
  sid: number;
  location: number;
  content: string;
}

interface BilibiliSubtitleInfo {
  lan: string;       // 如 "zh-CN", "en"
  lan_doc: string;   // 如 "中文（中国）"
  subtitle_url: string;
}

/**
 * 从 B 站 URL 中提取 BV 号
 * 支持格式:
 * - https://www.bilibili.com/video/BV1xx411c7mD
 * - https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=...
 * - https://b23.tv/xxx（短链，需要另外处理）
 */
export function extractBvid(url: string): string | null {
  const match = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * 通过 BV 号获取视频 cid
 */
async function getCid(bvid: string): Promise<number> {
  const url = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  const data: any = await res.json();

  if (data.code !== 0 || !data.data || data.data.length === 0) {
    throw new Error(`Failed to get cid for ${bvid}: ${data.message || 'Unknown error'}`);
  }

  return data.data[0].cid;
}

/**
 * 获取字幕列表
 */
async function getSubtitleList(bvid: string, cid: number): Promise<BilibiliSubtitleInfo[]> {
  const url = `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.bilibili.com',
    },
  });
  const data: any = await res.json();

  if (data.code !== 0) {
    console.log(`⚠️ Bilibili subtitle API returned code: ${data.code}, message: ${data.message}`);
    return [];
  }

  const subtitles = data.data?.subtitle?.subtitles || [];
  return subtitles.map((s: any) => ({
    lan: s.lan,
    lan_doc: s.lan_doc,
    subtitle_url: s.subtitle_url.startsWith('//') ? `https:${s.subtitle_url}` : s.subtitle_url,
  }));
}

/**
 * 下载并解析字幕 JSON
 */
async function downloadSubtitle(subtitleUrl: string): Promise<BilibiliSubtitleItem[]> {
  const res = await fetch(subtitleUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.bilibili.com',
    },
  });
  const data: any = await res.json();
  return data.body || [];
}

/**
 * 获取 B 站视频的字幕
 * 回退策略: 中文 → 英文 → 第一个可用的
 * @param bvid B站视频的 BV 号
 * @returns 转录文本片段数组
 */
export async function fetchBilibiliTranscript(bvid: string): Promise<TranscriptSegment[]> {
  console.log(`🔍 Fetching Bilibili transcript for: ${bvid}`);

  // 1. 获取 cid
  const cid = await getCid(bvid);
  console.log(`📋 Got cid: ${cid} for ${bvid}`);

  // 2. 获取字幕列表
  const subtitleList = await getSubtitleList(bvid, cid);
  console.log(`📝 Found ${subtitleList.length} subtitle tracks:`, subtitleList.map(s => s.lan_doc));

  if (subtitleList.length === 0) {
    throw new Error(`No subtitles available for Bilibili video: ${bvid}. 该视频可能没有 CC 字幕。`);
  }

  // 3. 选择最合适的字幕（优先中文 → 英文 → 第一个）
  const preferredLangs = ['zh-CN', 'zh-Hans', 'zh', 'en'];
  let selectedSubtitle: BilibiliSubtitleInfo | null = null;

  for (const lang of preferredLangs) {
    selectedSubtitle = subtitleList.find(s => s.lan === lang || s.lan.startsWith(lang)) || null;
    if (selectedSubtitle) break;
  }

  if (!selectedSubtitle) {
    selectedSubtitle = subtitleList[0];
  }

  console.log(`✅ Using subtitle: ${selectedSubtitle.lan_doc} (${selectedSubtitle.lan})`);

  // 4. 下载字幕内容
  const items = await downloadSubtitle(selectedSubtitle.subtitle_url);
  console.log(`✅ Got ${items.length} subtitle segments`);

  // 5. 转换为统一的 TranscriptSegment 格式
  return items.map((item) => ({
    text: item.content,
    offset: Math.round(item.from * 1000),           // 秒 → 毫秒
    duration: Math.round((item.to - item.from) * 1000), // 秒 → 毫秒
  }));
}
