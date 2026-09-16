import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Model } from '@earendil-works/pi-ai';

export interface PiAgentSubtitleItem {
  text: string;
  offset: number; // 毫秒
}

export interface PiAgentHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface PiAgentActionEvent {
  name: 'seek_video' | 'clip_highlight';
  params: Record<string, any>;
}

export interface PiAgentStreamOptions {
  videoId: string;
  transcriptItems: PiAgentSubtitleItem[];
  userMessage: string;
  modelKey?: string; // 选中的模型标识，如 deepseek:deepseek-chat, github-copilot:gpt-4o
  currentPlayTime?: number; // 当前播放进度（秒）
  history?: PiAgentHistoryItem[];
  onText?: (chunk: string) => void;
  onAction?: (action: PiAgentActionEvent) => void;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

export interface AgentModelOption {
  key: string;
  label: string;
  provider: 'deepseek' | 'github-copilot';
  modelId: string;
  badge: string;
  available: boolean;
}

export function getSupportedAgentModels(): AgentModelOption[] {
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasCopilot = !!(process.env.COPILOT_GITHUB_TOKEN || process.env.COPILOT_API_KEY || process.env.GITHUB_TOKEN);

  return [
    {
      key: 'deepseek:deepseek-chat',
      label: 'DeepSeek-V3',
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      badge: '推荐 · 极速',
      available: hasDeepSeek,
    },
    {
      key: 'deepseek:deepseek-reasoner',
      label: 'DeepSeek-R1 (深度思考)',
      provider: 'deepseek',
      modelId: 'deepseek-reasoner',
      badge: '强推理',
      available: hasDeepSeek,
    },
    {
      key: 'github-copilot:gpt-4o',
      label: 'Copilot · GPT-4o',
      provider: 'github-copilot',
      modelId: 'gpt-4o',
      badge: hasCopilot ? '已就绪' : '需配 Token',
      available: hasCopilot,
    },
    {
      key: 'github-copilot:claude-sonnet-4.5',
      label: 'Copilot · Claude Sonnet',
      provider: 'github-copilot',
      modelId: 'claude-sonnet-4.5',
      badge: hasCopilot ? '已就绪' : '需配 Token',
      available: hasCopilot,
    },
  ];
}

let cachedCopilotAccessToken = '';
let copilotTokenExpiresAt = 0;

export async function resolveApiKeyForProvider(provider: string): Promise<string> {
  if (provider === 'github-copilot') {
    if (process.env.COPILOT_API_KEY) {
      return process.env.COPILOT_API_KEY;
    }
    const githubToken = process.env.COPILOT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error(
        '未检测到 GitHub Copilot Token！请在 server/.env 中配置 COPILOT_GITHUB_TOKEN=ghp_xxx（或 COPILOT_API_KEY）以开启 Copilot 模型。'
      );
    }
    if (cachedCopilotAccessToken && Date.now() < copilotTokenExpiresAt - 60000) {
      return cachedCopilotAccessToken;
    }
    try {
      const { refreshGitHubCopilotToken } = await import('@earendil-works/pi-ai/dist/utils/oauth/github-copilot.js');
      const creds = await refreshGitHubCopilotToken(githubToken);
      cachedCopilotAccessToken = creds.access;
      copilotTokenExpiresAt = creds.expires;
      return cachedCopilotAccessToken;
    } catch (err: any) {
      console.warn('换取 GitHub Copilot Token 失败，尝试直接使用 Token:', err.message);
      return githubToken;
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured in server environment');
  }
  return apiKey;
}

export function resolveModelByKey(modelKey?: string): Model<any> {
  const key = modelKey || 'deepseek:deepseek-chat';

  if (key === 'deepseek:deepseek-reasoner') {
    return {
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner',
      api: 'openai-completions',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      compat: {
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek',
      },
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: 'high',
        xhigh: 'max',
      },
      input: ['text'],
      cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
      contextWindow: 64000,
      maxTokens: 8192,
    };
  }

  if (key === 'github-copilot:gpt-4o') {
    return {
      id: 'gpt-4o',
      name: 'GPT-4o (Copilot)',
      api: 'openai-completions',
      provider: 'github-copilot',
      baseUrl: 'https://api.individual.githubcopilot.com',
      headers: {
        'User-Agent': 'GitHubCopilotChat/0.35.0',
        'Editor-Version': 'vscode/1.107.0',
        'Editor-Plugin-Version': 'copilot-chat/0.35.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
  }

  if (key === 'github-copilot:claude-sonnet-4.5') {
    return {
      id: 'claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5 (Copilot)',
      api: 'anthropic-messages',
      provider: 'github-copilot',
      baseUrl: 'https://api.individual.githubcopilot.com',
      headers: {
        'User-Agent': 'GitHubCopilotChat/0.35.0',
        'Editor-Version': 'vscode/1.107.0',
        'Editor-Plugin-Version': 'copilot-chat/0.35.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
      compat: { supportsEagerToolInputStreaming: false },
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 144000,
      maxTokens: 8192,
    };
  }

  const modelId = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  return {
    id: modelId,
    name: 'DeepSeek Chat',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 4096,
  };
}

/**
 * 格式化字幕上下文，包含分钟:秒时间戳
 */
function formatTranscriptContext(items: PiAgentSubtitleItem[]): string {
  return items
    .map(item => {
      const totalSec = Math.floor(item.offset / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const ts = `[${m}:${s < 10 ? '0' : ''}${s}] (${totalSec}s)`;
      return `${ts} ${item.text}`;
    })
    .join('\n');
}

const SeekVideoParams = Type.Object({
  timestamp: Type.Number({ description: '目标跳转时间戳，以秒（second）为单位的整数' }),
  reason: Type.String({ description: '跳转原因或该时间点的重点摘要（10-30字）' }),
});

const ClipHighlightParams = Type.Object({
  startSec: Type.Number({ description: '切片起始秒数' }),
  endSec: Type.Number({ description: '切片结束秒数' }),
  title: Type.String({ description: '切片标题（简洁明确）' }),
});

/**
 * 运行 Pi Agent 视频伴学智能体
 */
export async function runPiVideoAgent(options: PiAgentStreamOptions): Promise<string> {
  const {
    transcriptItems,
    userMessage,
    modelKey,
    currentPlayTime,
    history = [],
    onText,
    onAction,
    onStatus,
    signal,
  } = options;

  const transcriptContext = formatTranscriptContext(transcriptItems);
  const currentTimeInfo = typeof currentPlayTime === 'number'
    ? `当前用户视频播放进度：第 ${currentPlayTime} 秒（约 ${Math.floor(currentPlayTime / 60)}分${currentPlayTime % 60}秒）。`
    : '用户当前播放进度未知。';

  // 1. 定义伴学 Agent 专属工具
  const seekVideoTool: AgentTool<typeof SeekVideoParams> = {
    name: 'seek_video',
    label: '跳转视频',
    description: '当用户询问视频具体某段内容、或者回答涉及到视频特定知识点时，调用该工具驱动视频播放器自动跳转到指定秒数。',
    parameters: SeekVideoParams,
    execute: async (toolCallId: string, params: any) => {
      if (onAction) {
        onAction({
          name: 'seek_video',
          params: {
            timestamp: Math.round(params.timestamp),
            reason: params.reason,
          },
        });
      }
      return {
        content: [{ type: 'text' as const, text: `已成功将播放器跳转至 ${params.timestamp} 秒（${params.reason}）。` }],
        details: params,
      };
    },
  };

  const clipHighlightTool: AgentTool<typeof ClipHighlightParams> = {
    name: 'clip_highlight',
    label: '创建高光切片',
    description: '当用户明确要求标记高光、截取片段，或者对话中识别出值得重点回看的精彩金句/核心演示时，调用此工具推荐切片。',
    parameters: ClipHighlightParams,
    execute: async (toolCallId: string, params: any) => {
      if (onAction) {
        onAction({
          name: 'clip_highlight',
          params: {
            startSec: Math.round(params.startSec),
            endSec: Math.round(params.endSec),
            title: params.title,
          },
        });
      }
      return {
        content: [{ type: 'text' as const, text: `已为用户标记切片区间：[${params.startSec}s - ${params.endSec}s] "${params.title}"。` }],
        details: params,
      };
    },
  };

  // 2. 构造系统提示词
  const systemPrompt = `你是一个内置在视频播放器中的智能视频伴学 Agent（Pi Video Copilot）。
你不仅能理解视频的完整转录与语境，还拥有直接与视频播放器交互的工具权限（如自动跳播、推荐切片）。

【当前视频信息】
${currentTimeInfo}

【视频完整转录上下文（带时间戳）】
${transcriptContext}

【你的核心能力与行为准则】
1. **苏格拉底式启发与伴学**：
   - 当用户提出问题时，不要只是机械地大段复制字幕。结合上下文给出通俗、精辟的解答，必要时可以反问或启发用户思考。
2. **主动调用工具联动播放器**：
   - 若回答涉及视频特定知识点，或者用户询问“在哪提到……”“跳到xxx”，**务必调用 seek_video 工具**，让播放器直接带用户回到现场！
   - 若用户表示“这段太棒了帮我记下来”或想要切片，调用 clip_highlight 工具。
   - 工具调用后，你仍然可以在最终回复中用温和亲切的语气向用户总结关键点。
3. **精准与真实**：
   - 所有时间戳必须依据上下文中的真实秒数，严禁虚构时间。若视频中没有提及用户所问的内容，诚实告知，不要胡编。
4. **语言与排版**：
   - 使用自然亲切的中文。可适当使用 Markdown 列表、加粗来突出重点，适度使用 Emoji 增加伴学亲和力。`;

  // 3. 构建历史消息上下文（针对 Pi Agent 结构规范化）
  const model = resolveModelByKey(modelKey);
  const agentMessages: any[] = history
    .filter(h => h.content && h.content.trim().length > 0)
    .map(h => {
      if (h.role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'text' as const, text: h.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: Date.now(),
        };
      }
      return {
        role: 'user',
        content: h.content,
        timestamp: Date.now(),
      };
    });

  // 4. 创建 Agent 实例
  const agent = new Agent({
    initialState: {
      model,
      systemPrompt,
      tools: [seekVideoTool, clipHighlightTool],
      messages: agentMessages,
    },
    getApiKey: () => resolveApiKeyForProvider(model.provider),
  });

  let fullResponse = '';

  // 5. 监听 Agent 事件流
  agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'tool_execution_start':
        if (onStatus) onStatus(`正在执行操作: ${event.toolName}...`);
        break;
      case 'message_update': {
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta' && update.delta) {
          fullResponse += update.delta;
          if (onText) onText(update.delta);
        }
        break;
      }
      case 'agent_end':
        break;
    }
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      agent.abort();
    });
  }

  // 6. 执行 prompt
  await agent.prompt(userMessage);

  if (agent.state.errorMessage) {
    throw new Error(`Pi Agent error: ${agent.state.errorMessage}`);
  }

  return fullResponse;
}
