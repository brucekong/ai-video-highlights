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
  "category": "视频分类（如：技术、职场、财商、生活、其它）",
  "tags": ["标签1", "标签2", "标签3"],
  "video_description": "一段吸引人的视频简介，适合发布在视频号、小红书等社交平台，需包含视频核心价值，字数约 100 字左右",
  "video_hashtags": "#话题1 #话题2 #话题3",
  "takeaways": [
    {
      "title": "要点标题（简洁有力，10-20个字）",
      "summary": "要点详细摘要（50-100个字）",
      "timestamp": 起始时间秒数（整数）,
      "duration": "该段持续时长，如 2:30"
    }
  ],
  "mindmap": "# 视频主题\n## 核心模块 A\n### 子观点 1\n### 子观点 2\n## 核心模块 B"
}

要求：
1. 提取 4-8 个最重要的核心要点
2. 每个要点必须有准确的时间戳（对应转录文本中 [mm:ss] 的时间标记）
3. **禁止胡编乱造时间点**：所有 timestamp 必须严格参考转录文本中出现的时间标记，不得超过视频的总时长。
4. 要点标题简洁有力，让用户一眼就能了解内容
5. 摘要需要概括该段落的核心内容
6. 时间戳必须从小到大排列
7. 如果转录文本是英文，请将标题和摘要翻译成中文
8. 根据内容判定一个最准确的分类（建议：技术、职场、教育、自媒体、财商、人文、生活、运动、其它）
9. 提取 3-5 个核心关键词作为标签
10. 给出一个适合视频号（微信视频号）发布的视频描述，语气要有吸引力，概括视频价值
11. 提取 3-5 个最相关的 #话题（hashtags），以空格分隔
12. 生成一份完整的视频结构脑图Markdown文本，使用层级标题（# 为根，## 为二级，### 为三级），确保能够被 Markmap 渲染
13. 只返回 JSON，不要有任何其他文字或 markdown 标记`
;

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
): Promise<{ title: string; takeaways: AITakeaway[]; mindmap: string; category?: string; tags?: string[]; videoDescription?: string; videoHashtags?: string }> {
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
          mindmap: parsed.mindmap || '',
          category: parsed.category || '其它',
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          videoDescription: parsed.video_description || '',
          videoHashtags: parsed.video_hashtags || '',
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
 * 改进：使用对象键值对确保 1-to-1 映射，避免行偏移
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

  const results: string[] = new Array(texts.length);
  const batches: string[][] = [];

  const BATCH_SIZE = 100;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  console.log(`🤖 Starting translation for ${texts.length} segments in ${batches.length} parallel batches...`);

  // 并行处理所有批次，提升效率
  await Promise.all(batches.map(async (batch, batchIdx) => {
    const startIndex = batchIdx * BATCH_SIZE;

    // 将 batch 转化为带索引的结构，强制 AI 按结构化返回，避免合并
    const batchObj: Record<string, { original: string }> = {};
    batch.forEach((text, index) => {
      batchObj[index] = { original: text };
    });

    let lastError: Error | null = null;
    let translatedCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Batch ${batchIdx + 1}] Translation attempt ${attempt}/${MAX_RETRIES}...`);

        const completion = await client.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是一个影视字幕翻译机器人。你的唯一任务是将用户给出的 JSON 中的 'original' 英文字幕片段，逐条翻译为中文并填入 'translated'。

**💥 致命规则（只要违反一条，系统即刻崩溃，必须 100% 遵守）**：
1. **严格 1:1 照切**：输入中给定的键（如 "0", "1"），输出必须完全对应。绝对不能少掉任何一个键。
2. **绝对禁止行间合并**：不管两行上下文多么连贯，不管原句是不是断开了，**严禁**把第 1 行的意思合并翻译到第 0 行！如果第 0 行原文只有 "Because it is"，译文只能是 "因为它是"，绝不能包含第 1 行的词汇！
3. **消除幻觉**：如果原文字段里没有某个词的意思，你的翻译里就绝不能凭空多出这个意思。

**期望的输出格式**（纯 JSON）：
{
  "0": { "translated": "翻译内容" },
  "1": { "translated": "翻译内容" }
}`,
            },
            {
              role: 'user',
              content: JSON.stringify(batchObj),
            },
          ],
          temperature: 0, // 设为 0 以获得最高确定性
          response_format: { type: 'json_object' },
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('LLM returned empty response for translation batch');
        }

        const parsed = JSON.parse(content);
        batch.forEach((_, index) => {
          const item = parsed[index] || parsed[String(index)];
          const translated = item?.translated;
          if (translated) {
            results[startIndex + index] = String(translated);
            translatedCount++;
          } else {
            // 如果某一行没返回，可能是 LLM 漏了，赋予原文
            results[startIndex + index] = batch[index];
          }
        });

        console.log(`[Batch ${batchIdx + 1}] Successfully translated ${translatedCount}/${batch.length} segments.`);
        return; // 成功后退出重试循环
      } catch (error: any) {
        lastError = error;
        const statusCode = error.status || error.statusCode;
        const isRateLimit = statusCode === 429 || error.message?.includes('429') || error.message?.includes('Too Many Requests');

        if (isRateLimit && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`⏳ [Batch ${batchIdx + 1}] Rate limited. Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 1}...`);
          await sleep(delayMs);
          continue;
        }
        
        // 其他错误或重试耗尽
        console.error(`[Batch ${batchIdx + 1}] Attempt ${attempt} failed:`, error.message);
        if (attempt === MAX_RETRIES) {
          // 最后一次重试也失败，落回原文
          batch.forEach((text, index) => { results[startIndex + index] = text; });
        }
      }
    }
  }));

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

  const systemPrompt = `你是一个精炼、专业的视频内容助手。
用户的提问是基于当前视频的转录文本进行的。
你的任务是根据视频内容，直接、高效地回答用户的问题。

视频转录上下文（带时间戳）：
${transcriptContext}

原则与要求：
1. **直击要点**：直接回答用户的问题。不要在回答前主动提供视频全文总结或无关的开场白，除非用户明确要求。
2. **忠于内容**：仅基于视频转录内容回答，不要猜测视频未提及的信息。若视频未提及，请诚实告知。
3. **精准溯源**：如果回答涉及具体片段，必须标注对应的时间戳（格式为 [mm:ss]），以便用户跳转。
4. **格式规范**：使用简洁的中文。鼓励使用 Markdown（如列表、加粗）提高可读性。
5. **交互引导**：若用户询问进度或要求跳转，请提供对应时间戳引导。`;

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

import { pipeline } from '@xenova/transformers';

/**
 * 获取 Embedding 实例 (单例模式)
 */
let localPipe: any = null;
async function getLocalPipeline() {
  if (!localPipe) {
    console.log('📦 Loading local embedding model (Xenova/bge-m3)...');
    // bge-m3 默认输出 1024 维向量，匹配数据库 schema
    localPipe = await pipeline('feature-extraction', 'Xenova/bge-m3');
  }
  return localPipe;
}

/**
 * 获取文本的向量 (Embedding)
 * 支持本地 (transformers.js) 和 云端 (OpenAI 兼容接口)
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const strategyEnv = (process.env.EMBEDDING_STRATEGY || 'local').toLowerCase();
  const strategy = (strategyEnv === 'false' || strategyEnv === '0' || strategyEnv === 'null') ? 'local' : strategyEnv;

  if (strategy === 'local') {
    const pipe = await getLocalPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } else {
    // 云端方案
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
    const apiBase = process.env.EMBEDDING_API_BASE || 'https://api.openai.com/v1';
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    if (!apiKey) throw new Error('Cloud embedding requires EMBEDDING_API_KEY.');

    const client = new OpenAI({ apiKey, baseURL: apiBase });
    const response = await client.embeddings.create({
      model,
      input: text.replace(/\n/g, ' '),
      dimensions: model.includes('text-embedding-3') ? 1024 : undefined, // OpenAI 支持指定维度
    });

    return response.data[0].embedding;
  }
}

/**
 * 批量获取文本向量
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const strategyEnv = (process.env.EMBEDDING_STRATEGY || 'local').toLowerCase();
  const strategy = (strategyEnv === 'false' || strategyEnv === '0' || strategyEnv === 'null') ? 'local' : strategyEnv;

  if (strategy === 'local') {
    const pipe = await getLocalPipeline();
    const results: number[][] = [];
    // 本地批量处理
    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }
    return results;
  } else {
    // 云端批量处理
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
    const apiBase = process.env.EMBEDDING_API_BASE || 'https://api.openai.com/v1';
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    if (!apiKey) throw new Error('Cloud embedding requires EMBEDDING_API_KEY.');

    const client = new OpenAI({ apiKey, baseURL: apiBase });
    const response = await client.embeddings.create({
      model,
      input: texts.map(t => t.replace(/\n/g, ' ')),
      dimensions: model.includes('text-embedding-3') ? 1024 : undefined,
    });

    return response.data.map(d => d.embedding);
  }
}
