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
/**
 * 翻译字幕片段
 * 为了提高效率，这里采用批量翻译的方式（每批 30-50 条）
 */
export async function translateTranscriptSegments(
  texts: string[]
): Promise<string[]> {
  if (!texts || texts.length === 0) return [];

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
  });

  const BATCH_SIZE = 40;
  const results: string[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    try {
      console.log(`🤖 Translating transcript batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      const completion = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一个专业的翻译助手。请将用户提供的字幕片段列表翻译成中文。保持原意，语言地道。请严格按照原始列表的顺序返回一个 JSON 数组，数组中只包含翻译后的字符串。不要返回任何其他解释。',
          },
          {
            role: 'user',
            content: JSON.stringify(batch),
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        // 如果返回的是对象形式 { "translations": [...] } 或直接是数组
        const translatedBatch = Array.isArray(parsed) ? parsed : (parsed.translations || Object.values(parsed)[0]);
        if (Array.isArray(translatedBatch)) {
          results.push(...translatedBatch.map(s => String(s)));
        } else {
          // 兜底：如果格式不对，填充原文占位
          results.push(...batch);
        }
      }
    } catch (error) {
      console.error('Batch translation failed:', error);
      results.push(...batch); // 失败时回退到原文
    }
  }

  return results;
}

/**
 * 视频对话流式接口
 */
export async function* streamChat(
  videoId: string,
  transcriptItems: { text: string; offset: number }[],
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured');

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey,
  });

  // 格式化字幕作为上下文
  const transcriptContext = transcriptItems
    .map(item => {
      const seconds = Math.floor(item.offset / 1000);
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      const ts = `[${m}:${s < 10 ? '0' : ''}${s}]`;
      return `${ts} ${item.text}`;
    })
    .join('\n');

  const systemPrompt = `你是一个专业的视频内容分析助手。
用户的提问是基于一段视频的转录文本进行的。
你的任务是根据提供的视频内容回答问题。

视频转录内容（带时间戳）：
${transcriptContext}

要求：
1. 仅基于视频内容回答，不要胡编乱造。
2. 如果回答中涉及视频的具体片段，请务必标注对应的时间戳，格式为 [mm:ss]，例如 [02:15]。
3. 语言地道、简洁，使用中文回答。
4. 鼓励使用 Markdown 格式（如列表、加粗）使回答更易读。
5. 如果用户要求跳转到某个位置，你可以提供对应的时间戳引导用户点击。`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];

  const stream = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages,
    stream: true,
    temperature: 0.5,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      yield content;
    }
  }
}
