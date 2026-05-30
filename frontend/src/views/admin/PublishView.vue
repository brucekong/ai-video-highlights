<template>
  <div class="publish-view">
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
      <h1 class="page-title">发布管理</h1>
      <button @click="refreshTasks" class="btn-outline">
        <RefreshCw :size="14" /> 刷新
      </button>
    </header>

    <!-- Create Task Section -->
    <section class="create-section glass-panel">
      <div class="create-header">
        <Plus :size="16" />
        <span>创建发布任务</span>
      </div>
      <div class="create-form">
        <select v-model="selectedAssetId" class="select">
          <option value="">选择物料...</option>
          <option v-for="a in readyAssets" :key="a.id" :value="a.id">{{ a.title }}</option>
        </select>
        <div class="platform-checkboxes">
          <label v-for="p in platforms" :key="p.platform" class="platform-check">
            <input type="checkbox" :value="p.platform" v-model="selectedPlatforms" />
            <span class="check-label">{{ p.displayName }}</span>
          </label>
        </div>
        <div class="mode-select">
          <label class="radio-opt">
            <input type="radio" v-model="publishMode" value="draft" />
            <span>草稿</span>
          </label>
          <label class="radio-opt">
            <input type="radio" v-model="publishMode" value="publish" />
            <span>发布</span>
          </label>
        </div>
        <button @click="handleCreateAndRun" class="btn-primary" :disabled="!selectedAssetId || !selectedPlatforms.length">
          <Play :size="14" /> 创建并执行
        </button>
      </div>
    </section>

    <!-- Task Table -->
    <section class="section">
      <div class="table-wrap glass-panel">
        <table class="data-table">
          <thead>
            <tr>
              <th>物料标题</th>
              <th>平台</th>
              <th>模式</th>
              <th>状态</th>
              <th>进度</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id">
              <td class="cell-title">{{ task.asset?.title ?? '—' }}</td>
              <td><span class="platform-badge">{{ platformName(task.platform) }}</span></td>
              <td class="cell-mode">{{ task.publishMode === 'publish' ? '发布' : '草稿' }}</td>
              <td><span class="status-badge" :class="task.status">{{ statusLabel(task.status) }}</span></td>
              <td class="cell-progress">
                <span v-if="task.status === 'running' && task.errorMessage" class="progress-text">{{ task.errorMessage }}</span>
                <span v-else-if="task.status === 'failed'" class="error-text" :title="task.errorMessage">{{ truncate(task.errorMessage, 40) }}</span>
                <span v-else>—</span>
              </td>
              <td class="cell-time">{{ formatTime(task.updatedAt) }}</td>
              <td class="cell-actions">
                <button v-if="task.status === 'failed'" @click="retryTask(task.id)" class="btn-icon" title="重试">
                  <RotateCcw :size="14" />
                </button>
                <CheckCircle :size="16" v-if="task.status === 'published' || task.status === 'draft_saved'" class="icon-success" />
              </td>
            </tr>
            <tr v-if="!tasks.length">
              <td colspan="7" class="empty-cell">暂无发布任务</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  LayoutDashboard, FolderOpen, Send, RefreshCw, Plus, Play,
  RotateCcw, CheckCircle,
} from 'lucide-vue-next';
import {
  fetchAssets,
  fetchPublishTasks,
  fetchPlatforms,
  createPublishTask,
  runPublishTask,
  type PublishAsset,
  type PublishTask,
  type PlatformInfo,
} from '../../services/adminApi';

const readyAssets = ref<PublishAsset[]>([]);
const tasks = ref<PublishTask[]>([]);
const platforms = ref<PlatformInfo[]>([]);
const selectedAssetId = ref('');
const selectedPlatforms = ref<string[]>([]);
const publishMode = ref<'draft' | 'publish'>('draft');

onMounted(async () => {
  await Promise.all([loadAssets(), refreshTasks(), loadPlatforms()]);
  const params = new URLSearchParams(window.location.search);
  const assetId = params.get('assetId');
  if (assetId) selectedAssetId.value = assetId;
});

async function loadAssets() {
  const res = await fetchAssets({ status: 'ready' });
  readyAssets.value = res.assets;
}

async function refreshTasks() {
  const res = await fetchPublishTasks();
  tasks.value = res.tasks;
}

async function loadPlatforms() {
  platforms.value = await fetchPlatforms();
}

async function handleCreateAndRun() {
  for (const platform of selectedPlatforms.value) {
    const task = await createPublishTask({
      assetId: selectedAssetId.value,
      platform,
      publishMode: publishMode.value,
    });
    await runPublishTask(task.id);
  }
  selectedPlatforms.value = [];
  await refreshTasks();
}

async function retryTask(taskId: string) {
  await runPublishTask(taskId);
  await refreshTasks();
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

function truncate(s: string | null | undefined, n: number) {
  if (!s) return '';
  return s.length > n ? s.substring(0, n) + '...' : s;
}
</script>

<style scoped>
.publish-view {
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

.btn-outline {
  padding: 0.45rem 1rem; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-primary);
  border: 1px solid var(--border-color); cursor: pointer;
  font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem;
  transition: all var(--transition-fast);
}
.btn-outline:hover { border-color: var(--border-hover); }

/* Create Section */
.create-section { padding: 1.25rem 1.5rem; margin-bottom: 2rem; }
.create-header {
  display: flex; align-items: center; gap: 0.4rem;
  font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 1rem; text-transform: uppercase; letter-spacing: 0.03em;
}
.create-form { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }

.select {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--bg-secondary); color: var(--text-primary);
  min-width: 220px; font-size: 0.85rem;
}
.select:focus { outline: none; border-color: var(--accent-color); }

.platform-checkboxes { display: flex; gap: 1rem; }
.platform-check {
  display: flex; align-items: center; gap: 0.35rem;
  cursor: pointer; font-size: 0.85rem; color: var(--text-secondary);
}
.platform-check input { accent-color: var(--accent-color); }
.check-label { user-select: none; }

.mode-select { display: flex; gap: 0.75rem; padding: 0 0.5rem; }
.radio-opt {
  display: flex; align-items: center; gap: 0.3rem;
  font-size: 0.85rem; color: var(--text-secondary); cursor: pointer;
}
.radio-opt input { accent-color: var(--accent-color); }

.btn-primary {
  padding: 0.5rem 1.25rem; border-radius: var(--radius-sm);
  background: var(--accent-color); color: white; border: none;
  font-weight: 500; cursor: pointer; font-size: 0.85rem;
  display: flex; align-items: center; gap: 0.4rem;
  transition: all var(--transition-fast);
}
.btn-primary:hover { box-shadow: var(--shadow-glow); transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

/* Table */
.section { margin-bottom: 2rem; }
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
.cell-title { font-weight: 500; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-mode { color: var(--text-secondary); font-size: 0.8rem; }
.cell-time { color: var(--text-secondary); font-size: 0.8rem; white-space: nowrap; }
.cell-progress { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress-text { color: #818cf8; font-size: 0.8rem; font-family: monospace; }
.error-text { color: #f87171; font-size: 0.8rem; }
.cell-actions { white-space: nowrap; }
.empty-cell { text-align: center; color: var(--text-secondary); padding: 3rem !important; }

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

.btn-icon {
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid var(--border-color); background: transparent;
  color: var(--text-secondary); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all var(--transition-fast);
}
.btn-icon:hover { border-color: var(--accent-color); color: var(--accent-color); background: rgba(99,102,241,0.08); }
.icon-success { color: #4ade80; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
