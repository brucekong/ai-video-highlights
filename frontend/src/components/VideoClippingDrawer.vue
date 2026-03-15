<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { X, Scissors, Clock, Play, RotateCcw, Loader2, Download, AlertCircle, RefreshCcw, ChevronLeft, ChevronRight, Settings } from 'lucide-vue-next';

const props = defineProps<{
  show: boolean;
  videoTitle: string;
  videoId: string;
  currentTime: number;
  videoDuration: number;
  initialStart?: number;
  initialEnd?: number;
}>();

const emit = defineEmits(['close', 'seek', 'start-loop', 'stop-loop']);

const startTime = ref(0);
const endTime = ref(0);
const originalTime = ref(0); // 记录刚打开面板时的视频时间
const isGenerating = ref(false);
const errorMsg = ref('');

const isLooping = ref(false);
const showOptions = ref(false);
const exportFormat = ref<'mp4' | 'mp3'>('mp4');
const burnSubtitles = ref(false);

const API_BASE = import.meta.env.VITE_API_URL;

// Format seconds to mm:ss
const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

// Initialize markers when opens
watch(() => props.show, (val) => {
  if (val) {
    originalTime.value = props.currentTime;
    if (props.initialStart !== undefined && props.initialEnd !== undefined) {
      startTime.value = props.initialStart;
      endTime.value = props.initialEnd;
    } else {
      startTime.value = Math.max(0, props.currentTime - 15);
      endTime.value = Math.min(props.videoDuration, props.currentTime + 15);
    }
    errorMsg.value = '';
  } else {
    // Stop loop when drawer is closed
    if (isLooping.value) {
      isLooping.value = false;
      emit('stop-loop');
    }
    showOptions.value = false;
  }
});

const clipDuration = computed(() => {
  return Math.max(0, endTime.value - startTime.value);
});

const isValidRange = computed(() => {
  return endTime.value > startTime.value && clipDuration.value >= 0.5 && clipDuration.value <= 600; // Limit to 10 mins
});

const setStart = () => {
  startTime.value = props.currentTime;
};

const setEnd = () => {
  endTime.value = props.currentTime;
};

const previewRange = () => {
  emit('seek', startTime.value * 1000);
};

const toggleLoop = () => {
  if (isLooping.value) {
    isLooping.value = false;
    emit('stop-loop');
  } else {
    if (isValidRange.value) {
      isLooping.value = true;
      emit('start-loop', startTime.value, endTime.value, 'manual-clip-loop');
    }
  }
};

const nudgeStart = (amount: number) => {
  startTime.value = Math.max(0, Math.min(endTime.value - 0.5, startTime.value + amount));
  startTime.value = Math.round(startTime.value * 10) / 10;
};

const nudgeEnd = (amount: number) => {
  endTime.value = Math.max(startTime.value + 0.5, Math.min(props.videoDuration, endTime.value + amount));
  endTime.value = Math.round(endTime.value * 10) / 10;
};

// Keyboard Shortcuts
const handleKeyDown = (e: KeyboardEvent) => {
  if (!props.show) return;
  // Ignore if typing inside number inputs (allow normal behavior)
  // But if it's purely I/O, we can capture it globally if we check active elements carefully.
  // Actually, I/O in number inputs is not allowed anyway, but we just prevent typing letters.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
     if (e.target.type !== 'number' && e.target.type !== 'range') return;
  }

  if (e.key === 'i' || e.key === 'I') {
    e.preventDefault();
    setStart();
  } else if (e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    setEnd();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeyDown));
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown));

const handleGenerate = async () => {
  if (!isValidRange.value) return;

  isGenerating.value = true;
  errorMsg.value = '';

  try {
    const response = await fetch(`${API_BASE}/api/videos/${props.videoId}/clip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({
        start: startTime.value,
        duration: clipDuration.value,
        format: exportFormat.value,
        burnSubtitles: burnSubtitles.value
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || '剪辑请求失败');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${props.videoTitle.slice(0, 20)}_clip_${Math.floor(startTime.value)}s.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    emit('close');
  } catch (e: any) {
    console.error('Manual clipping failed:', e);
    errorMsg.value = e.message || '生成视频切片时出错';
  } finally {
    isGenerating.value = false;
  }
};
</script>

<template>
  <Transition name="slidedown">
    <div v-if="show" class="drawer-container glass-panel">
      <header class="drawer-header">
        <div class="title-with-icon">
          <div class="icon-wrap">
            <Scissors :size="18" class="accent-color" />
          </div>
          <h3>视频片段剪辑</h3>
        </div>
        <button class="btn-close" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <main class="drawer-content">
        <p class="subtitle">选取视频范围，一键生成高清 MP4 切片</p>

        <div class="range-selector">
          <div class="time-box">
            <label>起始时间 / Start (I)</label>
            <div class="input-with-action">
              <input type="number" v-model.number="startTime" step="0.1" min="0" :max="endTime" />
              <button class="btn-set" @click="setStart" title="快捷键: I">
                <Clock :size="12" />
                <span>此时</span>
              </button>
            </div>
            <div class="nudge-controls">
              <button class="btn-nudge" @click="nudgeStart(-0.5)" title="后退 0.5s"><ChevronLeft :size="12"/>0.5s</button>
              <button class="btn-nudge" @click="nudgeStart(0.5)" title="前进 0.5s">0.5s<ChevronRight :size="12"/></button>
            </div>
            <span class="formatted-time">{{ formatTime(startTime) }}</span>
          </div>

          <div class="range-arrow">
            <div class="duration-pill">{{ clipDuration.toFixed(1) }}s</div>
          </div>

          <div class="time-box">
            <label>结束时间 / End (O)</label>
            <div class="input-with-action">
              <input type="number" v-model.number="endTime" step="0.1" :min="startTime" :max="videoDuration" />
              <button class="btn-set" @click="setEnd" title="快捷键: O">
                <Clock :size="12" />
                <span>此时</span>
              </button>
            </div>
            <div class="nudge-controls">
              <button class="btn-nudge" @click="nudgeEnd(-0.5)" title="后退 0.5s"><ChevronLeft :size="12"/>0.5s</button>
              <button class="btn-nudge" @click="nudgeEnd(0.5)" title="前进 0.5s">0.5s<ChevronRight :size="12"/></button>
            </div>
            <span class="formatted-time">{{ formatTime(endTime) }}</span>
          </div>
        </div>

        <div class="preview-actions">
          <button class="btn-outline" @click="previewRange" title="预览起点播放效果">
            <Play :size="14" />
            <span>预览起点</span>
          </button>
          <button class="btn-outline" :class="{ active: isLooping }" @click="toggleLoop" title="循环播放选定区域">
             <RefreshCcw :size="14" :class="{ spin: isLooping }" />
             <span>{{ isLooping ? '停止循环' : '循环预览' }}</span>
          </button>
          <button class="btn-outline" @click="emit('seek', originalTime * 1000)" title="回到刚才的视频进度">
             <RotateCcw :size="14" />
             <span>回到原处</span>
          </button>
        </div>

        <!-- 导出选项 Toggle -->
        <div class="export-options-toggle" @click="showOptions = !showOptions">
          <span><Settings :size="12" /> 高级导出选项</span>
        </div>

        <!-- 导出选项面板 -->
        <div v-if="showOptions" class="export-options-panel">
           <div class="option-row">
             <label>导出格式</label>
             <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" v-model="exportFormat" value="mp4" /> MP4 视频
                </label>
                <label class="radio-label">
                  <input type="radio" v-model="exportFormat" value="mp3" /> MP3 音频
                </label>
             </div>
           </div>
           <div class="option-row" v-if="exportFormat === 'mp4'">
             <label>字幕处理</label>
             <div class="toggle-group">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="burnSubtitles" />
                  <span class="fake-checkbox"></span>
                  内嵌 AI 双语字幕 (实验性)
                </label>
             </div>
           </div>
        </div>

        <div v-if="errorMsg" class="error-banner">
          <AlertCircle :size="16" />
          <span>{{ errorMsg }}</span>
        </div>

        <div class="info-banner" v-if="clipDuration > 300">
          <AlertCircle :size="14" class="warn-icon" />
          <span>片段过长，生成可能较慢</span>
        </div>
      </main>

      <footer class="drawer-footer">
        <button
          class="btn-primary"
          :disabled="!isValidRange || isGenerating"
          @click="handleGenerate"
        >
          <Loader2 v-if="isGenerating" :size="16" class="spin" />
          <Download v-else :size="16" />
          <span>{{ isGenerating ? '正在生成...' : '下载切片' }}</span>
        </button>
      </footer>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  background: rgba(18, 18, 22, 0.98);
  backdrop-filter: blur(30px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0 0 16px 16px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  z-index: 999;
}

.drawer-header {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.title-with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 4px;
  border-radius: 6px;
}

.drawer-header h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: #fff;
}

.btn-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 4px;
  transition: color 0.2s;
}

.btn-close:hover {
  color: #fff;
}

.drawer-content {
  padding: 12px 16px;
  flex: 1;
}

.subtitle {
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.75rem;
  margin-bottom: 12px;
}

.range-selector {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 12px;
}

.time-box {
  flex: 1;
}

.time-box label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.25);
  margin-bottom: 4px;
  text-transform: uppercase;
}

.input-with-action {
  display: flex;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 2px;
}

.input-with-action input {
  flex: 1;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 5px 8px;
  width: 100%;
  outline: none;
}

.btn-set {
  background: rgba(255, 255, 255, 0.05);
  border: none;
  color: var(--accent-light);
  border-radius: 6px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.65rem;
  cursor: pointer;
}

.formatted-time {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--accent-light);
  margin-top: 4px;
  display: block;
}

.range-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-bottom: 22px;
}

.duration-pill {
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-accent);
  padding: 1px 8px;
  border-radius: 12px;
  font-size: 0.7rem;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.2);
  white-space: nowrap;
}

.preview-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn-outline {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  padding: 8px 4px;
  border-radius: 10px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-outline:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.btn-outline.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: var(--accent-color);
  color: var(--accent-light);
}

.nudge-controls {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
}

.btn-nudge {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  font-size: 0.65rem;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-nudge:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* 导出选项样式 */
.export-options-toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 8px;
  cursor: pointer;
}

.export-options-toggle span {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.2s;
}

.export-options-toggle:hover span {
  color: var(--accent-light);
}

.export-options-panel {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.option-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-row label {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
}

.radio-group, .toggle-group {
  display: flex;
  gap: 12px;
}

.radio-label, .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.8) !important;
  cursor: pointer;
}

.error-banner {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  padding: 10px;
  border-radius: 10px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.info-banner {
  background: rgba(245, 158, 11, 0.05);
  color: #fcd34d;
  padding: 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.drawer-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.btn-primary {
  width: 100%;
  background: var(--accent-color);
  color: #fff;
  border: none;
  padding: 10px;
  border-radius: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.spin {
  animation: spinner 1s linear infinite;
}

@keyframes spinner {
  to { transform: rotate(360deg); }
}

/* Transitions */
.slidedown-enter-active, .slidedown-leave-active {
  transition: all 0.4s;
}

.slidedown-enter-from, .slidedown-leave-to {
  transform: translateY(-100%);
  /* opacity: 0; */
}
</style>
