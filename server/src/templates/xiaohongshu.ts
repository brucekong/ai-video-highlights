import type { PublishTemplate, PublishStep } from './types.js';

/**
 * 小红书创作者平台发布模板
 * URL: https://creator.xiaohongshu.com/publish/publish
 *
 * 页面结构 (2025-05):
 *   - 视频上传: input.upload-input (accept video formats)
 *   - 标题: input.d-text[placeholder="填写标题会有更多赞哦"]
 *   - 正文: .tiptap.ProseMirror (contenteditable, max 1000 chars)
 *   - 话题按钮: #topicBtn
 *   - 发布: clickText "发布"
 *   - 暂存离开: clickText "暂存离开"
 *   - 封面: 点击"修改封面" → 弹窗中 input[accept*=image] 上传 → 点击"确定"
 */

/** Generate xiaohongshu template steps based on publish mode */
export function getXiaohongshuSteps(mode: 'draft' | 'publish' = 'draft'): PublishStep[] {
  const buttonText = mode === 'publish' ? '发布' : '暂存离开';

  return [
    {
      action: 'openPage',
      url: 'https://creator.xiaohongshu.com/publish/publish?source=official',
      reuse: { urlIncludes: 'creator.xiaohongshu.com/publish' },
    },
    { action: 'delay', ms: 2000 },
    // Upload video file
    {
      action: 'upload',
      selector: 'input.upload-input',
      fileField: 'video',
      timeoutMs: 15000,
    },
    // Wait for form to appear (title input signals upload started + form rendered)
    {
      action: 'waitForSelector',
      selector: 'input.d-text',
      timeoutMs: 30000,
    },
    { action: 'delay', ms: 1000 },
    { action: 'screenshot', label: 'after-upload' },
    // Fill title (max 20 chars on XHS)
    {
      action: 'fill',
      selector: 'input.d-text',
      value: '{{title}}',
      timeoutMs: 5000,
    },
    // Fill description in ProseMirror contenteditable editor
    {
      action: 'fill',
      selector: '.tiptap.ProseMirror',
      value: '{{description}} {{hashtags}}',
      timeoutMs: 5000,
    },
    { action: 'delay', ms: 1000 },
    // Dismiss hashtag suggestion popup if shown
    { action: 'press', key: 'Escape', optional: true },
    { action: 'delay', ms: 500 },
    // Upload cover (4:3 for XHS): click "修改封面" to open cover editor modal
    {
      action: 'clickText',
      container: '.cover-plugin-preview',
      text: '修改封面',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1500 },
    // Upload cover image into the modal's file input
    {
      action: 'upload',
      selector: 'input[accept*="image"]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 2000 },
    // Confirm cover selection
    {
      action: 'clickText',
      container: '.cover-modal',
      text: '确定',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    // Toggle original declaration switch
    {
      action: 'click',
      selector: '.custom-switch-switch',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 500 },
    {
      action: 'click',
      selector: '.footerLeft',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 500 },
    {
      action: 'clickText',
      container: '.footer',
      text: '发布',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    { action: 'screenshot', label: 'before-publish' },
    // Click publish or save-draft button
    {
      action: 'clickText',
      container: '.publish-page-publish-btn button',
      text: buttonText,
      timeoutMs: 5000,
    },
    { action: 'delay', ms: 3000 },
    { action: 'screenshot', label: 'after-publish' },
  ];
}

export const xiaohongshuTemplate: PublishTemplate = {
  platform: 'xiaohongshu',
  displayName: '小红书',
  steps: getXiaohongshuSteps('draft'),
};
