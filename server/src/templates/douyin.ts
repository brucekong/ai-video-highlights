import type { PublishTemplate } from './types.js';

/**
 * 抖音创作者平台发布模板
 * URL: https://creator.douyin.com/creator-micro/content/upload
 */
export const douyinTemplate: PublishTemplate = {
  platform: 'douyin',
  displayName: '抖音',
  steps: [
    {
      action: 'openPage',
      url: 'https://creator.douyin.com/creator-micro/content/upload',
      reuse: { urlIncludes: 'creator.douyin.com' },
    },
    { action: 'delay', ms: 2000 },
    // Upload video file
    {
      action: 'upload',
      selector: 'input[type=file]',
      fileField: 'video',
      timeoutMs: 10000,
    },
    // Wait for upload processing
    { action: 'delay', ms: 5000 },
    { action: 'screenshot', label: 'after-upload' },
    // Fill title
    {
      action: 'fill',
      selector: '.editor-kit-container [contenteditable=true]',
      value: '{{title}} {{hashtags}}',
      timeoutMs: 5000,
    },
    { action: 'delay', ms: 1000 },
    // Upload cover if available
    {
      action: 'upload',
      selector: '.cover-upload input[type=file]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 2000 },
    { action: 'screenshot', label: 'before-publish' },
    // Click publish button
    {
      action: 'click',
      selector: 'text=发布',
      timeoutMs: 3000,
    },
    { action: 'delay', ms: 3000 },
    { action: 'screenshot', label: 'after-publish' },
  ],
};
