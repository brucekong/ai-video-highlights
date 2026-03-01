<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { X, Search, Loader2, Play, Clock, SearchSlash } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

const props = defineProps<{
  show: boolean;
  videoId: string;
  videoTitle?: string;
}>();

const emit = defineEmits(['close', 'seek']);

const API_BASE = import.meta.env.VITE_API_URL;
const { getAuthHeaders } = useAuth();

const searchQuery = ref('');
const isSearching = ref(false);
const searchResults = ref<any[]>([]);
const hasSearched = ref(false);

const handleSearch = async () => {
  if (!searchQuery.value.trim() || isSearching.value || !props.videoId) return;

  isSearching.value = true;
  hasSearched.value = true;
  searchResults.value = [];

  try {
    const res = await fetch(
      `${API_BASE}/api/search?q=${encodeURIComponent(searchQuery.value)}&videoId=${props.videoId}&min_score=0.4`,
      { headers: getAuthHeaders() }
    );
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

const handleResultClick = (res: any) => {
  emit('seek', res.offset);
  emit('close');
};

const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// Auto-focus input when shown
const searchInput = ref<HTMLInputElement | null>(null);
watch(() => props.show, (newVal) => {
  if (newVal) {
    nextTick(() => {
      searchInput.value?.focus();
    });
  } else {
    searchQuery.value = '';
    searchResults.value = [];
    hasSearched.value = false;
  }
});
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="video-search-overlay" @click.self="emit('close')">
      <div class="video-search-container glass-panel animate-scale-in">
        <!-- Header -->
        <div class="modal-header">
          <div class="header-info">
            <div class="search-badge">视频内搜索</div>
            <h3>{{ videoTitle || '搜索视频内容' }}</h3>
          </div>
          <button class="close-btn" @click="emit('close')">
            <X :size="20" />
          </button>
        </div>

        <!-- Search Input -->
        <div class="search-input-section">
          <div class="search-input-wrapper glass-panel">
            <Search class="search-icon" :size="20" />
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              placeholder="输入关键词，定位视频内容..."
              @keyup.enter="handleSearch"
            />
            <button class="btn-search" @click="handleSearch" :disabled="!searchQuery.trim() || isSearching">
              <Loader2 v-if="isSearching" :size="20" class="spin" />
              <span v-else>搜索</span>
            </button>
          </div>
        </div>

        <!-- content -->
        <div class="results-content custom-scrollbar">
          <div v-if="isSearching" class="loading-state">
            <Loader2 :size="32" class="spin" />
            <p>正在语义匹配中...</p>
          </div>

          <template v-else-if="searchResults.length > 0">
            <div
              v-for="(res, index) in searchResults"
              :key="index"
              class="search-result-item glass-panel"
              @click="handleResultClick(res)"
            >
              <div class="result-info">
                <p class="result-text">{{ res.translatedText || res.text }}</p>
                <div class="result-meta">
                  <span class="timestamp">
                    <Clock :size="12" />
                    {{ formatTimeFromMs(res.offset) }}
                  </span>
                  <div class="similarity-bar-wrap">
                    <div class="similarity-bar" :style="{ width: (res.similarity * 100) + '%', opacity: res.similarity }"></div>
                  </div>
                </div>
              </div>
              <div class="play-action">
                <Play :size="16" fill="currentColor" />
              </div>
            </div>
          </template>

          <div v-else-if="hasSearched" class="empty-state">
            <SearchSlash :size="48" />
            <p>视频内未找到匹配内容</p>
            <span>尝试更换关键词或输入更具体的描述</span>
          </div>

          <div v-else class="initial-state">
            <p>输入自然语言描述，为您定位到精准时刻</p>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.video-search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.video-search-container {
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: rgba(18, 20, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
  border-radius: 24px;
  overflow: hidden;
}

.modal-header {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-badge {
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.modal-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.search-input-section {
  padding: 24px;
  background: rgba(255, 255, 255, 0.02);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  padding: 4px 4px 4px 20px;
  gap: 12px;
  border-radius: 100px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.search-input-wrapper:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.2);
}

.search-icon {
  color: var(--text-secondary);
}

.search-input-wrapper input {
  flex: 1;
  background: transparent;
  border: none;
  height: 44px;
  color: white;
  outline: none;
  font-size: 1rem;
}

.btn-search {
  background: var(--accent-color);
  color: white;
  padding: 0 24px;
  height: 44px;
  border-radius: 100px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-search:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: scale(1.02);
}

.results-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px 24px;
  min-height: 200px;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.search-result-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--accent-color);
  transform: translateY(-2px) translateX(4px);
}

.result-info {
  flex: 1;
}

.result-text {
  font-size: 0.95rem;
  color: var(--text-primary);
  margin-bottom: 8px;
  line-height: 1.5;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 16px;
}

.timestamp {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--accent-color);
  font-weight: 600;
}

.similarity-bar-wrap {
  width: 100px;
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}

.similarity-bar {
  height: 100%;
  background: var(--accent-color);
}

.play-action {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.2s ease;
}

.search-result-item:hover .play-action {
  opacity: 1;
  transform: scale(1);
  background: var(--accent-color);
}

.loading-state, .empty-state, .initial-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-secondary);
}

.loading-state p { margin-top: 16px; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-state p { font-size: 1.1rem; color: #fff; margin: 0; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Modal Transitons */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.3s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }

@keyframes scale-in {
  from { transform: scale(0.95) translateY(20px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
</style>
