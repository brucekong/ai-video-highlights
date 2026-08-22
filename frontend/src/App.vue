<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles, User, Menu, Search, Globe, Video, CheckCircle2, AlertCircle, X, Loader2, Scissors, LayoutDashboard, Radio, Sliders } from 'lucide-vue-next';
import LoginModal from './components/LoginModal.vue';
import HistoryDrawer from './components/HistoryDrawer.vue';
import GlobalSearchModal from './components/GlobalSearchModal.vue';
import VideoAnalysisModal from './components/VideoAnalysisModal.vue';
import { useAuth } from './services/auth';

const { authState, getAuthHeaders } = useAuth();

const API_BASE = import.meta.env.VITE_API_URL;




const router = useRouter();
const showHistory = ref(false);
const showGlobalSearch = ref(false);
const showAnalysisModal = ref(false);

interface Notification {
  id: string;
  type: 'success' | 'process' | 'error';
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
const notifications = ref<Notification[]>([]);

const addNotification = (notif: Omit<Notification, 'id'>) => {
  const id = Date.now().toString();
  notifications.value.push({ ...notif, id });

  // Use specified duration or default for process type
  const duration = notif.duration || (notif.type === 'process' ? 3000 : 0);

  if (duration > 0) {
    setTimeout(() => {
      removeNotification(id);
    }, duration);
  }
  return id;
};

const removeNotification = (id: string) => {
  notifications.value = notifications.value.filter(n => n.id !== id);
};

const handleAnalysisTask = async (payload: { videoId: string; url: string; platform: string }) => {
  const notifId = addNotification({
    type: 'process',
    title: '视频解析中',
    message: '正在 AI 提取摘要和转录文本，完成后会通知提醒'
  });

  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    removeNotification(notifId);

    if (data.success) {
      addNotification({
        type: 'success',
        title: '解析已完成',
        message: `《${data.data.videoTitle || '视频'}》分析成功！`,
        action: {
          label: '立即前往',
          onClick: () => {
            router.push({ path: '/video', query: { url: payload.url } });
          }
        }
      });
      // 通知历史列表刷新
      window.dispatchEvent(new CustomEvent('video-analyzed'));
    } else {
      addNotification({
        type: 'error',
        title: '分析失败',
        message: data.error || '解析视频时发生错误'
      });
    }
  } catch (e) {
    removeNotification(notifId);
    addNotification({
      type: 'error',
      title: '网络错误',
      message: '无法连接到分析服务器'
    });
  }
};

const goToResult = (res: any) => {
  const videoLink = res.videoId.startsWith('BV')
    ? `https://www.bilibili.com/video/${res.videoId}`
    : `https://www.youtube.com/watch?v=${res.videoId}`;

  router.push({
    path: '/video',
    query: {
      url: videoLink,
      t: Math.floor(res.offset / 1000).toString(),
      _t: Date.now() // Add a nonce to force trigger even if same result
    }
  });
};



const checkAuth = async () => {
  const headers = getAuthHeaders();
  if (!headers.Authorization) {
    authState.isInitialized = true;
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers });
    const data = await res.json();
    if (data.success) {
      authState.currentUser = data.data;
    } else {
      localStorage.removeItem('auth_token');
    }
  } catch (e) {
    localStorage.removeItem('auth_token');
  } finally {
    authState.isInitialized = true;
  }
};

const logout = () => {
  localStorage.removeItem('auth_token');
  authState.currentUser = null;
  // loadHistory() is handled by HistoryDrawer's watch on authState
};

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // Toggle search focus with Cmd/Ctrl + K
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    showGlobalSearch.value = !showGlobalSearch.value;
  }
};

onMounted(() => {
  // 1. 尝试从 Cookie 中获取 Handoff Token (最优化方案)
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('auth_token_handoff='))
    ?.split('=')[1];

  // 2. 尝试从 URL 查询参数或 Hash 中获取 token (后备方案)
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.substring(1));

  const token = cookieValue || searchParams.get('token') || hashParams.get('token');

  if (token) {
    localStorage.setItem('auth_token', token);

    // 如果是从 Cookie 获取的，清理 Cookie（需要包含 Domain 才能正确清除跨子域名 cookie）
    if (cookieValue) {
      const hostname = window.location.hostname;
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
      const domainParts = hostname.split('.');
      const rootDomain = domainParts.length >= 2 ? domainParts.slice(-2).join('.') : hostname;
      const domainAttr = isLocal ? '' : `; Domain=.${rootDomain}`;
      document.cookie = `auth_token_handoff=; Path=/; Max-Age=0; SameSite=Lax${domainAttr}`;
    }

    // 3. 彻底从 URL 中移除 token，但保留其他参数 (如 video url)
    const url = new URL(window.location.href);
    url.searchParams.delete('token');

    // 如果 token 在 hash 中，也清理 hash
    if (url.hash.includes('token=')) {
      const newHashParams = new URLSearchParams(url.hash.substring(1));
      newHashParams.delete('token');
      const hashString = newHashParams.toString();
      url.hash = hashString ? `#${hashString}` : '';
    }

    // 使用 replaceState 更新 URL 栏，不触发刷新且保留其他参数
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  checkAuth();
  window.addEventListener('keydown', handleGlobalKeyDown);

  // 监听全局通知事件 / Listen for global notification events
  window.addEventListener('notify', handleNotify);
});

const handleNotify = ((e: CustomEvent) => {
  const { message, title, type, duration } = e.detail;
  addNotification({
    type: type || 'success',
    title: title || (type === 'error' ? '操作失败' : '提示'),
    message: message,
    duration: duration
  });
}) as EventListener;

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown);
  window.removeEventListener('notify', handleNotify);
});

</script>

<template>
  <div class="app-layout">
    <!-- History Drawer Component -->
    <HistoryDrawer v-model="showHistory" />

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
            <h1 class="text-gradient">AI Video Highlight</h1>
          </div>
        </div>

        <div class="header-right">
           <button
            class="btn-icon-labeled glass-panel"
            @click="showAnalysisModal = true"
            title="解析新视频"
          >
            <Video :size="18" />
            <span>解析</span>
          </button>
          <button
            class="btn-icon-labeled glass-panel"
            @click="router.push('/scraper')"
            title="素材采集 / 视频号嗅探"
          >
            <Radio :size="18" />
            <span>采集</span>
          </button>
          <button
            class="btn-icon-labeled glass-panel"
            @click="router.push('/trim')"
            title="本地视频裁剪与水印加工"
          >
            <Scissors :size="18" />
            <span>裁剪</span>
          </button>
          <button
            class="btn-icon-labeled glass-panel"
            @click="router.push('/admin')"
            title="运维管理"
          >
            <LayoutDashboard :size="18" />
            <span>运维</span>
          </button>
          <button
            class="global-search-entry"
            @click="showGlobalSearch = true"
            title="全局搜索"
          >
            <div class="search-box-mock glass-panel">
              <Search :size="16" />
              <span>搜索视频内容...</span>
              <kbd class="search-kbd">⌘+K</kbd>
            </div>
          </button>



          <div class="user-action">
            <div v-if="authState.currentUser" class="user-profile">
              <img v-if="authState.currentUser.avatar" :src="authState.currentUser.avatar" class="avatar" />
              <User v-else class="icon avatar-fallback" :size="20" />
              <span class="user-name">{{ authState.currentUser.name || authState.currentUser.email || '用户' }}</span>
              <button class="btn-text" @click="logout">退出登录</button>
            </div>
            <button v-else class="btn-secondary" @click="authState.showLoginModal = true">
              <User class="icon" :size="18" />
              登录
            </button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <div class="main-content">
        <router-view :key="$route.fullPath"></router-view>
      </div>
    </div> <!-- End Main Wrapper -->

    <LoginModal v-if="authState.showLoginModal" @close="authState.showLoginModal = false" />
    <GlobalSearchModal
      :show="showGlobalSearch"
      @close="showGlobalSearch = false"
      @result-click="goToResult"
    />
    <VideoAnalysisModal
      :show="showAnalysisModal"
      @close="showAnalysisModal = false"
      @submit-task="handleAnalysisTask"
    />

    <!-- Notification Toast System -->
    <div class="notification-container">
      <TransitionGroup name="notification">
        <div v-for="notif in notifications" :key="notif.id" class="notification-toast glass-panel" :class="notif.type">
          <div class="notif-icon-wrap">
            <CheckCircle2 v-if="notif.type === 'success'" class="notif-icon success" :size="20" />
            <Loader2 v-else-if="notif.type === 'process'" class="notif-icon process spin" :size="20" />
            <AlertCircle v-else class="notif-icon error" :size="20" />
          </div>
          <div class="notif-content">
            <div class="notif-title">{{ notif.title }}</div>
            <div class="notif-message">{{ notif.message }}</div>
            <div v-if="notif.action" class="notif-actions">
              <button class="btn-notif-action" @click="notif.action.onClick(); removeNotification(notif.id)">
                <span>{{ notif.action.label }}</span>
                <Globe :size="14" />
              </button>
            </div>
          </div>
          <button class="notif-close" @click="removeNotification(notif.id)">
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
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

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.global-search-entry {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
}

.search-box-mock {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 100px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  transition: all 0.3s ease;
  width: 240px;
}

.global-search-entry:hover .search-box-mock {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
  width: 250px;
}

.btn-icon-labeled {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 100px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 600;
  transition: all 0.3s ease;
  cursor: pointer;
}

.btn-icon-labeled:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--text-accent);
  transform: translateY(-1px);
}

.search-kbd {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.75rem;
  font-family: inherit;
  margin-left: auto;
  color: var(--text-muted);
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

/* Notification System CSS */
.notification-container {
  position: fixed;
  top: 100px;
  right: 40px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.notification-toast {
  pointer-events: auto;
  width: 360px;
  display: flex;
  gap: 16px;
  padding: 16px;
  background: rgba(15, 15, 18, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  position: relative;
}

.notification-toast.success {
  border-left: 4px solid #10b981;
}

.notification-toast.process {
  border-left: 4px solid var(--accent-color);
}

.notification-toast.error {
  border-left: 4px solid #ef4444;
}

.notif-icon-wrap {
  flex-shrink: 0;
  margin-top: 2px;
}

.notif-icon.success { color: #10b981; }
.notif-icon.process { color: var(--accent-color); }
.notif-icon.error { color: #ef4444; }

.notif-content {
  flex: 1;
  min-width: 0;
}

.notif-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: #fff;
  margin-bottom: 4px;
}

.notif-message {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.notif-actions {
  margin-top: 10px;
}

.btn-notif-action {
  background: var(--accent-light);
  color: #fff;
  border: none;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-notif-action:hover {
  background: var(--accent-color);
  transform: translateY(-1px);
}

.notif-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  opacity: 0.6;
  transition: opacity 0.2s;
  height: max-content;
}

.notif-close:hover {
  opacity: 1;
  color: #fff;
}

/* Notification Transitions */
.notification-enter-active, .notification-leave-active {
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(50px) scale(0.9);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(100px);
}

/* Main Area */
.main-content {
  flex: 1;
  padding: 40px;
  display: flex;
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


/* Confirm Modal */
.confirm-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.confirm-modal {
  width: 100%;
  max-width: 440px;
  padding: 32px;
  text-align: center;
  border: 1px solid rgba(239, 68, 68, 0.2);
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
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.confirm-modal p {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-danger {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ef4444;
  color: white;
  padding: 10px 24px;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  border: none;
  cursor: pointer;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .confirm-modal,
.modal-fade-leave-active .confirm-modal {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-fade-enter-from .confirm-modal,
.modal-fade-leave-to .confirm-modal {
  transform: scale(0.9);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}
</style>
