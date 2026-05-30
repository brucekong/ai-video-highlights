export { douyinTemplate } from './douyin.js';
export { xiaohongshuTemplate } from './xiaohongshu.js';
export { bilibiliTemplate } from './bilibili.js';
export { wxvideoTemplate } from './wxvideo.js';
export { resolveTemplate } from './types.js';
export type { PublishTemplate, PublishStep, PublishContext } from './types.js';

import { douyinTemplate } from './douyin.js';
import { xiaohongshuTemplate } from './xiaohongshu.js';
import { bilibiliTemplate } from './bilibili.js';
import { wxvideoTemplate } from './wxvideo.js';
import type { PublishTemplate } from './types.js';

const templateRegistry: Record<string, PublishTemplate> = {
  douyin: douyinTemplate,
  xiaohongshu: xiaohongshuTemplate,
  bilibili: bilibiliTemplate,
  wxvideo: wxvideoTemplate,
};

export function getTemplate(platform: string): PublishTemplate | undefined {
  return templateRegistry[platform];
}

export function listTemplates(): PublishTemplate[] {
  return Object.values(templateRegistry);
}
