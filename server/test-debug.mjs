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
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')); }, 30000);
  });
}

ws.on('open', async () => {
  ws.send(JSON.stringify({
    type: 'hello',
    client: { name: 'debug', origin: 'http://localhost:3000', version: '1.0.0' },
    allowedOrigins: ['http://localhost:3000', 'https://channels.weixin.qq.com'],
    requestedCapabilities: [
      'pages.open', 'dom.click', 'dom.clickText', 'dom.fill',
      'dom.text', 'pages.screenshot', 'files.upload'
    ]
  }));

  ws.once('message', async (data) => {
    const ready = JSON.parse(data.toString());
    console.log('Ready response:', JSON.stringify(ready, null, 2));
    
    if (ready.type !== 'ready') { process.exit(1); }

    const page = await send('pages.open', {
      url: 'https://channels.weixin.qq.com/platform/post/create',
      reuse: { urlIncludes: 'channels.weixin.qq.com' }
    });
    console.log('pages.open response:', JSON.stringify(page, null, 2));
    
    ws.close();
    process.exit(0);
  });
});
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
