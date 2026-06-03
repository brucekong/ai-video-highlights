import { BridgeClient } from './src/services/bridge.js';

async function test() {
  const bridge = new BridgeClient();
  console.log('Connecting to bridge...');
  await bridge.connect();
  console.log('Connected! Status:', bridge.status);
  
  // Use send directly to list pages
  const resp = await (bridge as any).send('pages.list', {});
  if (!resp.ok) { console.log('pages.list failed:', resp.error); process.exit(1); }
  
  const pages = resp.result?.pages || [];
  console.log('Pages:', pages.map((p: any) => p.url?.substring(0, 60)));
  
  const target = pages.find((p: any) => p.url?.includes('channels.weixin'));
  if (!target) { console.log('No channels.weixin page'); process.exit(1); }
  
  const pageId = target.pageId || target.id;
  console.log('Target pageId:', pageId);
  
  console.log('Calling clickDeep via BridgeClient...');
  try {
    await bridge.clickDeep(pageId, '.finder-dialog-footer .weui-desktop-btn_primary', 10000);
    console.log('clickDeep succeeded!');
  } catch (err: any) {
    console.error('clickDeep failed:', err.message);
  }
  
  bridge.disconnect();
  process.exit(0);
}

test().catch(err => { console.error(err); process.exit(1); });
