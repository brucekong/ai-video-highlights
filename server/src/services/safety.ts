/**
 * 敏感词/政治敏感视频拦截服务
 */

export const SENSITIVE_KEYWORDS = [
  // 政治评论员/自媒体
  '王局', '王局志安', '志安', '二大爷', '悉尼奶爸', '公子沈', '文昭', '江峰',
  '陈破空', '石涛', '章天亮', '徐晓冬', '袁腾飞', '刘阿姨', '阿姨学', '刘仲敬',
  '老灯', '反共', '民主中国', '郭文贵', '郝海东', '闫丽梦',

  // 敏感机构/媒体
  '大纪元', '新唐人', '希望之声', '看中国', '阿波罗网', '自由亚洲', 'RFA', '美国之音', 'VOA',

  // 政治敏感词
  '六四', '天安门事件', '坦克人', '维尼写史', '习近平', '李强', '蔡奇', '丁薛祥',
  '党务', '特权', '内斗', '派别', '红二代', '太子党', '活摘', '轮功', '法轮',
  '疆独', '藏独', '港独', '台独', '时代革命', '光复香港', '五大诉求',
  '白纸革命', '白纸运动', '乌鲁木齐中路'
];

/**
 * 检查文本是否包含敏感词
 */
export function containsSensitiveContent(text: string): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase().replace(/\s+/g, ''); // 移除空格进行更严格匹配
  return SENSITIVE_KEYWORDS.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    return lowerText.includes(lowerKeyword);
  });
}

/**
 * 统一的拦截提示错误
 */
export class SafetyValidationError extends Error {
  constructor(message: string = '该内容涉及敏感话题或政治敏感及受限，暂不支持分析。') {
    super(message);
    this.name = 'SafetyValidationError';
  }
}
