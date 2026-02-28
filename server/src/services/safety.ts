/**
 * 从环境变量加载敏感词列表，支持逗号分隔
 * 例如：SENSITIVE_KEYWORDS_LIST=王局,二大爷,六四
 */
const GET_SENSITIVE_KEYWORDS = (): string[] => {
  const envKeywords = process.env.SENSITIVE_KEYWORDS_LIST;
  if (!envKeywords) {
    // 如果没有配置环境变量，默认使用一个空列表或基础列表
    return [];
  }
  return envKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

export const SENSITIVE_KEYWORDS = GET_SENSITIVE_KEYWORDS();

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
