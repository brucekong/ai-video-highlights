import type { PublishTemplate } from './types.js';

/**
 * B站创作中心发布模板
 * URL: https://member.bilibili.com/platform/upload/video/frame
 */
export const bilibiliTemplate: PublishTemplate = {
  platform: 'bilibili',
  displayName: 'B站',
  steps: [
    {
      action: 'openPage',
      url: 'https://member.bilibili.com/platform/upload/video/frame',
      reuse: { urlIncludes: 'member.bilibili.com' },
    },
    { action: 'delay', ms: 2000 },
    // Upload video
    {
      action: 'upload',
      selector: 'input[type=file]',
      fileField: 'video',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 8000 },
    { action: 'screenshot', label: 'after-upload' },
    // Fill title
    {
      action: 'fill',
      selector: '.video-title .input-val',
      value: '{{title}}',
      timeoutMs: 5000,
    },
    { action: 'delay', ms: 500 },
    // Fill description
    {
      action: 'fill',
      selector: '.video-desc .ql-editor',
      value: '{{description}} {{hashtags}}',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 1000 },
    // Upload cover
    {
      action: 'upload',
      selector: '.cover-upload-btn input[type=file]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 2000 },
    { action: 'screenshot', label: 'before-publish' },
    // Click publish
    {
      action: 'click',
      selector: '.submit-add',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 3000 },
    { action: 'screenshot', label: 'after-publish' },
  ],
};
