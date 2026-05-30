<template>
  <div class="admin-dashboard">
    <nav class="admin-nav">
      <router-link to="/admin" class="admin-nav-item" exact-active-class="active">
        <LayoutDashboard :size="16" /> 概览
      </router-link>
      <router-link to="/admin/assets" class="admin-nav-item" active-class="active">
        <FolderOpen :size="16" /> 物料
      </router-link>
      <router-link to="/admin/publish" class="admin-nav-item" active-class="active">
        <Send :size="16" /> 发布
      </router-link>
    </nav>

    <header class="page-header">
      <h1 class="page-title">运维概览</h1>
      <div class="bridge-status" :class="bridgeConnected ? 'connected' : 'disconnected'">
        <Wifi :size="14" v-if="bridgeConnected" />
        <WifiOff :size="14" v-else />
        <span>Bridge {{ bridgeConnected ? '已连接' : '未连接' }}</span>
        <button v-if="!bridgeConnected" @click="handleConnect" class="btn-sm">连接</button>
      </div>
    </header>

    <!-- Stats Row -->
    <section class="stats-row">
      <div class="stat-card glass-panel" v-for="stat in statItems" :key="stat.label">
        <div class="stat-icon-wrap" :class="stat.color">
          <component :is="stat.icon" :size="20" />
        </div>
        <div class="stat-content">
          <div class="stat-number">{{ stat.value }}</div>
          <div class="stat-label">{{ stat.label }}</div>
        </div>
      </div>
    </section>

    <!-- Recent Tasks Table -->
    <section class="section">
      <div class="section-header">
        <h2><Clock :size="16" /> 最近任务</h2>
        <router-link to="/admin/publish" class="link-more">查看全部 <ChevronRight :size="14" /></router-link>
      </div>
      <div class="table-wrap glass-panel" v-if="recentTasks.length">
        <table class="data-table">
          <thead>
            <tr>
              <th>物料</th>
              <th>平台</th>
              <th>模式</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in recentTasks" :key="task.id">
              <td class="cell-title">{{ task.asset?.title ?? '—' }}</td>
              <td><span class="platform-badge">{{ platformName(task.platform) }}</span></td>
              <td class="cell-mode">{{ task.publishMode === 'publish' ? '发布' : '草稿' }}</td>
              <td><span class="status-badge" :class="task.status">{{ statusLabel(task.status) }}</span></td>
              <td class="cell-time">{{ formatTime(task.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-inline">暂无发布任务</div>
    </section>

    <!-- Quick Actions -->
    <section class="section">
      <h2><Zap :size="16" /> 快捷操作</h2>
      <div class="action-grid">
        <router-link to="/admin/assets" class="action-card glass-panel">
          <FolderOpen :size="22" />
          <div class="action-text">
            <span class="action-title">物料管理</span>
            <span class="action-desc">导入、编辑视频物料</span>
          </div>
          <ChevronRight :size="16" class="action-arrow" />
        </router-link>
        <router-link to="/admin/publish" class="action-card glass-panel">
          <Send :size="22" />
          <div class="action-text">
            <span class="action-title">发布管理</span>
            <span class="action-desc">创建和监控发布任务</span>
          </div>
          <ChevronRight :size="16" class="action-arrow" />
        </router-link>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  LayoutDashboard, FolderOpen, Send, Wifi, WifiOff,
  Clock, ChevronRight, Zap, Package, CheckCircle, AlertTriangle, Layers,
} from 'lucide-vue-next';
import {
  fetchAssets,
  fetchPublishTasks,
  getBridgeStatus,
  connectBridge,
  type PublishTask,
} from '../../services/adminApi';

const bridgeConnected = ref(false);
const stats = ref({ totalAssets: 0, readyAssets: 0, publishedAssets: 0, failedTasks: 0 });
const recentTasks = ref<PublishTask[]>([]);

const statItems = computed(() => [
  { value: stats.value.totalAssets, label: '物料总数', icon: Layers, color: 'blue' },
  { value: stats.value.readyAssets, label: '待发布', icon: Package, color: 'purple' },
  { value: stats.value.publishedAssets, label: '已发布', icon: CheckCircle, color: 'green' },
  { value: stats.value.failedTasks, label: '失败任务', icon: AlertTriangle, color: 'red' },
]);

onMounted(async () => {
  try {
    const [bridgeRes, allAssets, readyAssets, publishedAssets, tasks] = await Promise.all([
      getBridgeStatus(),
      fetchAssets(),
      fetchAssets({ status: 'ready' }),
      fetchAssets({ status: 'published' }),
      fetchPublishTasks({ status: 'failed' }),
    ]);

    bridgeConnected.value = bridgeRes.status === 'connected';
    stats.value = {
      totalAssets: allAssets.total,
      readyAssets: readyAssets.total,
      publishedAssets: publishedAssets.total,
      failedTasks: tasks.total,
    };

    const recent = await fetchPublishTasks();
    recentTasks.value = recent.tasks.slice(0, 8);
  } catch (e) {
    console.error('Failed to load dashboard data', e);
  }
});

async function handleConnect() {
  try {
    await connectBridge();
    bridgeConnected.value = true;
  } catch {
    alert('Bridge 连接失败，请确保 local-cdp-bridge 已启动');
  }
}

function platformName(platform: string) {
  const map: Record<string, string> = { douyin: '抖音', xiaohongshu: '小红书', bilibili: 'B站', wxvideo: '视频号' };
  return map[platform] ?? platform;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '待执行', running: '运行中', draft_saved: '已保存', published: '已发布',
    success: '成功', failed: '失败', retrying: '重试中',
  };
  return map[status] ?? status;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.admin-dashboard {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem 2.5rem;
  animation: fadeIn 0.3s ease-out;
}

.admin-nav {
  display: flex; gap: 0.25rem; margin-bottom: 1.5rem;
  padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);
}
.admin-nav-item {
  padding: 0.5rem 1rem; border-radius: var(--radius-sm);
  color: var(--text-secondary); text-decoration: none;
  font-size: 0.85rem; transition: all var(--transition-fast);
  display: flex; align-items: center; gap: 0.4rem;
}
.admin-nav-item:hover { color: var(--text-primary); background: rgba(255,255,255,0.04); }
.admin-nav-item.active { color: var(--accent-color); background: rgba(99, 102, 241, 0.1); font-weight: 600; }

.page-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 2rem;
}
.page-title { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); }

.bridge-status {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 1rem; border-radius: 20px;
  font-size: 0.8rem; border: 1px solid var(--border-color);
}
.bridge-status.connected { border-color: rgba(34, 197, 94, 0.3); color: #4ade80; }
.bridge-status.disconnected { border-color: rgba(239, 68, 68, 0.3); color: #f87171; }

.btn-sm {
  padding: 0.25rem 0.6rem; font-size: 0.75rem; border-radius: 4px;
  border: 1px solid currentColor; background: transparent;
  color: inherit; cursor: pointer;
}
.btn-sm:hover { background: rgba(255,255,255,0.05); }

.stats-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;
  margin-bottom: 2.5rem;
}
.stat-card {
  display: flex; align-items: center; gap: 1rem;
  padding: 1.25rem 1.5rem;
  transition: all var(--transition-normal);
}
.stat-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
.stat-icon-wrap {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.stat-icon-wrap.blue { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
.stat-icon-wrap.purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.stat-icon-wrap.green { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.stat-icon-wrap.red { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.stat-number { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); }
.stat-label { font-size: 0.8rem; color: var(--text-secondary); }

.section { margin-bottom: 2.5rem; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
h2 { font-size: 1rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem; margin: 0 0 1rem; }
.link-more {
  font-size: 0.8rem; color: var(--text-secondary); text-decoration: none;
  display: flex; align-items: center; gap: 0.2rem;
}
.link-more:hover { color: var(--accent-color); }

.table-wrap { overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.data-table thead { background: rgba(255,255,255,0.03); }
.data-table th {
  text-align: left; padding: 0.7rem 1.25rem;
  font-weight: 600; color: var(--text-secondary);
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
}
.data-table td {
  padding: 0.7rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.03);
  color: var(--text-primary);
}
.data-table tr:hover td { background: rgba(255,255,255,0.02); }
.cell-title { font-weight: 500; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-mode { color: var(--text-secondary); font-size: 0.8rem; }
.cell-time { color: var(--text-secondary); font-size: 0.8rem; }

.platform-badge {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 4px;
  background: rgba(99, 102, 241, 0.1); color: #818cf8;
}
.status-badge { font-size: 0.75rem; padding: 3px 10px; border-radius: 20px; }
.status-badge.draft_saved { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
.status-badge.published, .status-badge.success { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-badge.failed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-badge.running { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.status-badge.pending { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); }

.empty-inline { color: var(--text-secondary); font-size: 0.85rem; padding: 2rem; text-align: center; }

.action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
.action-card {
  display: flex; align-items: center; gap: 1rem;
  padding: 1.25rem 1.5rem; text-decoration: none; color: var(--text-primary);
  transition: all var(--transition-normal);
}
.action-card:hover { border-color: var(--accent-color); transform: translateY(-2px); box-shadow: var(--shadow-glow); }
.action-text { flex: 1; }
.action-title { display: block; font-weight: 600; font-size: 0.9rem; }
.action-desc { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.2rem; }
.action-arrow { color: var(--text-secondary); }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
