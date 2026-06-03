<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog glass-panel" :class="dialogClass">
      <div class="dialog-layout">
        <!-- Left: main form content -->
        <div class="dialog-main">
          <div class="dialog-header">
            <h3>
              <Plus v-if="mode === 'import'" :size="18" />
              <Pencil v-else :size="18" />
              {{ mode === 'import' ? '导入视频' : '编辑视频' }}
            </h3>
            <div class="header-actions">
              <button
                v-if="showAiToggle"
                class="btn-ai-toggle"
                :class="{ active: chatOpen }"
                @click="chatOpen = !chatOpen"
                title="AI 助手"
              >
                <Sparkles :size="14" />
              </button>
              <button @click="$emit('close')" class="btn-close"><X :size="16" /></button>
            </div>
          </div>

          <!-- Slot: content before meta form (e.g., import step indicator + file browser) -->
          <slot name="before-form"></slot>

          <!-- Meta form fields (shown based on parent's v-if) -->
          <slot name="form-fields"></slot>

          <!-- Slot: content after form fields (e.g., cover editor) -->
          <slot name="after-form"></slot>

          <!-- Footer -->
          <div class="dialog-footer">
            <slot name="footer"></slot>
          </div>
        </div>

        <!-- Right: AI chat side panel -->
        <div v-if="chatOpen" class="dialog-side-panel">
          <div class="side-panel-header">
            <Sparkles :size="14" />
            <span>AI 助手</span>
          </div>
          <template v-if="videoId">
            <div class="side-panel-messages" ref="chatListRef">
              <div v-if="!messages.length" class="ai-chat-empty">
                <p>向 AI 提问关于视频内容的问题</p>
                <div class="ai-chat-prompts">
                  <button @click="sendChat('帮我为这个视频生成一个吸引人的标题')">生成标题</button>
                  <button @click="sendChat('帮我写一段适合视频号的描述文案')">生成描述</button>
                  <button @click="sendChat('推荐一些适合这个视频的标签')">推荐标签</button>
                </div>
              </div>
              <div v-for="(msg, i) in messages" :key="i" class="ai-chat-msg" :class="msg.role">
                <div class="ai-chat-bubble">{{ msg.content }}</div>
                <button v-if="msg.role === 'assistant' && msg.content" class="btn-apply-ai" @click="$emit('apply-ai', msg.content)" title="应用到表单">
                  ✓ 应用
                </button>
              </div>
            </div>
            <div class="side-panel-input">
              <input
                v-model="chatInput"
                class="ai-chat-input"
                placeholder="输入问题..."
                @keydown.enter.prevent="sendChat()"
                :disabled="loading"
              />
              <button class="btn-send-chat" @click="sendChat()" :disabled="loading || !chatInput.trim()">
                <Send :size="14" />
              </button>
            </div>
          </template>
          <div v-else class="ai-chat-no-video">
            <p>请先关联一个已分析的视频才能使用 AI 助手</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { Plus, Pencil, Sparkles, X, Send } from 'lucide-vue-next';
import { useAuth } from '../../services/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';
const { getAuthHeaders } = useAuth();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const props = defineProps<{
  mode: 'import' | 'edit';
  videoId?: string;
  /** Whether the AI toggle button should be shown */
  showAiToggle?: boolean;
}>();

defineEmits<{
  close: [];
  'apply-ai': [content: string];
}>();

const chatOpen = ref(false);
const chatInput = ref('');
const messages = ref<ChatMessage[]>([]);
const loading = ref(false);
const chatListRef = ref<HTMLElement | null>(null);

const dialogClass = computed(() => ({
  'dialog-wide': !chatOpen.value,
  'dialog-with-panel': chatOpen.value,
}));

async function sendChat(prompt?: string) {
  const msg = prompt || chatInput.value.trim();
  if (!msg || loading.value || !props.videoId) return;
  chatInput.value = '';
  messages.value.push({ role: 'user', content: msg });
  messages.value.push({ role: 'assistant', content: '' });
  loading.value = true;

  try {
    const response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ videoId: props.videoId, message: msg }),
    });
    if (!response.ok) throw new Error('Chat failed');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.content) {
              assistantMsg += parsed.content;
              messages.value[messages.value.length - 1].content = assistantMsg;
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch (e) {
    messages.value[messages.value.length - 1].content = '请求失败: ' + (e as Error).message;
  } finally {
    loading.value = false;
    await nextTick();
    if (chatListRef.value) {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
    }
  }
}

// Reset chat when videoId changes
watch(() => props.videoId, () => {
  messages.value = [];
  chatInput.value = '';
});

defineExpose({ chatOpen, messages });
</script>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
  backdrop-filter: blur(4px);
}
.dialog {
  max-width: 90vw; max-height: 85vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.dialog-wide { width: 680px; }
.dialog-with-panel { width: 960px; }

.dialog-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.dialog-main {
  flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden;
  display: flex; flex-direction: column; padding: 1.75rem;
}
.dialog-side-panel {
  width: 320px; flex-shrink: 0;
  border-left: 1px solid #333;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.dialog-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.dialog-header h3 { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; margin: 0; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.dialog-footer { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: auto; padding-top: 1rem; }

.btn-close {
  width: 28px; height: 28px; border-radius: 6px;
  border: none; background: transparent; color: var(--text-secondary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.btn-close:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }

.btn-ai-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid #444; background: transparent;
  color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
}
.btn-ai-toggle:hover { border-color: var(--accent-color); color: var(--accent-color); }
.btn-ai-toggle.active { border-color: var(--accent-color); color: var(--accent-color); background: rgba(99,102,241,0.1); }

/* Side panel */
.side-panel-header {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 14px; font-size: 13px; font-weight: 600; color: var(--accent-color);
  border-bottom: 1px solid #333; flex-shrink: 0;
}
.side-panel-messages {
  flex: 1; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.side-panel-input {
  display: flex; gap: 6px; padding: 10px 12px;
  border-top: 1px solid #333; background: #1a1a1a; flex-shrink: 0;
}
.ai-chat-no-video {
  flex: 1; display: flex; align-items: center; justify-content: center;
  text-align: center; color: #888; font-size: 12px; padding: 12px;
}

.ai-chat-empty { text-align: center; color: #888; font-size: 12px; padding: 12px; }
.ai-chat-empty p { margin-bottom: 8px; }
.ai-chat-prompts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.ai-chat-prompts button { background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); color: var(--accent-color); font-size: 11px; padding: 4px 8px; border-radius: 12px; cursor: pointer; }
.ai-chat-prompts button:hover { background: rgba(99,102,241,0.2); }
.ai-chat-msg { display: flex; align-items: flex-start; gap: 4px; }
.ai-chat-msg.user { justify-content: flex-end; }
.ai-chat-msg.user .ai-chat-bubble { background: var(--accent-color); color: #fff; }
.ai-chat-bubble { max-width: 85%; padding: 8px 12px; border-radius: 8px; font-size: 12px; background: #2a2a2a; color: #ddd; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.btn-apply-ai { background: none; border: 1px solid #555; color: #aaa; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.btn-apply-ai:hover { border-color: var(--accent-color); color: var(--accent-color); }
.ai-chat-input { flex: 1; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; color: #eee; padding: 6px 8px; font-size: 12px; }
.ai-chat-input:focus { outline: none; border-color: var(--accent-color); }
.btn-send-chat { background: var(--accent-color); border: none; color: #fff; border-radius: 4px; padding: 4px 8px; cursor: pointer; display: flex; align-items: center; }
.btn-send-chat:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
