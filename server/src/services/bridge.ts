import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface BridgeCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; recoverable: boolean };
}

export interface BridgeClientOptions {
  port?: number;
  host?: string;
  clientName?: string;
  origin?: string;
}

const DEFAULT_PORT = 17321;
const DEFAULT_HOST = '127.0.0.1';

export class BridgeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private _status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private pendingCommands = new Map<string, { resolve: (v: BridgeResponse) => void; reject: (e: Error) => void }>();
  private cmdCounter = 0;
  private options: Required<BridgeClientOptions>;

  constructor(options: BridgeClientOptions = {}) {
    super();
    this.options = {
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? DEFAULT_HOST,
      clientName: options.clientName ?? 'ai-video-highlights',
      origin: options.origin ?? 'http://localhost:3000',
    };
  }

  get status() {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this._status === 'connected') return;

    return new Promise((resolve, reject) => {
      this._status = 'connecting';
      const url = `ws://${this.options.host}:${this.options.port}/session`;
      this.ws = new WebSocket(url);

      this.ws.on('open', async () => {
        try {
          await this.handshake();
          this._status = 'connected';
          // Ensure browser is ready after handshake
          await this.ensureBrowserReady();
          this.emit('connected');
          resolve();
        } catch (err) {
          this._status = 'disconnected';
          reject(err);
        }
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        this._status = 'disconnected';
        this.rejectAllPending('WebSocket closed');
        this.emit('disconnected');
      });

      this.ws.on('error', (err) => {
        if (this._status === 'connecting') {
          this._status = 'disconnected';
          reject(err);
        }
        this.emit('error', err);
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._status = 'disconnected';
    this.rejectAllPending('Client disconnected');
  }

  async send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<BridgeResponse> {
    if (this._status !== 'connected' || !this.ws) {
      throw new Error('Bridge not connected');
    }

    const id = `cmd_${++this.cmdCounter}`;
    const cmd: BridgeCommand = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(id, {
        resolve: (resp) => { clearTimeout(timer); resolve(resp); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.ws!.send(JSON.stringify(cmd));
    });
  }

  // --- High-level helpers ---

  async ensureBrowserReady(): Promise<void> {
    const resp = await this.send('browser.ensureReady', {}, 60000);
    if (!resp.ok) throw new Error(resp.error?.message ?? 'browser.ensureReady failed');
  }

  async openPage(url: string, reuse?: { urlIncludes: string }): Promise<{ pageId: string; url: string }> {
    const params: Record<string, unknown> = { url };
    if (reuse) params.reuse = reuse;
    const resp = await this.send('pages.open', params);
    if (!resp.ok) throw new Error(resp.error?.message ?? 'pages.open failed');
    return resp.result as { pageId: string; url: string };
  }

  async click(pageId: string, selector: string, timeoutMs = 3000): Promise<void> {
    const resp = await this.send('dom.click', { pageId, selector, timeoutMs });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'dom.click failed');
  }

  async clickText(pageId: string, container: string, text: string, timeoutMs = 5000): Promise<void> {
    const resp = await this.send('dom.clickText', { pageId, text, timeoutMs });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'dom.clickText failed');
  }

  async fill(pageId: string, selector: string, text: string, timeoutMs = 3000): Promise<void> {
    const resp = await this.send('dom.fill', { pageId, selector, text, timeoutMs });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'dom.fill failed');
  }

  async upload(pageId: string, selector: string, files: string[], timeoutMs = 10000): Promise<void> {
    const resp = await this.send('files.upload', { pageId, selector, files, timeoutMs });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'files.upload failed');
  }

  async waitForSelector(pageId: string, selector: string, timeoutMs = 5000): Promise<void> {
    const resp = await this.send('dom.waitSelector', { pageId, selector, timeoutMs });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'dom.waitSelector failed');
  }

  async screenshot(pageId: string): Promise<string> {
    const resp = await this.send('pages.screenshot', { pageId });
    if (!resp.ok) throw new Error(resp.error?.message ?? 'pages.screenshot failed');
    return (resp.result as { base64: string }).base64;
  }

  async getText(pageId: string, selector?: string): Promise<string> {
    const params: Record<string, unknown> = { pageId };
    if (selector) params.selector = selector;
    const resp = await this.send('dom.text', params);
    if (!resp.ok) throw new Error(resp.error?.message ?? 'dom.text failed');
    return (resp.result as { text: string }).text;
  }

  // --- Private ---

  private async handshake(): Promise<void> {
    const hello = {
      type: 'hello',
      client: {
        name: this.options.clientName,
        origin: this.options.origin,
        version: '1.0.0',
      },
      allowedOrigins: [
        this.options.origin,
        'https://creator.douyin.com',
        'https://creator.xiaohongshu.com',
        'https://member.bilibili.com',
        'https://channels.weixin.qq.com',
      ],
      requestedCapabilities: [
        'pages.open', 'pages.list', 'pages.focus', 'pages.focusByUrl',
        'pages.screenshot', 'pages.reload',
        'dom.click', 'dom.clickText', 'dom.clickSelectorText',
        'dom.fill', 'dom.text', 'dom.waitSelector', 'dom.waitText',
        'dom.scroll', 'dom.hover', 'dom.press',
        'files.upload', 'files.uploadData',
        'browser.status', 'browser.ensureReady',
      ],
    };

    return new Promise((resolve, reject) => {
      const onMessage = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ready') {
            this.ws!.off('message', onMessage);
            resolve();
          } else if (msg.id === 'hello' && !msg.ok) {
            this.ws!.off('message', onMessage);
            reject(new Error(msg.error?.message ?? 'Authorization required'));
          }
        } catch { /* ignore */ }
      };
      this.ws!.on('message', onMessage);
      this.ws!.send(JSON.stringify(hello));
    });
  }

  private handleMessage(msg: BridgeResponse): void {
    if (!msg.id) return;
    const pending = this.pendingCommands.get(msg.id);
    if (pending) {
      this.pendingCommands.delete(msg.id);
      pending.resolve(msg);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, { reject }] of this.pendingCommands) {
      reject(new Error(reason));
      this.pendingCommands.delete(id);
    }
  }
}

// Singleton instance
let bridgeInstance: BridgeClient | null = null;

export function getBridgeClient(options?: BridgeClientOptions): BridgeClient {
  if (!bridgeInstance) {
    bridgeInstance = new BridgeClient(options);
  }
  return bridgeInstance;
}
