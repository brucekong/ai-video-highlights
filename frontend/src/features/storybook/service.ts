import type { StorybookDraft } from './types';

const API_BASE = import.meta.env.VITE_API_URL;

export async function fetchStorybookDraft(
  videoId: string,
  authHeaders: Record<string, string> = {}
): Promise<StorybookDraft> {
  const response = await fetch(`${API_BASE}/api/storybooks/${videoId}/draft`, {
    headers: {
      ...authHeaders,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error || '画册草稿获取失败');
  }

  return payload.data as StorybookDraft;
}
