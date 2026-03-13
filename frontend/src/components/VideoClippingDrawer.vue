<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { X, Scissors, Clock, Play, RotateCcw, Loader2, Download, AlertCircle } from 'lucide-vue-next';

const props = defineProps<{
  show: boolean;
  videoTitle: string;
  videoId: string;
  currentTime: number;
  videoDuration: number;
  initialStart?: number;
  initialEnd?: number;
}>();

const emit = defineEmits(['close', 'seek']);

const startTime = ref(0);
const endTime = ref(0);
const isGenerating = ref(false);
const errorMsg = ref('');

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
    if (props.initialStart !== undefined && props.initialEnd !== undefined) {
      startTime.value = props.initialStart;
      endTime.value = props.initialEnd;
    } else {
      startTime.value = Math.max(0, props.currentTime - 15);
      endTime.value = Math.min(props.videoDuration, props.currentTime + 15);
    }
    errorMsg.value = '';
  }
});

const clipDuration = computed(() => {
  return Math.max(0, endTime.value - startTime.value);
});

const isValidRange = computed(() => {
  return endTime.value > startTime.value && clipDuration.value >= 1 && clipDuration.value <= 600; // Limit to 10 mins
});

const setStart = () => {
  startTime.value = props.currentTime;
};

const setEnd = () => {
  endTime.value = props.currentTime;
};

const previewRange = () => {
  emit('seek', startTime.value);
};

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
        duration: clipDuration.value
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
  <Transition name="drawer-slide">
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
            <label>起始时间 / Start</label>
            <div class="input-with-action">
              <input type="number" v-model.number="startTime" step="0.1" min="0" :max="endTime" />
              <button class="btn-set" @click="setStart" title="使用当前播放时间">
                <Clock :size="12" />
                <span>此时</span>
              </button>
            </div>
            <span class="formatted-time">{{ formatTime(startTime) }}</span>
          </div>

          <div class="range-arrow">
            <div class="duration-pill">{{ clipDuration.toFixed(1) }}s</div>
          </div>

          <div class="time-box">
            <label>结束时间 / End</label>
            <div class="input-with-action">
              <input type="number" v-model.number="endTime" step="0.1" :min="startTime" :max="videoDuration" />
              <button class="btn-set" @click="setEnd" title="使用当前播放时间">
                <Clock :size="12" />
                <span>此时</span>
              </button>
            </div>
            <span class="formatted-time">{{ formatTime(endTime) }}</span>
          </div>
        </div>

        <div class="preview-actions">
          <button class="btn-outline" @click="previewRange">
            <Play :size="14" />
            <span>预览起点</span>
          </button>
          <button class="btn-outline" @click="emit('seek', currentTime)">
             <RotateCcw :size="14" />
             <span>回到原处</span>
          </button>
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
  position: fixed;
  top: 100px; /* Below header */
  right: 20px;
  width: 320px;
  max-height: calc(100vh - 140px);
  background: rgba(15, 15, 18, 0.85);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  z-index: 2500;
}

.drawer-header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.title-with-icon {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 6px;
  border-radius: 8px;
}

.drawer-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
}

.btn-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  padding: 4px;
}

.drawer-content {
  padding: 16px;
  flex: 1;
  overflow-y: auto;
}

.subtitle {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.8rem;
  margin-bottom: 20px;
}

.range-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 20px;
}

.time-box label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 6px;
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
  font-size: 1rem;
  font-weight: 600;
  padding: 6px 10px;
  width: 100%;
  outline: none;
}

.btn-set {
  background: rgba(255, 255, 255, 0.05);
  border: none;
  color: var(--accent-light);
  border-radius: 8px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
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
  justify-content: center;
}

.duration-pill {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-accent);
  padding: 2px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.preview-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.btn-outline {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  padding: 8px;
  border-radius: 10px;
  font-size: 0.8rem;
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
  padding: 16px;
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
.drawer-slide-enter-active, .drawer-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-slide-enter-from, .drawer-slide-leave-to {
  transform: translateX(340px);
  opacity: 0;
}
</style>
