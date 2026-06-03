const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface PublishAsset {
  id: string;
  videoId?: string;
  title: string;
  description?: string;
  hashtags?: string;
  videoFilePath: string;
  cover43Path?: string;
  cover34Path?: string;
  status: 'draft' | 'ready' | 'publishing' | 'published' | 'failed';
  createdAt: string;
  updatedAt: string;
  publishTasks?: PublishTask[];
}

export interface PublishTask {
  id: string;
  assetId: string;
  platform: string;
  platformTitle?: string;
  platformDesc?: string;
  publishMode?: 'draft' | 'publish';
  status: 'pending' | 'running' | 'draft_saved' | 'published' | 'success' | 'failed' | 'retrying';
  errorMessage?: string;
  publishedAt?: string;
  publishedUrl?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  asset?: PublishAsset;
}

export interface PlatformInfo {
  platform: string;
  displayName: string;
  isActive: boolean;
  config?: Record<string, unknown>;
}

// Assets API
export async function fetchAssets(params?: { status?: string; page?: number; limit?: number; search?: string }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.search) query.set('search', params.search);

  const res = await fetch(`${API_BASE}/api/assets?${query}`);
  return res.json() as Promise<{ assets: PublishAsset[]; total: number; page: number; limit: number }>;
}

export async function updateAsset(id: string, data: Partial<PublishAsset>) {
  const res = await fetch(`${API_BASE}/api/assets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<PublishAsset>;
}

export async function deleteAsset(id: string) {
  await fetch(`${API_BASE}/api/assets/${id}`, { method: 'DELETE' });
}

export async function importAsset(data: {
  title: string;
  videoFilePath: string;
  cover43FilePath?: string;
  cover34FilePath?: string;
  description?: string;
  hashtags?: string;
  videoId?: string;
}) {
  const res = await fetch(`${API_BASE}/api/assets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Import failed');
  }
  return res.json() as Promise<PublishAsset>;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  mtime?: number;
  width?: number;
  height?: number;
}

export interface BrowseResult {
  current: string;
  parent: string;
  dirs: { name: string; path: string; hasMedia?: boolean }[];
  videos: FileInfo[];
  images: FileInfo[];
}

export async function browseDirectory(dir?: string) {
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetch(`${API_BASE}/api/fs/browse${query}`);
  return res.json() as Promise<BrowseResult>;
}

// Publish API
export async function fetchPublishTasks(params?: { status?: string; assetId?: string }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.assetId) query.set('assetId', params.assetId);

  const res = await fetch(`${API_BASE}/api/publish/tasks?${query}`);
  return res.json() as Promise<{ tasks: PublishTask[]; total: number }>;
}

export async function createPublishTask(data: { assetId: string; platform: string; publishMode?: 'draft' | 'publish' }) {
  const res = await fetch(`${API_BASE}/api/publish/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json() as Promise<PublishTask>;
}

export async function runPublishTask(taskId: string) {
  const res = await fetch(`${API_BASE}/api/publish/tasks/${taskId}/run`, { method: 'POST' });
  return res.json();
}

export async function batchPublish(assetIds: string[], platforms: string[]) {
  const res = await fetch(`${API_BASE}/api/publish/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds, platforms }),
  });
  return res.json();
}

// Bridge API
export async function getBridgeStatus() {
  const res = await fetch(`${API_BASE}/api/bridge/status`);
  return res.json() as Promise<{ status: string }>;
}

export async function connectBridge() {
  const res = await fetch(`${API_BASE}/api/bridge/connect`, { method: 'POST' });
  return res.json();
}

// Platforms
export async function fetchPlatforms() {
  const res = await fetch(`${API_BASE}/api/platforms`);
  return res.json() as Promise<PlatformInfo[]>;
}
