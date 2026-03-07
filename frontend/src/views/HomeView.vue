<template>
  <div class="home-view animate-fade-in">
    <div class="hero">
      <div class="empty-icon-wrap">
        <Sparkles :size="64" class="empty-icon animate-pulse-glow" />
      </div>
      <h2>AI Video Highlights</h2>
      <p>AI 提取核心摘要和字幕，让您即刻跳转到最精彩的部分。</p>
    </div>

    <div class="main-content">
      <!-- Tab Switcher -->
      <div class="tab-switcher glass-panel">
        <button
          :class="{ active: activeTab === 'analyze' }"
          @click="activeTab = 'analyze'"
        >
          <Sparkles :size="18" />
          <span>AI 分析转换</span>
        </button>
        <button
          :class="{ active: activeTab === 'search' }"
          @click="activeTab = 'search'"
        >
          <Search :size="18" />
          <span>全库语义搜索</span>
        </button>
      </div>

      <!-- Analyze Input Section -->
      <div v-if="activeTab === 'analyze'" class="input-area fade-in">
        <div class="input-group glass-panel">
          <Sparkles class="icon" :size="18" />
          <input
            v-model="videoUrl"
            type="text"
            placeholder="输入视频链接，我们将为您提取关键点、脑图及转录文本"
            @keyup.enter="handleAnalyze"
          />
          <button class="btn-primary" @click="handleAnalyze" :disabled="!hasValidUrl">
            <Sparkles :size="18" />
            <span>AI 分析</span>
          </button>
        </div>
      </div>

      <!-- Semantic Search Section -->
      <div v-else class="search-area fade-in">
        <SemanticSearchPanel
          placeholder="输入自然语言描述，为您定位到精准时刻"
          @result-click="goToResult"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles, Search } from 'lucide-vue-next';
import { useAuth } from '../services/auth';
import SemanticSearchPanel from '../components/SemanticSearchPanel.vue';

const router = useRouter();
const { checkLogin, waitForAuth } = useAuth();

const activeTab = ref<'analyze' | 'search'>('analyze');
const videoUrl = ref('');

const goToResult = (res: any) => {
  // 构造对应的视频 URL
  const videoLink = res.videoId.startsWith('BV')
    ? `https://www.bilibili.com/video/${res.videoId}`
    : `https://www.youtube.com/watch?v=${res.videoId}`;

  router.push({
    path: '/video',
    query: {
      url: videoLink,
      t: Math.floor(res.offset / 1000).toString()
    }
  });
};

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
  if (!checkLogin()) return;
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
  padding:20px 0;
  max-width: 1200px;
  min-width: 600px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  margin-bottom: 50px;
}

.empty-icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 24px;
  border-radius: 50%;
  margin-bottom: 24px;
  display: inline-block;
}

.empty-icon {
  color: var(--accent-color);
}

.hero h2 {
  font-size: 3rem;
  font-weight: 800;
  margin: 16px 0;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero p {
  color: var(--text-secondary);
  font-size: 1.2rem;
}

.main-content {
  width: 100%;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.tab-switcher {
  display: flex;
  padding: 5px;
  gap: 4px;
  border-radius: 12px;
  align-self: center;
  background: rgba(255, 255, 255, 0.03);
}

.tab-switcher button {
  padding: 8px 20px;
  border-radius: 8px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.tab-switcher button.active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.tab-switcher button:hover:not(.active) {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}
.icon {
  color: var(--text-secondary);
}
.input-area, .search-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  align-items: center;
}

.input-group {
  display: flex;
  padding: 4px 4px 4px 20px;
  gap: 12px;
  border-radius: 100px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 600px;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
}

.input-group:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 30px rgba(99, 102, 241, 0.2);
  transform: translateY(-1px);
}

.btn-primary {
  background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%);
  color: #fff;
  padding: 12px 28px;
  border-radius: 100px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 6px 20px rgba(79, 70, 229, 0.4);
  filter: brightness(1.1);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0) scale(1);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: grayscale(0.8);
}

.input-group input {
  flex: 1;
  background: transparent;
  border: none;
  height: 44px;
  font-size: 1rem;
  color: #fff;
  outline: none;
}

.hint-text {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}



/* 自定义滚动条样式 */
.search-results::-webkit-scrollbar {
  width: 6px;
}

.search-results::-webkit-scrollbar-track {
  background: transparent;
}

.search-results::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.search-results::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.search-result-card.compact {
  padding: 12px 20px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.03);
}

.search-result-card.compact:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateX(4px);
  border-color: var(--accent-color);
}

.result-main {
  display: flex;
  align-items: center;
  gap: 16px;
  justify-content: space-between;
}

.result-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-text-summary {
  font-size: 1rem;
  color: #fff;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.result-meta .video-title {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-color);
}

.result-meta .dot {
  opacity: 0.3;
}

.result-score-wrap {
  flex-shrink: 0;
}

.score-circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid rgba(16, 185, 129, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.05);
}

.timestamp {
  display: flex;
  align-items: center;
  gap: 4px;
}

.no-results {
  text-align: center;
  padding: 40px;
  border-radius: 20px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.repair-hint {
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.85rem;
  color: var(--text-muted);
}

.btn-outline-small {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px auto 0;
  transition: all 0.2s ease;
}

.btn-outline-small:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--accent-color);
  color: #fff;
}

.btn-outline-small:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeIn 0.4s ease-out;
}

.search-area {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
