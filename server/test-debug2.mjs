import { WebSocket } from 'ws';

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
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')); }, 60000);
  });
}

ws.on('open', async () => {
  ws.send(JSON.stringify({
    type: 'hello',
    client: { name: 'debug', origin: 'http://localhost:3000', version: '1.0.0' },
    allowedOrigins: ['http://localhost:3000', 'https://channels.weixin.qq.com'],
    requestedCapabilities: ['browser.launchDefault', 'browser.ensureReady', 'browser.status', 'pages.open', 'dom.click', 'dom.fill', 'dom.text', 'pages.screenshot', 'files.upload']
  }));

  ws.once('message', async (data) => {
    const ready = JSON.parse(data.toString());
    if (ready.type !== 'ready') { console.error(ready); process.exit(1); }
    console.log('✅ Connected');

    // Check browser status
    const status = await send('browser.status', {});
    console.log('Browser status:', JSON.stringify(status));

    // Try to launch/ensure browser
    console.log('Launching browser...');
    const launch = await send('browser.ensureReady', {});
    console.log('ensureReady:', JSON.stringify(launch));

    if (launch.ok) {
      // Try opening page
      const page = await send('pages.open', {
        url: 'https://channels.weixin.qq.com/platform/post/create',
        reuse: { urlIncludes: 'channels.weixin.qq.com' }
      });
      console.log('pages.open:', JSON.stringify(page));
    }

    ws.close();
    process.exit(0);
  });
});
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
