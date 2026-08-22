<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  Download, Play, Sparkles, CheckCircle2, AlertCircle, Loader2, 
  RefreshCw, Radio, Link as LinkIcon, Trash2, ArrowRight, Video, 
  ExternalLink, Copy, HelpCircle, ShieldAlert, Cpu, Sparkle
} from 'lucide-vue-next';

const router = useRouter();

// 选项卡：嗅探抓取 / 链接直接提取 / 抓取配置指引
type TabType = 'sniff' | 'direct' | 'guide';
const activeTab = ref<TabType>('sniff');

// 链接提取表单
const directUrl = ref('');
const directVideoTitle = ref('');
const isAnalyzingDirect = ref(false);

// 嗅探状态
const isSniffing = ref(true);

export interface ScrapedItem {
  id: string;
  title: string;
  source: 'wechat_channels' | 'direct_stream' | 'bilibili' | 'douyin' | 'other';
  sourceName: string;
  videoUrl: string;
  coverUrl?: string;
  duration?: number;
  format?: string;
  createdAt: string;
  size?: string;
  status: 'ready' | 'downloading' | 'transcribing' | 'completed' | 'failed';
  statusText?: string;
}

const scrapedList = ref<ScrapedItem[]>([
  {
    id: 'wx-101',
    title: '微信视频号素材示例 - AI大模型发展趋势',
    source: 'wechat_channels',
    sourceName: '微信视频号',
    videoUrl: 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4',
    coverUrl: '',
    duration: 125,
    format: 'MP4 (H.264)',
    size: '18.4 MB',
    createdAt: '刚刚',
    status: 'ready'
  }
]);

// 复制链接状态
const copiedId = ref<string | null>(null);
const copyLink = (item: ScrapedItem) => {
  if (!item.videoUrl) return;
  navigator.clipboard.writeText(item.videoUrl);
  copiedId.value = item.id;
  setTimeout(() => {
    copiedId.value = null;
  }, 2000);
};

// 发起 AI 分析/高光流转
const sendToAiHighlight = (item: ScrapedItem) => {
  router.push({
    path: '/video',
    query: {
      url: item.videoUrl,
      title: item.title,
      from: 'scraper'
    }
  });
};

// 添加手动抓取/解析任务
const handleDirectExtract = () => {
  if (!directUrl.value.trim()) return;
  
  isAnalyzingDirect.value = true;
  const url = directUrl.value.trim();
  const title = directVideoTitle.value.trim() || `采集素材 ${new Date().toLocaleTimeString()}`;

  setTimeout(() => {
    const newItem: ScrapedItem = {
      id: `task-${Date.now()}`,
      title: title,
      source: url.includes('weixin.qq.com') || url.includes('finder') ? 'wechat_channels' : 'direct_stream',
      sourceName: url.includes('weixin.qq.com') || url.includes('finder') ? '微信视频号' : '直接视频流',
      videoUrl: url,
      createdAt: '刚刚',
      format: 'MP4 / H.264',
      size: '动态检测中',
      status: 'ready'
    };

    scrapedList.value.unshift(newItem);
    directUrl.value = '';
    directVideoTitle.value = '';
    isAnalyzingDirect.value = false;
    activeTab.value = 'sniff';
  }, 600);
};

const deleteItem = (id: string) => {
  scrapedList.value = scrapedList.value.filter(i => i.id !== id);
};

const formatSeconds = (sec?: number) => {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
</script>

<template>
  <div class="scraper-container">
    <!-- Header banner -->
    <div class="scraper-header glass-panel">
      <div class="header-info">
        <div class="header-badge">
          <Radio :size="14" class="pulse-icon" />
          <span>微信视频号 / 媒体流抓取与采集中心</span>
        </div>
        <h2>素材嗅探与采集控制台</h2>
        <p class="subtitle">
          捕获微信视频号及各类动态流媒体素材，一键流转至 AI 高光分析、字幕提取与智能切片管线。
        </p>
      </div>

      <div class="header-tabs">
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'sniff' }"
          @click="activeTab = 'sniff'"
        >
          <Radio :size="16" />
          <span>采集列表 ({{ scrapedList.length }})</span>
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'direct' }"
          @click="activeTab = 'direct'"
        >
          <LinkIcon :size="16" />
          <span>手动导入 / 直链解析</span>
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'guide' }"
          @click="activeTab = 'guide'"
        >
          <HelpCircle :size="16" />
          <span>嗅探配置教程</span>
        </button>
      </div>
    </div>

    <!-- Tab 1: 嗅探列表 -->
    <div v-if="activeTab === 'sniff'" class="tab-content">
      <!-- 嗅探状态条 -->
      <div class="sniff-status-bar glass-panel">
        <div class="status-left">
          <div class="status-indicator" :class="{ running: isSniffing }">
            <span class="dot"></span>
            <span>{{ isSniffing ? '本地视频流监听嗅探中...' : '嗅探已暂停' }}</span>
          </div>
          <span class="tip-text">在微信电脑端打开视频号播放，捕获到的视频会自动显示在下方列表</span>
        </div>
        <div class="status-actions">
          <button class="btn-refresh" @click="isSniffing = !isSniffing">
            <RefreshCw :size="14" :class="{ 'animate-spin': isSniffing }" />
            <span>{{ isSniffing ? '暂停监听' : '继续监听' }}</span>
          </button>
        </div>
      </div>

      <!-- 列表为空 -->
      <div v-if="scrapedList.length === 0" class="empty-state glass-panel">
        <Video :size="48" class="empty-icon" />
        <h3>暂未嗅探到视频流素材</h3>
        <p>请参考“嗅探配置教程”开启本地捕获，或在微信电脑端播放视频号视频。</p>
        <button class="btn-primary" @click="activeTab = 'direct'">
          <LinkIcon :size="16" />
          <span>手动输入流地址</span>
        </button>
      </div>

      <!-- 视频列表卡片 -->
      <div v-else class="cards-grid">
        <div 
          v-for="item in scrapedList" 
          :key="item.id" 
          class="video-card glass-panel"
        >
          <div class="card-top">
            <span class="source-tag" :class="item.source">
              {{ item.sourceName }}
            </span>
            <span class="card-time">{{ item.createdAt }}</span>
          </div>

          <div class="card-body">
            <h4 class="video-title" :title="item.title">{{ item.title }}</h4>
            <div class="video-meta">
              <span v-if="item.duration">时长: {{ formatSeconds(item.duration) }}</span>
              <span v-if="item.size">大小: {{ item.size }}</span>
              <span v-if="item.format">格式: {{ item.format }}</span>
            </div>

            <div class="url-box">
              <span class="url-text" :title="item.videoUrl">{{ item.videoUrl }}</span>
              <button class="btn-copy" @click="copyLink(item)">
                <CheckCircle2 v-if="copiedId === item.id" :size="14" class="text-green" />
                <Copy v-else :size="14" />
              </button>
            </div>
          </div>

          <div class="card-footer">
            <button class="btn-delete" @click="deleteItem(item.id)" title="移除该素材">
              <Trash2 :size="16" />
            </button>
            <div class="footer-actions">
              <a :href="item.videoUrl" target="_blank" download class="btn-secondary-sm">
                <Download :size="14" />
                <span>下载原片</span>
              </a>
              <button class="btn-primary-sm" @click="sendToAiHighlight(item)">
                <Sparkles :size="14" />
                <span>AI 高光分析</span>
                <ArrowRight :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 手动直链解析 -->
    <div v-else-if="activeTab === 'direct'" class="tab-content">
      <div class="direct-import-panel glass-panel">
        <div class="panel-header">
          <LinkIcon :size="20" />
          <h3>手动输入音视频流 / 视频号直链</h3>
        </div>
        <p class="panel-desc">
          输入抓包嗅探到的视频 CDN 链接（以 .mp4, .m3u8 结尾）或分享地址，快速加入素材库并一键交给 AI 进行高光分析与总结。
        </p>

        <div class="form-group">
          <label>素材标题（可选）</label>
          <input 
            v-model="directVideoTitle" 
            type="text" 
            class="input-field" 
            placeholder="例如：微信视频号-AI技术分享" 
          />
        </div>

        <div class="form-group">
          <label>视频流直链 URL *</label>
          <textarea 
            v-model="directUrl" 
            class="textarea-field" 
            rows="4" 
            placeholder="粘贴 .mp4 / .m3u8 或 https://channels.weixin.qq.com/..."
          ></textarea>
        </div>

        <div class="panel-actions">
          <button 
            class="btn-primary" 
            :disabled="!directUrl.trim() || isAnalyzingDirect"
            @click="handleDirectExtract"
          >
            <Loader2 v-if="isAnalyzingDirect" :size="16" class="animate-spin" />
            <Sparkles v-else :size="16" />
            <span>解析并加入采集库</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Tab 3: 嗅探配置指引 -->
    <div v-else-if="activeTab === 'guide'" class="tab-content">
      <div class="guide-panel glass-panel">
        <div class="guide-header">
          <ShieldAlert :size="22" class="guide-icon" />
          <div>
            <h3>微信视频号采集原理与嗅探配置教程</h3>
            <p class="subtitle">微信视频号具有动态会话与防盗链机制，推荐配合本地代理嗅探使用：</p>
          </div>
        </div>

        <div class="steps-list">
          <div class="step-item">
            <div class="step-num">1</div>
            <div class="step-content">
              <h4>电脑端微信与嗅探工具</h4>
              <p>打开电脑版微信，并开启抓包/嗅探工具（如 mitmproxy、Charles 或专用视频号嗅探助手）。</p>
            </div>
          </div>

          <div class="step-item">
            <div class="step-num">2</div>
            <div class="step-content">
              <h4>播放想要提取的视频号视频</h4>
              <p>在微信电脑端点击打开该视频号内容，视频开始缓冲时，嗅探工具会自动捕获其无水印高清 CDN 媒体流地址（.mp4 / .fkey）。</p>
            </div>
          </div>

          <div class="step-item">
            <div class="step-num">3</div>
            <div class="step-content">
              <h4>一键导入并进行 AI 高光分析</h4>
              <p>嗅探流自动接入后，直接点击「AI 高光分析」，系统将自动完成 Whisper 语音转录、时间轴定位与切片高光生成。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scraper-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.scraper-header {
  padding: 2rem;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.header-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #a5b4fc;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.pulse-icon {
  color: #818cf8;
  animation: pulse 2s infinite;
}

.scraper-header h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
  margin: 0 0 0.5rem 0;
}

.subtitle {
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.95rem;
  line-height: 1.5;
  margin: 0;
}

.header-tabs {
  display: flex;
  gap: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 1.25rem;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.tab-btn.active {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.4);
  color: #c7d2fe;
  font-weight: 600;
}

/* Sniff Status Bar */
.sniff-status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 1.25rem;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #34d399;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 8px #34d399;
}

.tip-text {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-refresh:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Cards Grid */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 1.25rem;
}

.video-card {
  border-radius: 12px;
  padding: 1.25rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.video-card:hover {
  border-color: rgba(99, 102, 241, 0.35);
  transform: translateY(-2px);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.source-tag {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: 500;
}

.source-tag.wechat_channels {
  background: rgba(7, 193, 96, 0.15);
  color: #07c160;
  border: 1px solid rgba(7, 193, 96, 0.3);
}

.source-tag.direct_stream {
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.card-time {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
}

.video-title {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #f1f5f9;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.75rem;
}

.url-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.25);
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.url-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.btn-copy {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 0.2rem;
  display: flex;
  align-items: center;
  transition: color 0.2s ease;
}

.btn-copy:hover {
  color: #fff;
}

.text-green {
  color: #34d399;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 0.75rem;
}

.btn-delete {
  background: transparent;
  border: none;
  color: rgba(239, 68, 68, 0.6);
  cursor: pointer;
  padding: 0.35rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.footer-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary-sm {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.8rem;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-secondary-sm:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.btn-primary-sm:hover {
  opacity: 0.9;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  border-radius: 12px;
  text-align: center;
  gap: 1rem;
}

.empty-icon {
  color: rgba(255, 255, 255, 0.2);
}

.empty-state h3 {
  margin: 0;
  color: #fff;
}

.empty-state p {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.9rem;
  margin: 0;
}

/* Tab 2 Form */
.direct-import-panel {
  padding: 2rem;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 720px;
  margin: 0 auto;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #a5b4fc;
}

.panel-header h3 {
  margin: 0;
  color: #fff;
  font-size: 1.25rem;
}

.panel-desc {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.input-field, .textarea-field {
  width: 100%;
  padding: 0.75rem 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #fff;
  font-size: 0.9rem;
  transition: border-color 0.2s ease;
  box-sizing: border-box;
}

.input-field:focus, .textarea-field:focus {
  outline: none;
  border-color: #6366f1;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.5rem;
  border-radius: 8px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Tab 3 Guide */
.guide-panel {
  padding: 2rem;
  border-radius: 16px;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.guide-header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.guide-icon {
  color: #f59e0b;
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.guide-header h3 {
  margin: 0 0 0.4rem 0;
  color: #fff;
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.step-item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.2rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.2);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.step-content h4 {
  margin: 0 0 0.3rem 0;
  color: #f8fafc;
  font-size: 0.95rem;
}

.step-content p {
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.85rem;
  line-height: 1.5;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
