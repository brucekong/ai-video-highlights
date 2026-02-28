import axios from 'axios';
import { extractBvid } from './bilibili.js';

interface VideoMetadata {
  title: string;
  author: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 获取 YouTube 视频的简略信息 (通过 oEmbed)
 */
async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = res.data;

    return {
      title: data.title || '',
      author: data.author_name || '',
    };
  } catch (error: any) {
    console.warn(`[Metadata] Failed to fetch YouTube oEmbed for ${videoId}: ${error.message}`);
    return { title: '', author: '' };
  }
}

/**
 * 获取 Bilibili 视频的简略信息
 */
async function fetchBilibiliMetadata(bvid: string): Promise<VideoMetadata> {
  try {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = res.data?.data;

    if (!data) return { title: '', author: '' };

    return {
      title: data.title || '',
      author: data.owner?.name || '',
    };
  } catch (error: any) {
    console.warn(`[Metadata] Failed to fetch Bilibili info for ${bvid}: ${error.message}`);
    return { title: '', author: '' };
  }
}

/**
 * 统一获取视频元数据（标题、作者）
 */
export async function fetchVideoMetadata(videoId: string, platform: 'youtube' | 'bilibili'): Promise<VideoMetadata> {
  if (platform === 'youtube') {
    return fetchYouTubeMetadata(videoId);
  } else {
    // 检查如果是短链接已解析出的 bvid
    return fetchBilibiliMetadata(videoId);
  }
}
