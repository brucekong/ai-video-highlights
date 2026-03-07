<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { Search, Loader2, Clock, FileText, SearchSlash, Video, MessageSquare, MapPin } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

const props = defineProps<{
  videoId?: string;
  placeholder?: string;
  minScore?: number;
  initialQuery?: string;
  compact?: boolean;
}>();

const emit = defineEmits(['result-click', 'search-start', 'search-end']);

const API_BASE = import.meta.env.VITE_API_URL;
const { getAuthHeaders } = useAuth();

const searchQuery = ref(props.initialQuery || '');
const isSearching = ref(false);
const searchResults = ref<any[]>([]);
const hasSearched = ref(false);
let debounceTimeout: any = null;

const handleSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    hasSearched.value = false;
    return;
  }

  isSearching.value = true;
  hasSearched.value = true;
  searchResults.value = []; // 发起新搜索前清空结果，保持状态一致
  emit('search-start');

  try {
    let url = `${API_BASE}/api/search?q=${encodeURIComponent(query)}&min_score=${props.minScore || 0.4}`;
    if (props.videoId) {
      url += `&videoId=${props.videoId}`;
    }

    const res = await fetch(url, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      searchResults.value = data.data;
    }
  } catch (e) {
    console.error('Search failed:', e);
  } finally {
    isSearching.value = false;
    emit('search-end');
  }
};

// Debounce search
watch(searchQuery, (newVal) => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  if (!newVal.trim()) {
    searchResults.value = [];
    hasSearched.value = false;
    return;
  }
  debounceTimeout = setTimeout(handleSearch, 500);
});

const getScoreColor = (score: number) => {
  if (score >= 0.8) return '#10B981'; // 高相关 - 翡翠绿
  if (score >= 0.6) return '#6366F1'; // 中相关 - 靛青蓝
  return '#F59E0B'; // 普通 - 琥珀橙
};

const highlightText = (text: string, query: string) => {
  if (!query || !text) return text;

  // Escape HTML to prevent injection
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const words = query.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return escaped;

  // Create a regex to match any of the words (case insensitive)
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex special chars
    .join('|');

  const regex = new RegExp(`(${pattern})`, 'gi');
  return escaped.replace(regex, '<span class="highlight-mark">$1</span>');
};

const handleResultClick = (result: any) => {
  emit('result-click', result);
};

const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const formatDuration = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const hDisplay = h > 0 ? `${h}:` : '';
  const mDisplay = m < 10 && h > 0 ? `0${m}:` : `${m}:`;
  const sDisplay = s < 10 ? `0${s}` : `${s}`;

  return `${hDisplay}${mDisplay}${sDisplay}`;
};

const focus = () => {
  const input = document.querySelector('.search-input-inner') as HTMLInputElement;
  input?.focus();
};

interface SearchResult {
  videoId: string;
  videoTitle: string;
  text: string;
  translatedText?: string;
  offset: number;
  duration?: number;
  similarity: number;
  matchType: 'title' | 'subtitle';
}

type UIItem =
  | { id: string; type: 'skeleton'; index: number }
  | { id: string; type: 'result'; data: SearchResult; index: number }
  | { id: string; type: 'empty'; index: number };

defineExpose({ focus, searchQuery });

const uiItems = computed<UIItem[]>(() => {
  if (isSearching.value) {
    return [
      { id: 'skel-1', type: 'skeleton', index: 0 },
      { id: 'skel-2', type: 'skeleton', index: 1 },
      { id: 'skel-3', type: 'skeleton', index: 2 },
    ];
  }
  if (searchResults.value.length > 0) {
    return searchResults.value.map((res: any, i: number) => ({
      id: `${res.videoId}-${res.offset}`,
      type: 'result',
      data: res as SearchResult,
      index: i
    }));
  }
  if (hasSearched.value) {
    return [{ id: 'empty-state', type: 'empty', index: 0 }];
  }
  return [];
});

const getThumbnailUrl = (item: SearchResult) => {
  // 假设只有 youtube 平台，或者根据 videoId 判断
  // 如果后端返回了 platform 更好，如果没有则默认尝试 youtube
  if (item.videoId) {
    return `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;
  }
  return '';
};

onUnmounted(() => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
});
</script>

<template>
  <div class="semantic-search-panel" :class="{ compact }">
    <!-- Input Section -->
    <div class="search-input-section">
      <div class="search-input-wrapper glass-panel">
        <Search class="search-icon" :size="18" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input-inner"
          :placeholder="placeholder || '想搜索什么内容？'"
          @keyup.enter="handleSearch"
        />
        <div class="search-actions">
          <Loader2 v-if="isSearching" :size="20" class="spin" />
          <button v-else class="btn-primary" @click="handleSearch" :disabled="!searchQuery.trim()">
            <Search :size="18" />
            <span>搜索</span>          </button>
        </div>
      </div>
    </div>

    <!-- Results Section -->
    <div class="search-results-container custom-scrollbar">
      <TransitionGroup name="list-premium" appear>
        <div v-for="item in uiItems" :key="item.id">
          <!-- Skeleton Loading -->
          <div
            v-if="item.type === 'skeleton'"
            class="skeleton-card glass-panel"
            :style="{ '--index': item.index }"
          >
            <div class="skeleton-shimmer"></div>
            <div class="result-main-horizontal">
              <div class="skeleton-thumb"></div>
              <div class="result-content">
                <div class="skeleton-line title"></div>
                <div class="skeleton-line full"></div>
                <div class="skeleton-line meta"></div>
              </div>
            </div>
          </div>

          <!-- Search Results -->
          <div
            v-else-if="item.type === 'result'"
            class="search-result-card glass-panel"
            :style="{ '--index': item.index }"
            @click="handleResultClick(item.data)"
          >
            <div class="result-main-horizontal">
              <!-- Thumbnail on the left -->
              <div class="result-thumbnail-wrap">
                <img :src="getThumbnailUrl(item.data)" class="result-thumbnail" loading="lazy" />
                <!-- Duration Badge on Thumbnail -->
                <div v-if="item.data.duration" class="thumb-duration-badge">
                  {{ formatDuration(item.data.duration) }}
                </div>
              </div>

              <!-- Content in the middle -->
              <div class="result-content">
                <!-- Video Title as the first row -->
                <div v-if="!videoId" class="result-video-header">
                  <Video :size="14" class="icon-accent" />
                  <span class="video-title-bold" v-html="highlightText(item.data.videoTitle, searchQuery)"></span>
                </div>

                <!-- Match detail with integrated icon -->
                <div class="result-text-summary">
                  <div class="main-text">
                    <component
                      :is="item.data.matchType === 'title' ? Video : MessageSquare"
                      :size="12"
                      class="match-type-icon-inline"
                      :class="item.data.matchType"
                    />
                    <span v-html="highlightText(item.data.translatedText || item.data.text, searchQuery)"></span>
                  </div>
                  <div v-if="item.data.translatedText" class="sub-text" v-html="highlightText(item.data.text, searchQuery)"></div>
                </div>
              </div>

              <!-- Score and Time on the far right -->
              <div class="score-column">
                <div class="score-badge-premium" :style="{ '--score-color': getScoreColor(item.data.similarity) }">
                  <span class="score-val">{{ Math.round(item.data.similarity * 100) }}</span>
                  <span class="score-percent">%</span>
                </div>

                <div class="timestamp-column">
                  <Clock :size="12" class="location-icon" />
                  <span>{{ formatTimeFromMs(item.data.offset) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else-if="item.type === 'empty'" class="empty-state glass-panel">
            <SearchSlash :size="32" />
            <p>没有找到相关内容</p>
            <span>尝试更换关键词或输入更具体的描述</span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.semantic-search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.search-input-section {
  width: 100%;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 4px 4px 4px 20px;
  gap: 12px;
  border-radius: 100px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-input-wrapper:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 30px rgba(99, 102, 241, 0.2);
  transform: translateY(-1px);
}

.search-icon {
  color: var(--text-muted);
}

:deep(.highlight-mark) {
  color: #fbbf24;
  font-weight: 700;
  background: transparent;
  padding: 0 1px;
}

.search-input-inner {
  flex: 1;
  background: transparent;
  border: none;
  height: 44px;
  color: white;
  outline: none;
  font-size: 1rem;
}

.search-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
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


.search-results-container {
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  height: 400px;
  min-height: 400px; /* Force stable height */
  flex-direction: column;
  gap: 8px; /* Consistent gap */
  padding: 4px;
  position: relative;
  /* Prevent scroll bar from shifting content if browser supports it */
  scrollbar-gutter: stable;
  margin-top: 10px;
}

/* Result Card Styles */
.search-result-card {
  padding: 16px 20px;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  width: 100%; /* Ensure width is stable */
  box-sizing: border-box;
}

.search-result-card:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateX(1px) translateY(-1px);
  border-color: var(--accent-color);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.result-main-horizontal {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.result-thumbnail-wrap {
  position: relative;
  width: 140px;
  height: 80px;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.thumb-duration-badge {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.result-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.search-result-card:hover .result-thumbnail {
  transform: scale(1.05);
}

.score-column {
  margin-left: auto;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 12px;
  min-width: 80px;
}

.timestamp-column {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-light);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.location-icon {
  opacity: 0.9;
}

.search-result-card:hover .score-badge-premium {
  transform: scale(1.1);
  filter: brightness(1.2);
}

.score-badge-premium {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--score-color);
  font-family: 'Outfit', sans-serif;
  transition: all 0.3s;
}

.score-val {
  font-size: 1.2rem;
  font-weight: 900;
  text-shadow: 0 0 20px color-mix(in srgb, var(--score-color) 40%, transparent);
}

.score-percent {
  font-size: 0.75rem;
  font-weight: 700;
  opacity: 0.8;
}

.match-type-icon-inline {
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
  margin-top: -2px;
  opacity: 0.9;
}

.match-type-icon-inline.title {
  color: var(--accent-color);
}

.match-type-icon-inline.subtitle {
  color: #fbbf24;
}

.result-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}


.location-icon {
  color: var(--accent-light);
  transform: translateY(-1px);
}

.highlight-location {
  color: var(--accent-light) !important;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--accent-rgb), 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  width: fit-content;
}

.result-video-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.icon-accent {
  color: var(--accent-color); opacity: 0.8;
}

.video-title-bold {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-text-summary {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 4px;
}

.main-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.9;
}

/* Skeleton Enhancements */
.skeleton-thumb {
  width: 140px;
  height: 80px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  flex-shrink: 0;
}

.skeleton-line.full { width: 100%; margin-bottom: 4px; }
.skeleton-line.title { width: 50%; height: 14px; margin-bottom: 8px; background: rgba(var(--accent-rgb), 0.1); }

/* Skeleton Styles */
.skeleton-card {
  position: relative;
  overflow: hidden;
  padding: 16px 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  width: 100%;
  box-sizing: border-box;
}

.skeleton-shimmer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.03), transparent);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.skeleton-line {
  height: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.skeleton-line.title { width: 70%; height: 16px; margin-bottom: 10px; }
.skeleton-line.meta { width: 40%; }
.skeleton-circle { width: 40px; height: 40px; border-radius: 50%; background: rgba(255, 255, 255, 0.05); }

/* Animation: list-premium */
.list-premium-enter-active {
  transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.6s ease, filter 0.6s ease;
  transition-delay: calc(var(--index) * 60ms);
}
.list-premium-leave-active {
  transition: all 0.2s ease;
  position: absolute;
  /* Width should match the container's inner width (100% - padding*2) */
  width: calc(100% - 8px);
  z-index: 0;
}
.list-premium-enter-from { opacity: 0; transform: translateY(30px) scale(0.9); filter: blur(10px); }
.list-premium-leave-to { opacity: 0; transform: scale(0.95); filter: blur(5px); }
.list-premium-move { transition: transform 0.5s cubic-bezier(0.23, 1, 0.32, 1); }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.empty-state, .initial-placeholder {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.02);
}

.empty-state p { font-size: 1.1rem; color: white; margin: 0; }
.initial-placeholder p { font-style: italic; opacity: 0.6; }

.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }

:deep(.highlight-mark) {
  color: #fbbf24;
  font-weight: 700;
  background: transparent;
  padding: 0 1px;
}
</style>
