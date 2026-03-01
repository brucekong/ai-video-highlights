<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Clock, FileText, Image as ImageIcon, Trash2, AlertTriangle, Loader2, X } from 'lucide-vue-next';
import { useAuth } from '../services/auth';

interface HistoryItem {
  videoId: string;
  title: string | null;
  url: string;
  platform: string;
  takeawayCount: number;
  analyzedAt: string;
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits(['update:modelValue']);

const { getAuthHeaders, authState } = useAuth();
const API_BASE = import.meta.env.VITE_API_URL;
const router = useRouter();

const historyList = ref<HistoryItem[]>([]);
const showDeleteConfirm = ref(false);
const deleteTargetItem = ref<HistoryItem | null>(null);
const isDeleting = ref(false);

const closeHistory = () => {
  emit('update:modelValue', false);
};

const decodeHtml = (html: string | null) => {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};

const loadHistory = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/videos`, { headers: getAuthHeaders() });
    const result = await res.json();
    if (result.success) {
      historyList.value = result.data.map((item: any) => ({
        ...item,
        title: decodeHtml(item.title)
      }));
    }
  } catch (error) {
    console.error('Failed to load history:', error);
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
    } else {
      alert(result.error || '删除失败');
    }
  } catch (error) {
    console.error('Delete history failed:', error);
    alert('删除失败，请检查网络连接');
  } finally {
    isDeleting.value = false;
  }
};

// Initial load and listen for events
onMounted(() => {
  loadHistory();
  window.addEventListener('video-analyzed', loadHistory);
});

onUnmounted(() => {
  window.removeEventListener('video-analyzed', loadHistory);
});

// Watch for auth state changes to reload history
watch(() => authState.currentUser, (newUser) => {
  if (newUser) {
    loadHistory();
  } else {
    historyList.value = [];
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
        <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;">
          <Clock class="icon accent" :size="20"/> 历史记录
        </h3>
        <button class="btn-text" @click="closeHistory" style="padding: 4px;">
          <X :size="20" />
        </button>
      </div>

      <div class="history-list">
        <div
          v-for="item in historyList"
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
          </div>
          <div class="history-item-content">
            <div class="history-title-row">
              <div class="history-title">{{ item.title || '未命名视频' }}</div>
              <button class="delete-history-btn" title="删除记录" @click="deleteHistory($event, item)">
                <Trash2 :size="16" />
              </button>
            </div>
            <div class="history-meta">
              <span class="platform-badge" :class="item.platform">{{ item.platform }}</span>
              <span class="meta-date">{{ new Date(item.analyzedAt).toLocaleDateString() }}</span>
              <span class="meta-takeaways">
                <FileText :size="12" style="display:inline;vertical-align:-2px;margin-right:2px;"/>
                {{ item.takeawayCount }}个片段
              </span>
            </div>
          </div>
        </div>
        <div v-if="historyList.length === 0" class="history-empty">
          暂无历史记录。
        </div>
      </div>
    </aside>

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

.history-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
  padding-right: 8px;
  align-content: start;
  padding-top: 2px;
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
  height: 110px; /* 固定高度确保整齐 */
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
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
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
</style>
