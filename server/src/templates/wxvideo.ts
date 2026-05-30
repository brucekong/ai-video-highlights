import type { PublishTemplate, PublishContext, PublishStep } from './types.js';

/**
 * 微信视频号发布模板
 * URL: https://channels.weixin.qq.com/platform/post/create
 *
 * 按钮文字说明：
 *   - "保存草稿" — 保存为草稿
 *   - "发表" — 直接发布
 * 注意：短标题必须 >= 6 个字符，只允许书名号、引号、冒号、加号、问号、百分号、摄氏度、逗号
 */

/**
 * Clean title for 视频号 — strip disallowed special characters.
 * Allowed symbols: 《》""''：+？%℃，
 */
export function cleanWxVideoTitle(title: string): string {
  // Replace common problematic chars: () [] {} / \ | ~ @ # $ ^ & * = ; < > with space or removal
  return title
    .replace(/[()（）\[\]【】{}\/<>\\|~@#$^&*=;！!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Generate wxvideo template steps based on publish mode */
export function getWxvideoSteps(mode: 'draft' | 'publish' = 'draft'): PublishStep[] {
  const buttonText = mode === 'publish' ? '发表' : '保存草稿';
  const successIndicator = mode === 'publish'
    ? '.weui-desktop-toast, [class*="success"], .publish-success'
    : '.weui-desktop-toast, .toast-success, [class*="success"], .weui-desktop-dialog';

  return [
    {
      action: 'openPage',
      url: 'https://channels.weixin.qq.com/platform/post/create',
      reuse: { urlIncludes: 'channels.weixin.qq.com' },
    },
    { action: 'delay', ms: 2000 },
    {
      action: 'upload',
      selector: 'input[type=file]',
      fileField: 'video',
      timeoutMs: 15000,
    },
    { action: 'delay', ms: 2000 },
    {
      action: 'fill',
      selector: '.input-editor',
      value: '{{description}} {{hashtags}}',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 500 },
    {
      action: 'fill',
      selector: '[placeholder="填写短标题有机会获得更多流量"]',
      value: '{{title}}',
      timeoutMs: 3000,
    },
    {
      action: 'upload',
      selector: '.cover-uploader input[type=file]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    {
      action: 'waitForSelector',
      selector: '#fullScreenVideo',
      timeoutMs: 180000,
    },
    { action: 'delay', ms: 3000 },
    {
      action: 'checkError',
      selector: '.form-error, .ant-form-item-explain-error, [class*="error-tip"], [class*="err-msg"]',
      timeoutMs: 2000,
    },
    { action: 'screenshot', label: 'before-publish' },
    {
      action: 'click',
      selector: `button:has-text("${buttonText}")`,
      timeoutMs: 5000,
    },
    {
      action: 'waitForSelector',
      selector: successIndicator,
      timeoutMs: 10000,
    },
    { action: 'screenshot', label: 'after-save' },
  ];
}

export const wxvideoTemplate: PublishTemplate = {
  platform: 'wxvideo',
  displayName: '视频号',
  // Default steps (will be overridden by publisher based on publishMode)
  steps: getWxvideoSteps('draft'),
};
