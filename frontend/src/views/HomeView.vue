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
          <input
            v-model="videoUrl"
            type="text"
            placeholder="在此处粘贴 YouTube 或 Bilibili 链接..."
            @keyup.enter="handleAnalyze"
          />
          <button class="btn-primary" @click="handleAnalyze" :disabled="!hasValidUrl">
            <Sparkles class="icon" :size="18" />
            <span>AI 分析</span>
          </button>
        </div>
        <p class="hint-text">支持输入视频链接，我们将为您提取关键点、脑图及转录文本。</p>
      </div>

      <!-- Semantic Search Section -->
      <div v-else class="search-area fade-in">
        <div class="input-group glass-panel">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="想搜索什么内容？(如：'视频里关于大模型的配置...')"
            @keyup.enter="handleSearch"
          />
          <button class="btn-primary" @click="handleSearch" :disabled="!searchQuery.trim() || isSearching">
            <Loader2 v-if="isSearching" :size="18" class="spin" />
            <Search v-else class="icon" :size="18" />
            <span>搜索</span>
          </button>
        </div>

        <!-- Search Results -->
        <div v-if="searchResults.length > 0" class="search-results">
          <div
            v-for="(res, idx) in searchResults"
            :key="idx"
            class="search-result-card glass-panel compact"
            @click="goToResult(res)"
          >
            <div class="result-main">
              <div class="result-content">
                <div class="result-text-summary">
                  <span class="translated">{{ res.translatedText || res.text }}</span>
                </div>
                <div class="result-meta">
                  <span class="video-title">
                    <FileText :size="12" />
                    {{ res.videoTitle }}
                  </span>
                  <span class="dot">•</span>
                  <span class="timestamp">
                    <Clock :size="12" />
                    {{ formatTimeFromMs(res.offset) }}
                  </span>
                </div>
              </div>
              <div class="result-score-wrap">
                 <div class="score-circle" :style="{ '--score-opacity': res.similarity }">
                    {{ Math.round(res.similarity * 100) }}
                 </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="hasSearched && !isSearching" class="no-results glass-panel">
          <p>没有找到相关内容，请尝试换一个描述方式。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles, Search, Loader2, FileText, Clock } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

const API_BASE = import.meta.env.VITE_API_URL;
const router = useRouter();
const { checkLogin, waitForAuth, getAuthHeaders } = useAuth();

const activeTab = ref<'analyze' | 'search'>('analyze');
const videoUrl = ref('');
const searchQuery = ref('');
const isSearching = ref(false);
const hasSearched = ref(false);
const searchResults = ref<any[]>([]);

let debounceTimeout: any = null;

// 防抖搜索监听
watch(searchQuery, (newVal) => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  if (!newVal.trim()) {
    searchResults.value = [];
    hasSearched.value = false;
    return;
  }

  debounceTimeout = setTimeout(() => {
    handleSearch();
  }, 500); // 500ms 防抖
});

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

const handleSearch = async () => {
  if (!searchQuery.value.trim() || isSearching.value) return;

  isSearching.value = true;
  hasSearched.value = true;
  searchResults.value = [];

  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery.value)}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      searchResults.value = data.data;
    }
  } catch (e) {
    console.error('Search failed:', e);
  } finally {
    isSearching.value = false;
  }
};

const goToResult = (res: any) => {
  // 构造对应的视频 URL (考虑到我们之后需要根据 videoId 重新获取分析结果)
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

const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};
</script>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  max-width: 1200px;
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

.input-area, .search-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  align-items: center;
}

.input-group {
  display: flex;
  padding: 6px 6px 6px 24px;
  border-radius: 100px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 600px; /* 固宽 600px */
  align-items: center;
  background: rgba(255, 255, 255, 0.03);
}

.input-group:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 8px 32px rgba(99, 102, 241, 0.15);
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
  font-size: 1.15rem;
  color: #fff;
  outline: none;
}

.hint-text {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
  max-height: 40vh; /* 限制结果列表高度 */
  overflow-y: auto;
  padding-right: 8px; /* 给滚动条留点空间 */
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
}

.fade-in {
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
