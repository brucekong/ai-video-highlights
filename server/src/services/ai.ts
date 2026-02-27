import OpenAI from 'openai';

export interface AITakeaway {
  title: string;
  summary: string;
  timestamp: number;  // 秒
  duration: string;   // 如 "2:30"
}

const SYSTEM_PROMPT = `你是一个专业的视频内容分析助手。你的任务是分析视频的转录文本，提取出最重要的核心观点和关键要点。

请严格按照以下 JSON 格式返回结果（不要返回其他任何文字）：

{
  "title": "视频的简短标题",
  "takeaways": [
    {
      "title": "要点标题（简洁有力，10-20个字）",
      "summary": "要点详细摘要（50-100个字）",
      "timestamp": 起始时间秒数（整数）,
      "duration": "该段持续时长，如 2:30"
    }
  ]
}

要求：
1. 提取 4-8 个最重要的核心要点
2. 每个要点必须有准确的时间戳（对应转录文本中 [mm:ss] 的时间标记）
3. **禁止胡编乱造时间点**：所有 timestamp 必须严格参考转录文本中出现的时间标记，不得超过视频的总时长。
4. 要点标题简洁有力，让用户一眼就能了解内容
5. 摘要需要概括该段落的核心内容
6. 时间戳必须从小到大排列
7. 如果转录文本是英文，请将标题和摘要翻译成中文
8. 只返回 JSON，不要有任何其他文字或 markdown 标记`;

// 重试配置
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000; // 基础等待时间 3 秒

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 使用 DeepSeek AI 分析转录文本，提取关键要点
 * DeepSeek API 兼容 OpenAI 格式，使用 openai SDK 调用
 * 内置自动重试机制
 */
export async function analyzeTranscript(
  formattedTranscript: string,
  maxDurationSeconds?: number,
): Promise<{ title: string; takeaways: AITakeaway[] }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured. Please set DEEPSEEK_API_KEY in server/.env');
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
  });

  // 在 User Prompt 中也补充一下时长限制（如果有）
  const durationConstraint = maxDurationSeconds
    ? `注意：视频总时长约为 ${Math.floor(maxDurationSeconds / 60)} 分 ${maxDurationSeconds % 60} 秒，提取的时间戳绝对不能超过这个范围。`
    : '';

  // 带重试的 API 调用
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🤖 DeepSeek API attempt ${attempt}/${MAX_RETRIES}...`);

      const completion = await client.chat.completions.create({
        model: 'deepseek-chat',  // DeepSeek-V3
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `${durationConstraint}\n以下是视频转录文本：\n\n${formattedTranscript}`,
          },
        ],
        temperature: 0.3,        // 较低的温度使输出更稳定
        max_tokens: 4096,
        response_format: { type: 'json_object' },  // 强制 JSON 输出
      });

      const text = completion.choices[0]?.message?.content;
      if (!text) {
        throw new Error('DeepSeek returned empty response');
      }

      try {
        const parsed = JSON.parse(text);
        let finalTakeaways = (parsed.takeaways || []).map((t: any, index: number) => ({
          title: t.title || `Key Point ${index + 1}`,
          summary: t.summary || '',
          timestamp: typeof t.timestamp === 'number' ? t.timestamp : 0,
          duration: t.duration || '0:00',
        }));

        // 兜底过滤：如果 AI 依然返回了超过视频时长的点，则将其修正或剔除
        if (maxDurationSeconds) {
          finalTakeaways = finalTakeaways.filter((t: AITakeaway) => t.timestamp < maxDurationSeconds);
        }

        return {
          title: parsed.title || 'Untitled Video',
          takeaways: finalTakeaways,
        };
      } catch {
        console.error('Failed to parse AI response:', text);
        throw new Error('Failed to parse AI analysis result');
      }
    } catch (error: any) {
      lastError = error;
      const statusCode = error.status || error.statusCode;
      const isRateLimit = statusCode === 429 || error.message?.includes('429') || error.message?.includes('Too Many Requests');

      if (isRateLimit && attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 指数退避: 3s, 6s, 12s
        console.log(`⏳ Rate limited (429). Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 1}...`);
        await sleep(delayMs);
        continue;
      }

      // 非 429 错误或重试次数用完，直接抛出
      throw error;
    }
  }

  throw lastError || new Error('Failed to analyze transcript after retries');
}
