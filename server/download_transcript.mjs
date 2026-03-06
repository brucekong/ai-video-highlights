import { fetchTranscript } from 'youtube-transcript-plus';
import { writeFile } from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 提取 Video ID
 */
function getVideoId(url) {
    const patterns = [
        /(?:v=|\/)([0-9A-Za-z_-]{11}).*/,
        /youtu\.be\/([0-9A-Za-z_-]{11})/,
        /embed\/([0-9A-Za-z_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return url.length === 11 ? url : null;
}

/**
 * 解析 Netscape Cookies
 */
function parseNetscapeCookies(content) {
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

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('用法: node download_transcript.mjs <youtube_url>');
        process.exit(1);
    }

    const videoId = getVideoId(args[0]);
    if (!videoId) {
        console.error('错误: 无法解析 Video ID');
        process.exit(1);
    }

    console.log(`正在尝试通过 youtube-transcript-plus 获取视频: ${videoId}`);

    const cookieHeader = '';

    // 配置自定义 fetch 以支持 Cookies
    const customFetch = async (params) => {
        const { url, lang, userAgent, method = 'GET', headers = {} } = params;
        const fetchHeaders = {
            'User-Agent': userAgent || UA,
            ...(lang && { 'Accept-Language': lang }),
            ...headers,
            'Cookie': cookieHeader,
        };
        return fetch(url, { method, headers: fetchHeaders });
    };

    try {
        const transcript = await fetchTranscript(videoId, {
            lang: 'en', // 默认优先尝试英文，库会自动 fallback
            userAgent: UA,
            videoFetch: cookieHeader ? customFetch : undefined,
            playerFetch: cookieHeader ? customFetch : undefined,
            transcriptFetch: cookieHeader ? customFetch : undefined,
        });

        if (transcript && transcript.length > 0) {
            const fileName = `transcript_${videoId}.json`;
            await writeFile(fileName, JSON.stringify(transcript, null, 2));
            console.log(`✅ 成功! 字幕已下载至: ${fileName}`);
            console.log(`共获取到 ${transcript.length} 条片段。`);
        } else {
            console.log('❌ 未获取到字幕数据。');
        }
    } catch (e) {
        console.error('❌ 获取失败:', e.message);
        if (e.message.includes('Available languages')) {
            console.log('\n提示: 该视频可能没有你指定的语言，建议查看报错信息中的可用语言列表。');
        }
    }
}

main();
