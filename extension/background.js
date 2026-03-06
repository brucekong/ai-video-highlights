/**
 * 核心：模拟 YouTube WEB 浏览器的 Innertube API。
 * 这是插件后台目前最稳健的抓取方式。
 */

const WEB_CLIENT_VERSION = '2.20240210.01.00';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

class YoutubeTranscript {
  static async fetchTranscript(videoId, lang = null) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 1) 先拿到 API KEY
    const videoPageResponse = await fetch(watchUrl, {
      headers: { 'User-Agent': USER_AGENT },
      credentials: 'include'
    });

    const bodyText = await videoPageResponse.text();
    const apiKeyMatch = bodyText.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ||
                        bodyText.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);

    if (!apiKeyMatch) throw new Error('无法提取 API KEY');
    const apiKey = apiKeyMatch[1];

    // 2) 请求字幕数据，带上最真实的 Headers
    const playerEndpoint = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
    const playerBody = {
      context: {
        client: {
          clientName: 'WEB', // 改用 WEB 身份以获得更大的宽容度
          clientVersion: WEB_CLIENT_VERSION
        }
      },
      videoId: videoId
    };

    const playerRes = await fetch(playerEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '1', // 指示是桌面浏览器
        'X-Youtube-Client-Version': WEB_CLIENT_VERSION,
        'Origin': 'https://www.youtube.com',
        'Referer': watchUrl,
        'User-Agent': USER_AGENT
      },
      body: JSON.stringify(playerBody),
      credentials: 'include'
    });

    if (playerRes.status === 403) {
      throw new Error("Innertube API 403 禁止访问 (可能触发了 YouTube 检测)。");
    }

    const playerJson = await playerRes.json();
    const tracklist = playerJson?.captions?.playerCaptionsTracklistRenderer || playerJson?.playerCaptionsTracklistRenderer;
    const tracks = tracklist?.captionTracks;

    if (!tracks || tracks.length === 0) throw new Error('该视频未开启字幕。');

    // 默认查找中、英，否则第一条
    let track = lang ? tracks.find(t => t.languageCode === lang) : null;
    if (!track) {
        track = tracks.find(t => t.languageCode.startsWith('zh')) ||
                tracks.find(t => t.languageCode.startsWith('en')) ||
                tracks[0];
    }

    // 3) 下载最终 XML
    let finalUrl = track.baseUrl || track.url;
    if (!finalUrl.includes('fmt=')) finalUrl += '&fmt=srv1';

    const resp = await fetch(finalUrl, { credentials: 'include' });
    const xml = await resp.text();

    return this.parseXml(xml);
  }

  static parseXml(xml) {
    const segments = [];
    const textRegex = /<text\s+([^>]+)>([\s\S]*?)<\/text>/g;
    let tMatch;
    while ((tMatch = textRegex.exec(xml)) !== null) {
      const attrPart = tMatch[1];
      const content = tMatch[2];
      const startMatch = attrPart.match(/start="([\d.]+)"/);
      const durMatch = attrPart.match(/dur="([\d.]+)"/);
      if (startMatch) {
         segments.push({
           offset: Math.round(parseFloat(startMatch[1]) * 1000),
           duration: durMatch ? Math.round(parseFloat(durMatch[1]) * 1000) : 500,
           text: content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim()
         });
      }
    }
    return segments;
  }
}

// ------------------------------------------------------------------
// 插件消息循环
// ------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchTranscript') {
    YoutubeTranscript.fetchTranscript(request.videoId)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持异步
  }
});
