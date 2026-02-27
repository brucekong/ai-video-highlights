<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles, Clock, FileText, User, Menu, X, Image as ImageIcon, Trash2 } from 'lucide-vue-next';
import LoginModal from './components/LoginModal.vue';

const API_BASE = import.meta.env.VITE_API_URL;




interface HistoryItem {
  videoId: string;
  title: string | null;
  url: string;
  platform: string;
  takeawayCount: number;
  analyzedAt: string;
}

const router = useRouter();
const showHistory = ref(false);
const historyList = ref<HistoryItem[]>([]);
const showLoginModal = ref(false);
const currentUser = ref<any>(null);

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
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

const checkAuth = async () => {
  const headers = getAuthHeaders();
  if (!headers.Authorization) return;
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers });
    const data = await res.json();
    if (data.success) {
      currentUser.value = data.data;
    } else {
      localStorage.removeItem('auth_token');
    }
  } catch (e) {
    localStorage.removeItem('auth_token');
  }
};

const logout = () => {
  localStorage.removeItem('auth_token');
  currentUser.value = null;
  loadHistory();
};

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    localStorage.setItem('auth_token', token);
    // 使用 URL 对象彻底清除 search 参数
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.pathname);
  }

  checkAuth();
  loadHistory();
  window.addEventListener('video-analyzed', loadHistory);
});

onUnmounted(() => {
  window.removeEventListener('video-analyzed', loadHistory);
});

const loadVideoHistory = (item: HistoryItem) => {
  showHistory.value = false;
  router.push({ path: '/video', query: { url: item.url } });
};

const getThumbnailUrl = (item: HistoryItem) => {
  if (item.platform === 'youtube') {
    return `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;
  }
  return '';
};

const deleteHistory = async (event: Event, item: HistoryItem) => {
  event.stopPropagation(); // 阻止触发跳转
  if (!confirm('确定要删除这条记录吗？')) return;

  try {
    const res = await fetch(`${API_BASE}/api/videos/${item.videoId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (result.success) {
      await loadHistory();
    } else {
      alert(result.error || '删除失败');
    }
  } catch (error) {
    console.error('Delete history failed:', error);
    alert('删除失败，请检查网络连接');
  }
};
</script>

<template>
  <div class="app-layout">
    <!-- History Backdrop -->
    <div
      class="history-backdrop"
      :class="{ 'is-visible': showHistory }"
      @click="showHistory = false"
    ></div>

    <!-- Left: History Sidebar Drawer -->
    <aside class="history-sidebar glass-panel" :class="{ 'is-open': showHistory }">
      <div class="sidebar-header" style="justify-content: space-between; align-items: center; display: flex;">
        <h3 style="margin: 0; display: flex; align-items: center; gap: 8px;"><Clock class="icon accent" :size="20"/> 历史记录</h3>
        <button class="btn-text" @click="showHistory = false" style="padding: 4px;">
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
            <span class="platform-badge absolute-badge" :class="item.platform">{{ item.platform }}</span>
          </div>
          <div class="history-item-content">
            <div class="history-title-row">
              <div class="history-title">{{ item.title || '未命名视频' }}</div>
              <button class="delete-history-btn" title="删除记录" @click="deleteHistory($event, item)">
                <Trash2 :size="16" />
              </button>
            </div>
            <div class="history-meta">
              <span class="meta-date">{{ new Date(item.analyzedAt).toLocaleDateString() }}</span>
              <span class="meta-takeaways"><FileText :size="12" style="display:inline;vertical-align:-2px;margin-right:2px;"/>{{ item.takeawayCount }}个片段</span>
            </div>
          </div>
        </div>
        <div v-if="historyList.length === 0" class="history-empty">
          暂无历史记录。
        </div>
      </div>
    </aside>

    <!-- Main Wrapper -->
    <div class="main-wrapper">
      <!-- Header -->
      <header class="app-header glass-panel">
        <div class="header-left">
          <button class="btn-icon header-menu-btn" @click="showHistory = true">
            <Menu :size="22" />
          </button>
          <div class="logo-area" @click="router.push('/')" style="cursor: pointer;">
            <Sparkles class="logo-icon animate-pulse-glow" :size="28" />
            <h1 class="text-gradient">AI Highlight</h1>
          </div>
        </div>

        <div class="user-action">
          <div v-if="currentUser" class="user-profile">
            <img v-if="currentUser.avatar" :src="currentUser.avatar" class="avatar" />
            <User v-else class="icon avatar-fallback" :size="20" />
            <span class="user-name">{{ currentUser.name || currentUser.email || '用户' }}</span>
            <button class="btn-text" @click="logout">退出登录</button>
          </div>
          <button v-else class="btn-secondary" @click="showLoginModal = true">
            <User class="icon" :size="18" />
            登录
          </button>
        </div>
      </header>

      <!-- Main Content -->
      <div class="main-content">
        <router-view :key="$route.fullPath"></router-view>
      </div>
    </div> <!-- End Main Wrapper -->

    <LoginModal v-if="showLoginModal" @close="showLoginModal = false" />
  </div>
</template>

<style scoped>
/* App Layout */
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* History Drawer & Backdrop */
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
  background: rgba(15, 15, 18, 0.85); /* fallback */
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

.history-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  /*
    calc((100% - 5 * 20px) / 6) defines exactly 6 items max per row.
    max(200px, ...) enforces that if cards get smaller than 200px, they will wrap.
  */
  grid-template-columns: repeat(auto-fill, minmax(max(200px, calc((100% - 100px) / 6)), 1fr));
  gap: 20px;
  margin-top: 16px;
  padding-right: 8px; /* For scrollbar */
  align-content: start;
}

.history-item {
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid var(--border-color);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
  height: auto;
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
  width: 100%;
  flex-shrink: 0;
  aspect-ratio: 16 / 9;
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

.absolute-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

.history-item-content {
  padding: 12px 14px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.history-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  min-height: 2.8em;
  flex: 1;
}

.history-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: auto;
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
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: -2px;
}

.history-item:hover .delete-history-btn {
  opacity: 0.6;
}

.delete-history-btn:hover {
  opacity: 1 !important;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.history-meta {
  margin-top: 12px;
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
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: capitalize;
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

/* Header */
.app-header {
  display: flex;
  flex: 0 0 80px;
  align-items: center;
  justify-content: space-between;
  padding: 0 40px;
  position: sticky;
  top: 0;
  z-index: 100;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-top: none;
  background: rgba(10, 10, 11, 0.9);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-menu-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-menu-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  color: var(--accent-color);
}

.text-gradient {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(to right, #F0F0F0, var(--text-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

/* Input Area */
.input-group {
  display: flex;
  align-items: center;
  padding: 6px 6px 6px 20px;
  width: 50%;
  max-width: 600px;
  border-radius: 100px;
  transition: all var(--transition-normal);
}

.input-group:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 1rem;
  font-family: inherit;
  padding-right: 16px;
  min-width: 0;
}

input::placeholder {
  color: var(--text-secondary);
}

/* Buttons */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-color);
  color: white;
  padding: 10px 24px;
  border-radius: 100px;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all var(--transition-fast);
  white-space: nowrap;
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

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: 100px;
  font-weight: 500;
  font-size: 0.95rem;
  border: 1px solid var(--border-color);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.btn-text {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s;
}

.btn-text:hover {
  color: var(--text-primary);
}

/* User Profile */
.user-action {
  display: flex;
  align-items: center;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color);
}

.avatar-fallback {
  color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 4px;
  border-radius: 50%;
}

.user-name {
  font-weight: 500;
  font-size: 0.95rem;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon { display: inline-block; }

.spin {
  animation: spinner 1s linear infinite;
}

@keyframes spinner {
  to { transform: rotate(360deg); }
}

/* Main Area */
.main-content {
  flex: 1;
  padding: 40px;
  /* display: flex; */
  justify-content: center;
}

.container {
  width: 100%;
  max-width: 1900px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
  margin-top: 60px;
  border-style: dashed;
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

.empty-state h2 {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 16px;
}

.empty-state p {
  color: var(--text-secondary);
  max-width: 500px;
  font-size: 1.1rem;
  line-height: 1.6;
}

/* Grid Layout */
.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.content-grid.has-sidebar {
  grid-template-columns: 1fr 580px;
}

/* Left Column: Video + Takeaways */
.left-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.video-section {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: max-content;
}

/* Takeaways Section (below video) */
.takeaways-section {
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.takeaways-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Right Sidebar: Transcript */
.outline-sidebar {
  padding: 24px;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 160px);
  position: sticky;
  top: 100px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
  font-weight: 600;
}

.icon.accent {
  color: var(--accent-color);
}

.sidebar-title-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-accent);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
}

/* =============== Transcript List =============== */
.transcript-list {
  flex: 1;
  overflow-y: auto;
  scroll-behavior: smooth;
  position: relative;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.transcript-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
  position: relative;
  transform-origin: left center;
}

.transcript-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-hover);
}

.transcript-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.25);
  transform: translateX(6px);
}

.transcript-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--accent-color);
  border-radius: 3px;
  animation: indicator-grow 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

/* Time pill */
.seg-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 8px;
  border-radius: 6px;
  min-width: 58px;
  white-space: nowrap;
  transition: all var(--transition-fast);
  margin-top: 1px;
}

.seg-time-icon {
  opacity: 0.6;
}

.transcript-item.active .seg-time,
.transcript-item:hover .seg-time {
  color: var(--text-accent);
  background: rgba(99, 102, 241, 0.12);
}

/* Text content */
.seg-text {
  flex: 1;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}

.transcript-item:not(.active) .seg-text {
  color: var(--text-secondary);
}

.transcript-item.active .seg-text {
  color: var(--text-primary);
  font-weight: 500;
}

/* Play icon */
.seg-play-icon {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  opacity: 0;
  transform: scale(0.8);
  transition: all var(--transition-fast);
  margin-top: 2px;
}

.transcript-item:hover .seg-play-icon {
  opacity: 0.6;
  transform: scale(1);
}

.transcript-item.active .seg-play-icon {
  opacity: 1;
  transform: scale(1);
  color: var(--accent-color);
}

/* Animations */
/* Timeline Map */
.takeaways-timeline-container {
  padding: 0 24px 16px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.takeaways-timeline {
  width: 100%;
  height: 20px;
  background-color: var(--bg-hover);
  border-radius: 999px;
  position: relative;
  overflow: visible; /* to allow indicator dot to pop out */
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.timeline-segment {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 999px;
  opacity: 0.6;
  transition: all var(--transition-fast);
}

.timeline-segment:hover {
  opacity: 0.85;
}

.timeline-segment.active {
  opacity: 1;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.2) inset;
  z-index: 5;
}

.timeline-tooltip {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  border: 1px solid var(--border-color);
  z-index: 20;
}

.timeline-tooltip::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  z-index: -1;
}

.timeline-segment:hover .timeline-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(12px);
}

.timeline-progress {
  position: absolute;
  top: -6px;
  bottom: -6px;
  width: 2px;
  background-color: #ef4444; /* red needle */
  z-index: 10;
  pointer-events: none;
  transition: left 0.1s linear;
}

.timeline-progress::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 6px;
  height: 6px;
  background-color: #ef4444;
  border-radius: 50%;
  box-shadow: 0 0 2px rgba(0,0,0,0.5);
}

/* Takeaway Item Styles */
.video-title-hint {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.takeaway-content {
  flex: 1;
  min-width: 0;
}

.takeaway-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 4px;
}

.takeaway-summary {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.takeaway-item .takeaway-title,
.takeaway-item .takeaway-summary {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.takeaway-item:not(.active) .takeaway-title {
  color: var(--text-secondary);
}

.takeaway-item.active .takeaway-title {
  color: var(--text-primary);
}

.takeaway-item.active .takeaway-summary {
  color: var(--text-primary);
  opacity: 0.8;
}

@keyframes indicator-grow {
  from { transform: scaleY(0); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.animate-slide-in {
  animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Error State */
.error-state {
  border-color: rgba(239, 68, 68, 0.3);
}

.error-icon-wrap {
  background: rgba(239, 68, 68, 0.1) !important;
}

.error-icon {
  color: #ef4444 !important;
}

/* Responsive */
@media (max-width: 1024px) {
  .content-grid.has-sidebar {
    grid-template-columns: 1fr;
  }

  .outline-sidebar {
    height: 400px;
    position: static;
  }
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

  .history-meta {
    margin-top: 8px;
  }
}
</style>
