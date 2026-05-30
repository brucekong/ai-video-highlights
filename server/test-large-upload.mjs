import { WebSocket } from 'ws';
import fs from 'fs';

const ws = new WebSocket('ws://127.0.0.1:17321/session');
let cmdId = 0;

function send(method, params) {
  const id = 'cmd_' + (++cmdId);
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) { ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')); }, 300000);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

ws.on('open', async () => {
  ws.send(JSON.stringify({
    type: 'hello',
    client: { name: 'test-large', origin: 'http://localhost:3000', version: '1.0.0' },
    allowedOrigins: ['http://localhost:3000', 'https://channels.weixin.qq.com'],
    requestedCapabilities: [
      'pages.open', 'dom.click', 'dom.clickText', 'dom.fill',
      'dom.text', 'pages.screenshot', 'files.upload'
    ]
  }));

  ws.once('message', async (data) => {
    const ready = JSON.parse(data.toString());
    if (ready.type !== 'ready') { console.error('Not ready:', ready); process.exit(1); }
    console.log('✅ Connected\n');

    try {
      // Open create page
      const page = await send('pages.open', {
        url: 'https://channels.weixin.qq.com/platform/post/create',
        reuse: { urlIncludes: 'channels.weixin.qq.com' }
      });
      const pageId = page.result.pageId;
      console.log('Page:', pageId);
      await delay(2000);

      // Upload large video
      const videoPath = '/Users/xuelei.kong/Downloads/玛雅的秘密 初级英语故事.mp4';
      const size = fs.statSync(videoPath).size;
      console.log(`\n📤 Uploading ${(size / 1024 / 1024).toFixed(1)} MB video...`);
      
      const start = Date.now();
      const upload = await send('files.upload', {
        pageId,
        selector: 'input[type=file]',
        files: [videoPath],
        timeoutMs: 120000
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`Upload: ${upload.ok ? '✅' : '❌ ' + upload.error?.message} (${elapsed}s)`);

      if (upload.ok) {
        console.log('⏳ Waiting 60s for video processing...');
        await delay(60000);
        
        // Screenshot to verify
        const ss = await send('pages.screenshot', { pageId });
        if (ss.ok) {
          fs.writeFileSync('/tmp/wx-large-upload.png', Buffer.from(ss.result.base64, 'base64'));
          console.log('📸 /tmp/wx-large-upload.png');
        }

        // Fill description
        const desc = await send('dom.fill', {
          pageId, selector: '.input-editor',
          text: '玛雅的秘密 初级英语故事 #英语学习 #慢速英语',
          timeoutMs: 5000
        });
        console.log('Description:', desc.ok ? '✅' : '❌');

        // Fill title
        const title = await send('dom.fill', {
          pageId,
          selector: '[placeholder="填写短标题有机会获得更多流量"]',
          text: '玛雅的秘密初级英语听力故事',
          timeoutMs: 3000
        });
        console.log('Title:', title.ok ? '✅' : '❌');

        await delay(2000);

        // Click save draft
        console.log('\n🖱️ Clicking 保存草稿...');
        const save = await send('dom.click', {
          pageId,
          selector: 'button:has-text("保存草稿")',
          timeoutMs: 5000
        });
        console.log('Save:', save.ok ? '✅' : '❌ ' + save.error?.message);

        await delay(5000);

        // Final screenshot
        const ss2 = await send('pages.screenshot', { pageId });
        if (ss2.ok) {
          fs.writeFileSync('/tmp/wx-large-saved.png', Buffer.from(ss2.result.base64, 'base64'));
          console.log('📸 /tmp/wx-large-saved.png');
        }
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
    ws.close();
    process.exit(0);
  });
});
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
