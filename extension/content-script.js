// Content Script: 它是运行在你的 Vue 页面里的。
// 唯一的任务：接收 Vue 的消息，转发给 Background，拿到结果后再转回给 Vue。
// 这样可以利用 Background 的跨域权限，同时避免前台的跨域报错。

if (document.documentElement) {
  document.documentElement.setAttribute('data-ai-video-ext-installed', 'true');
}

console.log("%c[Extension] Content Script Ready (Proxy Mode)", "color: #10b981; font-weight: bold;");

window.addEventListener('message', async (event) => {
  if (event.source !== window || !event.data) return;

  if (event.data.type === 'AI_VIDEO_EXT_REQUEST_TRANSCRIPT') {
    const { videoId, platform, messageId } = event.data;

    // 强制发送给 Background 处理，Background 才有权限跨域请求 youtube.com
    chrome.runtime.sendMessage({ action: 'fetchTranscript', videoId, platform }, (response) => {

      if (chrome.runtime.lastError) {
        window.postMessage({
          type: 'AI_VIDEO_EXT_RESPONSE_TRANSCRIPT',
          messageId,
          success: false,
          error: "扩展背景脚本未响应: " + chrome.runtime.lastError.message
        }, '*');
        return;
      }

      window.postMessage({
        type: 'AI_VIDEO_EXT_RESPONSE_TRANSCRIPT',
        messageId,
        success: response.success,
        data: response.data,
        error: response.error
      }, '*');
    });
  }
});
