<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Clock, FileText, Image as ImageIcon, Trash2, AlertTriangle, Loader2, X, RefreshCw, ChevronLeft, ChevronRight, Search, History } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

interface HistoryItem {
  videoId: string;
  title: string | null;
  url: string;
  platform: string;
  duration: number | null; // 新增：视频时长（秒）
  takeawayCount: number;
  analyzedAt: string;
  isIndexed: boolean;
  category: string | null;
  tags: string[];
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits(['update:modelValue']);

const { getAuthHeaders, authState } = useAuth();
const API_BASE = import.meta.env.VITE_API_URL;
const router = useRouter();

const totalPages = ref(0);
const page = ref(1);
const limit = 20;
const totalCount = ref(0);
const hasMore = ref(false);
const isLoading = ref(false);
let lastLoadTime = 0;

// Data for grouped overview (summary)
const overviewList = ref<HistoryItem[]>([]);
// Data for specific period detail (paginated)
const periodHistoryList = ref<HistoryItem[]>([]);

// Active period for drill-down view: { label, startDate, endDate }
const activePeriod = ref<{ label: string; start?: string; end?: string } | null>(null);

const enterPeriod = (group: { label: string; start?: string; end?: string }) => {
  activePeriod.value = group;
  page.value = 1;
  loadPeriodHistory(1);
};

const exitPeriod = () => {
  activePeriod.value = null;
  page.value = 1;
  // No need to reload overview if we haven't modified it
};

const showDeleteConfirm = ref(false);
const deleteTargetItem = ref<HistoryItem | null>(null);
const isDeleting = ref(false);

const reindexingVideoId = ref<string | null>(null);

const searchQuery = ref('');
const searchResults = ref<any[]>([]);
const isSearching = ref(false);
const searchPage = ref(1);
const searchHasMore = ref(false);
const isSearchingMore = ref(false);
const searchTotal = ref(0);

// watch searchQuery separately to handle debounced search
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, (newQuery) => {
  if (debounceTimer) clearTimeout(debounceTimer);

  if (!newQuery.trim()) {
    searchResults.value = [];
    isSearching.value = false;
    searchHasMore.value = false;
    return;
  }

  isSearching.value = true;
  searchPage.value = 1; // Reset to page 1 on new query
  debounceTimer = setTimeout(() => {
    handleSearch(1);
  }, 500);
});

const handleSearch = async (targetPage = 1) => {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    isSearching.value = false;
    searchHasMore.value = false;
    return;
  }

  const isMore = targetPage > 1;
  if (isMore) isSearchingMore.value = true;
  else isSearching.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/videos/search?q=${encodeURIComponent(searchQuery.value)}&page=${targetPage}&limit=${limit}`, {
      headers: getAuthHeaders()
    });

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const result = await res.json();
    if (result.success) {
      const decodedData = (result.data || []).map((r: any) => ({
        ...r,
        title: decodeHtml(r.title)
      }));

      if (isMore) {
        searchResults.value = [...searchResults.value, ...decodedData];
      } else {
        searchResults.value = decodedData;
      }

      searchHasMore.value = result.meta?.hasMore || false;
      searchPage.value = targetPage;
      searchTotal.value = result.meta?.totalCount || 0;
    }
  } catch (err) {
    console.error('[Search] Failed:', err);
    notify('搜索失败', '无法获取搜索结果', 'error');
  } finally {
    isSearching.value = false;
    isSearchingMore.value = false;
  }
};

const loadMoreSearch = () => {
  if (searchHasMore.value && !isSearchingMore.value) {
    handleSearch(searchPage.value + 1);
  }
};

const clearSearch = () => {
  searchQuery.value = '';
  searchResults.value = [];
};

const handleResultClick = (res: any) => {
  closeHistory();
  const query: any = { url: `${res.platform === 'youtube' ? 'https://www.youtube.com/watch?v=' : ''}${res.videoId}` };
  if (res.offset > 0) {
    query.t = Math.floor(res.offset / 1000);
  }
  router.push({ path: '/video', query });
};

// 通知 Modal 状态
const showNotification = ref(false);
const notificationTitle = ref('');
const notificationMessage = ref('');
const notificationType = ref<'success' | 'error' | 'info'>('info');

const groupedHistory = computed(() => {
  const groups: { label: string; items: HistoryItem[]; start?: string; end?: string; hasMore?: boolean }[] = [
    { label: '今天 / Today', items: [] },
    { label: '昨天 / Yesterday', items: [] },
    { label: '最近七天 / This Week', items: [] },
    { label: '更早 / Earlier', items: [] }
  ];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayEnd);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

  const weekAgoStart = new Date(todayStart);
  weekAgoStart.setDate(weekAgoStart.getDate() - 7);

  // Set ranges for the groups to use in API calls
  groups[0].start = todayStart.toISOString();
  groups[0].end = todayEnd.toISOString();

  groups[1].start = yesterdayStart.toISOString();
  groups[1].end = yesterdayEnd.toISOString();

  groups[2].start = weekAgoStart.toISOString();
  groups[2].end = yesterdayStart.toISOString(); // From 7 days ago until before yesterday

  groups[3].end = weekAgoStart.toISOString(); // Anything before 7 days ago

  // Use overviewList for the groups
  overviewList.value.forEach(item => {
    const itemDate = new Date(item.analyzedAt);
    const itemTime = itemDate.getTime();

    if (itemTime >= todayStart.getTime()) {
      groups[0].items.push(item);
    } else if (itemTime >= yesterdayStart.getTime()) {
      groups[1].items.push(item);
    } else if (itemTime >= weekAgoStart.getTime()) {
      groups[2].items.push(item);
    } else {
      groups[3].items.push(item);
    }
  });

  return groups.filter(g => g.items.length > 0);
});

const notify = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
  notificationTitle.value = title;
  notificationMessage.value = message;
  notificationType.value = type;
  showNotification.value = true;
};

const decodeHtml = (html: string) => {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
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

const closeHistory = () => {
  emit('update:modelValue', false);
};

const loadHistory = async () => {
  if (isLoading.value) return;

  const now = Date.now();
  if (now - lastLoadTime < 800) return;

  isLoading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/videos?page=1&limit=100`, { headers: getAuthHeaders() });
    const result = await res.json();
    if (result.success) {
      lastLoadTime = Date.now();
      overviewList.value = result.data.map((item: any) => ({
        ...item,
        title: decodeHtml(item.title)
      }));
      totalCount.value = result.meta?.totalCount || 0;
    }
  } catch (error) {
    console.error('Failed to load history overview:', error);
  } finally {
    isLoading.value = false;
  }
};

const loadPeriodHistory = async (targetPage = 1) => {
  if (isLoading.value || !activePeriod.value) return;

  page.value = targetPage;
  isLoading.value = true;

  let url = `${API_BASE}/api/videos?page=${page.value}&limit=${limit}`;
  if (activePeriod.value.start) url += `&startDate=${activePeriod.value.start}`;
  if (activePeriod.value.end) url += `&endDate=${activePeriod.value.end}`;

  try {
    const res = await fetch(url, { headers: getAuthHeaders() });
    const result = await res.json();
    if (result.success) {
      periodHistoryList.value = result.data.map((item: any) => ({
        ...item,
        title: decodeHtml(item.title)
      }));
      hasMore.value = result.meta?.hasMore || false;
      totalPages.value = Math.ceil((result.meta?.totalCount || 0) / limit);
    }
  } catch (error) {
    console.error('Failed to load period history:', error);
    notify('加载失败', '无法获取该时段记录', 'error');
  } finally {
    isLoading.value = false;
  }
};

const handlePageChange = (newPage: number) => {
  if (newPage >= 1 && newPage <= totalPages.value) {
    loadPeriodHistory(newPage);
  }
};

const loadVideoHistory = (item: HistoryItem) => {
  closeHistory();
  router.push({ path: '/video', query: { url: item.url } });
};

const getThumbnailUrl = (item: HistoryItem) => {
  if (item.platform === 'youtube') {
    return `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;
  }
  return '';
};

const deleteHistory = (event: Event, item: HistoryItem) => {
  event.stopPropagation();
  deleteTargetItem.value = item;
  showDeleteConfirm.value = true;
};


const confirmDelete = async () => {
  if (!deleteTargetItem.value) return;

  isDeleting.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/videos/${deleteTargetItem.value.videoId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (result.success) {
      await loadHistory();
      showDeleteConfirm.value = false;
      deleteTargetItem.value = null;
      notify('删除成功', '视频分析记录已彻底从云端移除', 'success');
    } else {
      notify('删除失败', result.error || '无法执行删除操作', 'error');
    }
  } catch (error) {
    console.error('Delete history failed:', error);
    notify('网络错误', '删除失败，请检查网络连接', 'error');
  } finally {
    isDeleting.value = false;
  }
};

const handleReindex = async (event: Event, item: HistoryItem) => {
  event.stopPropagation();
  if (reindexingVideoId.value) return;

  reindexingVideoId.value = item.videoId;
  try {
    const res = await fetch(`${API_BASE}/api/videos/${item.videoId}/re-embed`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      // 乐观更新：立即在本地列表中标记为已索引，让按钮消失
      item.isIndexed = true;
      await loadHistory();
      notify('修复成功', '语义搜索索引已在后台开始重构，稍后即可进行语义搜索。', 'success');
    } else {
      const data = await res.json();
      notify('修复失败', data.error || '重构索引时发生错误', 'error');
    }
  } catch (err) {
    console.error('Re-index failed:', err);
    notify('重构失败', '请检查网络连接或稍后重试', 'error');
  } finally {
    reindexingVideoId.value = null;
  }
};

const handleEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (showNotification.value) {
      showNotification.value = false;
    } else if (showDeleteConfirm.value) {
      showDeleteConfirm.value = false;
    } else if (props.modelValue) {
      closeHistory();
    }
  }
};

// Listen for events
onMounted(() => {
  window.addEventListener('video-analyzed', loadHistory);
  window.addEventListener('keydown', handleEsc);
});

onUnmounted(() => {
  window.removeEventListener('video-analyzed', loadHistory);
  window.removeEventListener('keydown', handleEsc);
});

// Watch for auth state changes to reload history
watch(() => authState.currentUser, (newUser) => {
  if (newUser) {
    loadHistory();
  } else {
    overviewList.value = [];
    periodHistoryList.value = [];
  }
});

</script>

<template>
  <div>
    <!-- History Backdrop -->
    <div
      class="history-backdrop"
      :class="{ 'is-visible': modelValue }"
      @click="closeHistory"
    ></div>

    <!-- History Sidebar Drawer -->
    <aside class="history-sidebar glass-panel" :class="{ 'is-open': modelValue }">
      <div class="sidebar-header" style="justify-content: space-between; align-items: center; display: flex;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button v-if="activePeriod" class="btn-back" @click="exitPeriod" title="返回概览">
            <ChevronLeft :size="20" />
          </button>
          <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">
            <Clock class="icon accent" :size="20"/>
            {{ activePeriod ? activePeriod.label : '历史记录' }}
          </h3>
        </div>
        <button class="btn-text" @click="closeHistory" style="padding: 4px;">
          <X :size="20" />
        </button>
      </div>

      <!-- Search Bar -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <Search :size="16" class="search-icon" />
          <input
            v-model="searchQuery"
            placeholder="语义搜索：输入视频内容描述..."
            class="search-input"
            @keyup.enter="handleSearch()"
          />
          <button v-if="searchQuery" @click="clearSearch" class="btn-clear">
            <X :size="14" />
          </button>
          <button class="btn-search-trigger" @click="handleSearch()" :disabled="isSearching">
            <Loader2 v-if="isSearching" :size="16" class="spin" />
            <span v-else>搜索</span>
          </button>
        </div>
      </div>

      <div class="history-list-wrapper">
        <!-- Search View State -->
        <div v-if="searchQuery" class="view-scroll-container">
          <div v-if="isSearching" class="search-loading-state">
            <Loader2 :size="32" class="spin accent" />
            <p>正在语义搜索中...</p>
          </div>
          <div v-else class="search-results-container">
            <div class="search-results-label">
              <span v-if="searchResults.length > 0">
                已显示 {{ searchResults.length }} / {{ searchTotal }} 条视频记录
              </span>
              <span v-else>未找到相关内容</span>
            </div>

            <div class="group-items-grid">
              <div
                v-for="(res, idx) in searchResults"
                :key="idx"
                class="history-item glass-panel search-result-card"
                @click="handleResultClick(res)"
              >
                <div class="history-thumb-wrapper">
                  <img
                    v-if="getThumbnailUrl(res)"
                    :src="getThumbnailUrl(res)"
                    class="history-thumb"
                    loading="lazy"
                  />
                  <div v-else class="history-thumb-placeholder" :class="res.platform">
                    <ImageIcon :size="24" class="thumb-icon" />
                  </div>
                  <!-- Search score badge -->
                  <div class="res-score-badge">{{ Math.round(res.score * 100) }}% 匹配</div>
                  <div v-if="res.duration" class="duration-badge">{{ formatDuration(res.duration) }}</div>
                </div>

                <div class="history-item-content">
                  <div class="history-title-row">
                    <div class="history-title" v-html="highlightText(res.title || '未命名视频', searchQuery)"></div>
                  </div>

                  <!-- Match details -->
                  <div class="match-snippet">
                     <div class="match-type-tag" :class="res.matchType">
                       {{ res.matchType === 'title' ? '标题匹配' : '内容提及' }}
                     </div>
                     <p class="match-text">“<span v-html="highlightText(res.matchedText, searchQuery)"></span>”</p>
                  </div>

                  <div class="history-meta">
                    <div style="display: flex; align-items: center; gap: 4px;">
                      <span class="platform-badge" :class="res.platform">{{ res.platform }}</span>
                    </div>
                    <span class="res-time-jump" v-if="res.offset > 0" title="点击跳转至相应时间点" @click.stop="handleResultClick(res)">
                      <Clock :size="12" /> {{ formatDuration(Math.floor(res.offset / 1000)) }}
                    </span>
                  </div>

                  <!-- Tags and Category -->
                  <div v-if="res.category || (res.tags && res.tags.length > 0)" class="history-tags-row">
                    <span v-if="res.category" class="category-chip">{{ res.category }}</span>
                    <span v-for="tag in res.tags.slice(0, 2)" :key="tag" class="tag-chip">#{{ tag }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Search Pagination / Load More -->
            <div v-if="searchHasMore || isSearchingMore" class="search-load-more-wrapper">
              <button
                class="btn-load-more"
                :disabled="isSearchingMore"
                @click="loadMoreSearch"
              >
                <Loader2 v-if="isSearchingMore" :size="16" class="spin" />
                <span>{{ isSearchingMore ? '正在加载...' : '加载更多搜索结果' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Period Detail View (Drill-down) -->
        <div v-else-if="activePeriod" class="view-scroll-container period-detail-container">
          <div class="group-items-grid">
             <div
                v-for="item in periodHistoryList"
                :key="item.videoId"
                class="history-item glass-panel"
                @click="loadVideoHistory(item)"
              >
                <!-- Reuse item content logic -->
                <div class="history-thumb-wrapper">
                  <img
                    v-if="getThumbnailUrl(item)"
                    :src="getThumbnailUrl(item)"
                    class="history-thumb"
                  />
                  <div v-else class="history-thumb-placeholder" :class="item.platform">
                    <ImageIcon :size="24" class="thumb-icon" />
                  </div>
                  <div v-if="item.duration" class="duration-badge">{{ formatDuration(item.duration) }}</div>
                </div>
                <div class="history-item-content">
                  <div class="history-title-row">
                    <div class="history-title">{{ item.title || '未命名视频' }}</div>
                    <button class="delete-history-btn" @click="deleteHistory($event, item)">
                      <Trash2 :size="16" />
                    </button>
                  </div>
                  <div class="history-meta">
                    <span class="platform-badge" :class="item.platform">{{ item.platform }}</span>
                    <span class="meta-date">{{ new Date(item.analyzedAt).toLocaleDateString() }}</span>
                  </div>
                  <div v-if="item.category || (item.tags && item.tags.length > 0)" class="history-tags-row">
                    <span v-if="item.category" class="category-chip">{{ item.category }}</span>
                    <span v-for="tag in item.tags.slice(0, 2)" :key="tag" class="tag-chip">#{{ tag }}</span>
                  </div>
                </div>
             </div>
          </div>
        </div>

        <!-- Normal Grouped View (Overview) -->
        <div v-else class="view-scroll-container">
          <template v-if="overviewList.length > 0">
            <div v-for="group in groupedHistory" :key="group.label" class="history-group">
              <div class="group-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div class="group-icon-wrapper">
                    <History :size="16" class="header-icon" />
                  </div>
                  <span class="group-label-text">{{ group.label }}</span>
                  <span class="group-count">
                    {{ group.items.length }}
                    <span v-if="group.items.length >= 10" class="more-indicator">(已折叠)</span>
                  </span>
                </div>
                <button v-if="group.items.length >= 10" class="btn-show-all" @click="enterPeriod(group)">
                  查看全部 <ChevronRight :size="14" />
                </button>
              </div>
              <div class="group-items-grid">
                <div
                  v-for="item in group.items.slice(0, 10)"
                  :key="item.videoId"
                  class="history-item glass-panel"
                  @click="loadVideoHistory(item)"
                >
                  <div class="history-thumb-wrapper">
                    <img
                      v-if="getThumbnailUrl(item)"
                      :src="getThumbnailUrl(item)"
                      class="history-thumb"
                      loading="lazy"
                    />
                    <div v-else class="history-thumb-placeholder" :class="item.platform">
                      <ImageIcon :size="24" class="thumb-icon" />
                    </div>
                    <!-- 视频时长角标 -->
                    <div v-if="item.duration" class="duration-badge" :class="{ 'is-long-duration': item.duration > 2400 }">
                      {{ formatDuration(item.duration) }}
                    </div>
                    <!-- 长视频标记 -->
                    <div v-if="item.duration && item.duration > 2400" class="long-video-badge-overlay">
                      <Clock :size="10" stroke-width="3" />
                      <span>长视频</span>
                    </div>
                  </div>
                  <div class="history-item-content">
                    <div class="history-title-row">
                      <div class="history-title">{{ item.title || '未命名视频' }}</div>
                      <button class="delete-history-btn" title="删除记录" @click="deleteHistory($event, item)">
                        <Trash2 :size="16" />
                      </button>
                    </div>
                    <div v-if="!item.isIndexed" class="history-status-row">
                      <button
                        class="btn-repair-inline"
                        :class="{ 'is-loading': reindexingVideoId === item.videoId }"
                        @click="handleReindex($event, item)"
                      >
                        <RefreshCw :size="12" :class="{ spin: reindexingVideoId === item.videoId }" />
                        <span>修复索引</span>
                      </button>
                    </div>

                    <div class="history-meta">
                      <div style="display: flex; align-items: center; gap: 4px;">
                        <span class="platform-badge" :class="item.platform">{{ item.platform }}</span>
                      </div>
                      <span class="meta-date">{{ new Date(item.analyzedAt).toLocaleDateString() }}</span>
                      <span class="meta-takeaways" :title="item.takeawayCount + '个片段'">
                        <FileText :size="12" style="display:inline;vertical-align:-2px;margin-right:2px;"/>
                        {{ item.takeawayCount }}
                      </span>
                    </div>

                    <div v-if="item.category || (item.tags && item.tags.length > 0)" class="history-tags-row">
                      <span v-if="item.category" class="category-chip">{{ item.category }}</span>
                      <span v-for="tag in item.tags.slice(0, 3)" :key="tag" class="tag-chip">#{{ tag }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div v-if="overviewList.length === 0 && !isLoading" class="history-empty">
            暂无历史记录。
          </div>
        </div>
      </div>

      <!-- Pagination Footer - Shown ONLY in Specific Period View (Search pagination TBD) -->
      <div v-if="activePeriod && !searchQuery && totalPages > 1" class="history-pagination">
        <button
          class="btn-page"
          :disabled="page <= 1 || isLoading"
          @click="handlePageChange(page - 1)"
        >
          <ChevronLeft :size="16" />
        </button>

        <div class="page-info">
          <span class="page-current">{{ page }}</span>
          <span class="page-total">/ {{ totalPages }}</span>
        </div>

        <button
          class="btn-page"
          :disabled="page >= totalPages || isLoading"
          @click="handlePageChange(page + 1)"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </aside>

    <!-- Friendly Notification Modal -->
    <Transition name="modal-fade">
      <div v-if="showNotification" class="confirm-modal-overlay" @click.self="showNotification = false">
        <div class="confirm-modal glass-panel">
          <div class="confirm-icon-wrap" :class="notificationType">
            <Loader2 v-if="notificationType === 'info'" :size="32" class="confirm-icon" />
            <AlertTriangle v-else :size="32" class="confirm-icon" />
          </div>
          <h3>{{ notificationTitle }}</h3>
          <p>{{ notificationMessage }}</p>

          <div class="confirm-actions">
            <button class="btn-primary" @click="showNotification = false">我知道了</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Custom Delete Confirmation Modal -->
    <Transition name="modal-fade">
      <div v-if="showDeleteConfirm" class="confirm-modal-overlay" @click.self="showDeleteConfirm = false">
        <div class="confirm-modal glass-panel">
          <div class="confirm-icon-wrap">
            <AlertTriangle :size="32" class="confirm-icon" />
          </div>
          <h3>确认删除？</h3>
          <p>您确定要删除 <strong>{{ deleteTargetItem?.title || '此视频' }}</strong> 的所有分析记录及其关联数据吗？此操作不可撤销。</p>

          <div class="confirm-actions">
            <button class="btn-secondary" @click="showDeleteConfirm = false" :disabled="isDeleting">取消</button>
            <button class="btn-danger" @click="confirmDelete" :disabled="isDeleting">
              <Loader2 v-if="isDeleting" :size="18" class="spin" />
              <Trash2 v-else :size="18" />
              <span>{{ isDeleting ? '正在删除...' : '确认彻底删除' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* History Backdrop & Sidebar */
.history-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  z-index: 199;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.history-backdrop.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.history-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 60%;
  background: rgba(15, 15, 18, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  z-index: 200;
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-right: 1px solid var(--border-color);
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 10px 0 30px rgba(0,0,0,0.5);
}

.history-sidebar.is-open {
  transform: translateX(0);
}

.sidebar-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

/* History Elements Hierarchy */
.history-list-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Manage scrolling in children */
  position: relative;
}

.view-scroll-container {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
  display: flex;
  flex-direction: column;
  scrollbar-gutter: stable;
}

/* Custom Scrollbar Styles */
.view-scroll-container::-webkit-scrollbar {
  width: 6px;
}

.view-scroll-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.view-scroll-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.search-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 0;
  color: var(--text-muted);
}

.history-group {
  margin-bottom: 24px;
}

/* Sticky & Enhanced Headers */
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(30, 30, 40, 0.9); /* More prominent dark background */
  backdrop-filter: blur(16px);
  margin-bottom: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.group-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(var(--accent-rgb), 0.15);
  border-radius: 8px;
  color: var(--accent-light);
  box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.2);
}

.header-icon {
  filter: drop-shadow(0 0 4px var(--accent-color));
}

.group-label-text {
  font-size: 1.05rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.5px;
  background: linear-gradient(to right, #fff, rgba(255, 255, 255, 0.7));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.group-count {
  font-size: 0.8rem;
  color: var(--accent-light);
  font-weight: 700;
  background: rgba(var(--accent-rgb), 0.1);
  padding: 2px 10px;
  border-radius: 20px;
  border: 1px solid rgba(var(--accent-rgb), 0.2);
}

.group-items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
}

.history-item {
  display: flex;
  flex-direction: row; /* 调整为横向布局 */
  padding: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--border-color);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
  min-height: 130px; /* 移除固定高度，改为最小高度 */
}

.history-item:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.history-item.active {
  border-color: var(--accent-light);
  background: rgba(99, 102, 241, 0.1);
  box-shadow: 0 0 0 1px var(--accent-light);
}

.history-thumb-wrapper {
  position: relative;
  width: 180px; /* 增加封面宽度 */
  height: 100%;
  flex-shrink: 0;
  background: #000;
  overflow: hidden;
}

.history-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--transition-normal);
}

.history-item:hover .history-thumb {
  transform: scale(1.05);
}

.history-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2937, #111827);
}

.history-thumb-placeholder.youtube {
  background: linear-gradient(135deg, #451a1a, #111827);
}

.history-thumb-placeholder.bilibili {
  background: linear-gradient(135deg, #1a3245, #111827);
}

.thumb-icon {
  color: var(--text-secondary);
  opacity: 0.5;
}


.history-item-content {
  padding: 12px 14px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.history-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: auto;
}

.history-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  margin-top: 2px;
}

.delete-history-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  opacity: 0;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.history-item:hover .delete-history-btn {
  opacity: 0.6;
}

.delete-history-btn:hover {
  color: #ef4444 !important;
  opacity: 1 !important;
  background: rgba(239, 68, 68, 0.1);
}

.history-meta {
  margin-top: auto; /* 推到最下面 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
}

.meta-date {
  color: var(--text-secondary);
}

.meta-takeaways {
  color: var(--text-secondary);
  background: rgba(255,255,255,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.platform-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  margin-right: 8px;
  letter-spacing: 0.5px;
}

.platform-badge.youtube {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.platform-badge.bilibili {
  background: rgba(0, 161, 214, 0.15);
  color: #00a1d6;
}

.duration-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 3;
}

.duration-badge.is-long-duration {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(0, 0, 0, 0.9);
  color: #f59e0b;
}

.long-video-badge-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  background: #f59e0b;
  color: #000;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.5px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  text-transform: uppercase;
}


.history-status-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.btn-repair-inline {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-repair-inline:hover:not(.is-loading) {
  background: #f59e0b;
  color: white;
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
}

.btn-repair-inline.is-loading {
  opacity: 0.8;
  cursor: wait;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.history-meta {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.03);
}

.meta-date {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.meta-takeaways {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.history-empty {
  color: var(--text-secondary);
  text-align: center;
  padding: 40px 0;
  font-size: 0.9rem;
}

/* Modal styles are often kept global or shared but here we include what's needed */
.confirm-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.confirm-modal {
  width: 90%;
  max-width: 400px;
  padding: 32px;
  text-align: center;
  background: rgba(20, 20, 23, 0.95);
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  border-radius: var(--radius-lg);
}

.confirm-icon-wrap {
  width: 64px;
  height: 64px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.confirm-icon-wrap.success {
  background: rgba(34, 197, 94, 0.1);
}

.confirm-icon-wrap.success .confirm-icon {
  color: #22c55e;
}

.confirm-icon-wrap.error {
  background: rgba(239, 68, 68, 0.1);
}

.confirm-icon-wrap.error .confirm-icon {
  color: #ef4444;
}

.confirm-icon-wrap.info {
  background: rgba(99, 102, 241, 0.1);
}

.confirm-icon-wrap.info .confirm-icon {
  color: var(--accent-color);
}

.confirm-icon {
  color: #ef4444;
}

.confirm-modal h3 {
  font-size: 1.5rem;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.confirm-modal p {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 32px;
}

.confirm-actions {
  display: flex;
  gap: 12px;
}

.confirm-actions button {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius-md);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
}

.btn-danger:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Pagination Styles */
.history-pagination {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.04);
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  flex-shrink: 0; /* 确保不被压缩 */
}

.btn-page {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-page:hover:not(:disabled) {
  background: var(--accent-light);
  color: #fff;
  border-color: var(--accent-color);
  transform: translateY(-1px);
}

.btn-page:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}

.page-current {
  color: #fff;
  font-weight: 700;
}

.page-total {
  color: var(--text-muted);
}

/* Category & Tags Styles */
.history-tags-row {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.category-chip {
  font-size: 0.7rem;
  padding: 2px 8px;
  background: var(--accent-color);
  color: #fff;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.tag-chip {
  font-size: 0.7rem;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.tag-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

/* Search Styles */
.search-section {
  margin-bottom: 20px;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 4px 4px 4px 12px;
  transition: all 0.2s;
}

.search-input-wrapper:focus-within {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--accent-light);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.2);
}

.search-icon {
  color: var(--text-muted);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 0.9rem;
  outline: none;
  padding: 6px 0;
}

.btn-clear {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
}

.btn-search-trigger {
  background: var(--accent-color);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-search-trigger:hover {
  background: var(--accent-light);
  transform: translateY(-1px);
}

.search-results-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 16px;
  padding-left: 4px;
}

.search-load-more-wrapper {
  display: flex;
  justify-content: center;
  margin: 24px 0 32px 0;
}

.btn-load-more {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(var(--accent-rgb), 0.1);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  color: var(--accent-light);
  padding: 10px 24px;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-load-more:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.2);
  border-color: var(--accent-light);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.2);
}

.btn-load-more:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.search-result-item {
  position: relative;
  border-left: 3px solid var(--accent-color);
}

.res-score-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.65rem;
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.match-snippet {
  background: rgba(255, 255, 255, 0.03);
  padding: 8px;
  border-radius: 8px;
  margin-bottom: 8px;
}

.match-type-tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 800;
  margin-bottom: 4px;
}

.match-type-tag.title { color: var(--accent-color); }
.match-type-tag.subtitle { color: #f59e0b; }

.match-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-style: italic;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.res-time-jump {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--accent-light);
  font-weight: 700;
  font-size: 0.75rem;
}

.search-result-card {
  border-left: 3px solid var(--accent-color);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 16px;
  padding: 12px 0 12px 4px;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(15, 15, 18, 0.9);
  backdrop-filter: blur(8px);
}

.btn-show-all {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--accent-light);
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-show-all:hover {
  background: rgba(var(--accent-rgb), 0.15);
  border-color: var(--accent-color);
  transform: translateX(2px);
}

.btn-back {
  background: rgba(255, 255, 255, 0.05);
  border: none;
  color: #fff;
  padding: 6px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.btn-back:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* Pagination Styles */
.btn-primary {
  background: var(--accent-color);
  color: white;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
}

@media (max-width: 800px) {
  .history-sidebar {
    width: 85%;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .history-item {
    flex-direction: row;
    height: 100px;
    flex: none;
  }

  .history-thumb-wrapper {
    width: 160px;
    height: 100%;
    aspect-ratio: auto;
  }

  .history-title {
    min-height: auto;
    font-size: 0.85rem;
  }
}
/* Period Detail View Specific Styles */
.period-detail-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.search-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 0;
  color: var(--text-muted);
}

:deep(.highlight-mark) {
  color: #fbbf24;
  font-weight: 700;
  background: transparent;
  padding: 0 1px;
}
</style>
