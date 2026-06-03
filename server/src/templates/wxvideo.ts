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
      action: 'waitForSelector',
      selector: '#fullScreenVideo',
      timeoutMs: 180000,
    },
    { action: 'delay', ms: 10000 },
    // Upload 3:4 cover: click container → popup → upload → confirm
    // {
    //   action: 'waitForSelector',
    //   selector: '.vertical-cover-wrap',
    //   timeoutMs: 180000,
    // },
    {
      action: 'click',
      selector: '.vertical-cover-wrap',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    {
      action: 'upload',
      selector: '.single-cover-uploader-wrap input[type=file]',
      fileField: 'cover34',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 3000 },
    { action: 'screenshot', label: 'after-cover34-upload' },
    { action: 'delay', ms: 2000 },
    {
      action: 'clickDeep',
      selector: '.finder-dialog-footer .weui-desktop-btn_primary',
      timeoutMs: 10000,
      optional: true,
    },
    { action: 'delay', ms: 2000 },
    // Upload 4:3 cover: click container → bubble → click "直接编辑" → dialog → upload → confirm
    {
      action: 'click',
      selector: '.horizon-cover-wrap',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    {
      action: 'click',
      selector: '.img-recommend-wrap .btn-directly-edit',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    {
      action: 'upload',
      selector: '.single-cover-uploader-wrap input[type=file]',
      fileField: 'cover43',
      timeoutMs: 10000,
    },
    { action: 'delay', ms: 5000 },
    {
      action: 'clickDeep',
      selector: '.finder-dialog-footer .weui-desktop-btn_primary',
      timeoutMs: 10000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },

    // Declare original content
    {
      action: 'click',
      selector: '.declare-original-checkbox',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },
    {
      action: 'click',
      selector: '.original-proto-wrapper',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 500 },
    {
      action: 'clickDeep',
      selector: '.weui-desktop-dialog__ft .weui-desktop-btn_wrp .weui-desktop-btn_primary',
      timeoutMs: 5000,
      optional: true,
    },
    { action: 'delay', ms: 1000 },

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
