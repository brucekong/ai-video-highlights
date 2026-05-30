import type { PublishTemplate } from './types.js';

/**
 * 小红书创作者平台发布模板
 * URL: https://creator.xiaohongshu.com/publish/publish
 */
export const xiaohongshuTemplate: PublishTemplate = {
  platform: 'xiaohongshu',
  displayName: '小红书',
  steps: [
    {
      action: 'openPage',
      url: 'https://creator.xiaohongshu.com/publish/publish?source=official',
      reuse: { urlIncludes: 'creator.xiaohongshu.com' },
    },
    { action: 'delay', ms: 2000 },
    // Click "发布视频" tab
    {
      action: 'click',
      selector: 'text=发布视频',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 1000 },
    // Upload video
    {
      action: 'upload',
      selector: 'input[type=file]',
      fileField: 'video',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 5000 },
    { action: 'screenshot', label: 'after-upload' },
    // Fill title
    {
      action: 'fill',
      selector: '#composerTitleInput',
      value: '{{title}}',
      timeoutMs: 5000,
    },
    // Fill description
    {
      action: 'fill',
      selector: '#composerDescInput',
      value: '{{description}} {{hashtags}}',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 1000 },
    // Upload cover if available
    {
      action: 'upload',
      selector: '.cover-selector input[type=file]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 2000 },
    { action: 'screenshot', label: 'before-publish' },
    // Publish
    {
      action: 'click',
      selector: 'text=发布',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 3000 },
    { action: 'screenshot', label: 'after-publish' },
  ],
};
