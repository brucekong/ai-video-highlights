import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:17321/session');
let pageId = '';

function send(id: string, method: string, params: any) {
  ws.send(JSON.stringify({ id, method, params }));
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    client: { name: 'test', origin: 'http://localhost:3001', displayName: 'Test' },
    allowedOrigins: ['*'],
    requestedCapabilities: ['pages.list', 'dom.click', 'dom.clickText']
  }));
});

ws.on('message', (data: any) => {
  const resp = JSON.parse(data.toString());
  if (resp.type === 'ready') {
    send('1', 'pages.list', {});
  }
  if (resp.id === '1') {
    const pages = resp.result?.pages || [];
    const target = pages.find((p: any) => p.url?.includes('channels.weixin'));
    if (!target) { console.log('No channels.weixin page'); process.exit(1); }
    pageId = target.id || target.pageId;
    console.log('Page found:', pageId);
    // Try regular click on the confirm button inside open shadow root
    console.log('Test 1: dom.click with .finder-dialog-footer .weui-desktop-btn_primary');
    send('2', 'dom.click', { pageId, selector: '.finder-dialog-footer .weui-desktop-btn_primary' });
  }
  if (resp.id === '2') {
    console.log('Regular click result:', resp.ok ? 'OK' : resp.error?.message);
    ws.close(); process.exit(0);
  }
});
ws.on('error', (err: any) => { console.error('Error:', err.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 15000);
