<template>
  <div class="home-view animate-fade-in">
    <div class="hero">
      <div class="empty-icon-wrap">
        <Sparkles :size="64" class="empty-icon animate-pulse-glow" />
      </div>
      <h2>AI Video Highlights</h2>
      <p>AI 提取核心摘要和字幕，让您即刻跳转到最精彩的部分。</p>
    </div>

    <div class="input-area">
      <div class="input-group glass-panel">
        <input
          v-model="videoUrl"
          type="text"
          placeholder="在此处粘贴 YouTube 或 Bilibili 链接..."
          @keyup.enter="handleAnalyze"
        />
        <button class="btn-primary" @click="handleAnalyze" :disabled="!hasValidUrl">
          <Sparkles class="icon" :size="18" />
          <span>AI 分析转换</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

const router = useRouter();
const { checkLogin, waitForAuth } = useAuth();
const videoUrl = ref('');

// 检测视频平台
const platform = computed<'youtube' | 'bilibili' | ''>(() => {
  const url = videoUrl.value;
  if (!url) return '';
  if (/bilibili\.com\/video\/BV/.test(url) || /b23\.tv/.test(url)) return 'bilibili';
  if (/youtu\.?be/.test(url) || /youtube\.com/.test(url)) return 'youtube';
  return '';
});

const hasValidUrl = computed(() => !!platform.value);

const handleAnalyze = async () => {
  await waitForAuth();
  if (!checkLogin()) return; // 检查登录状态
  if (hasValidUrl.value) {
    router.push({ path: '/video', query: { url: videoUrl.value } });
  }
};
</script>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 160px);
  padding: 40px;
}
.hero {
  text-align: center;
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.empty-icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 24px;
  border-radius: 50%;
  margin-bottom: 24px;
}
.empty-icon {
  color: var(--accent-color);
}
.hero h2 {
  font-size: 2.8rem;
  font-weight: 700;
  margin: 16px 0;
  background: linear-gradient(to right, #F0F0F0, var(--text-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero p {
  font-size: 1.15rem;
  color: var(--text-secondary);
  max-width: 600px;
  line-height: 1.6;
}
.input-area {
  width: 100%;
  max-width: 800px;
  display: flex;
  justify-content: center;
}
.input-group {
  display: flex;
  align-items: center;
  padding: 8px 8px 8px 24px;
  width: 100%;
  border-radius: 100px;
  transition: all var(--transition-normal);
}
.input-group:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px var(--accent-glow);
}
.input-group input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 1.1rem;
  font-family: inherit;
  padding-right: 16px;
  min-width: 0;
}
.input-group input::placeholder {
  color: var(--text-secondary);
}
.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-color);
  color: white;
  padding: 12px 32px;
  border-radius: 100px;
  font-weight: 600;
  font-size: 1rem;
  transition: all var(--transition-fast);
  white-space: nowrap;
  border: none;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) {
  background: #4F46E5;
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}
.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.icon {
  display: inline-block;
}
</style>
