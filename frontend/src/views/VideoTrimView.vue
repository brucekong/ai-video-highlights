<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  Video, Upload, Play, Pause, ChevronLeft, ChevronRight, 
  Download, RefreshCw, ArrowLeft, CheckCircle2, AlertCircle, 
  Loader2, Scissors, Clock, Trash2
} from 'lucide-vue-next';

const router = useRouter();
const API_BASE = import.meta.env.VITE_API_URL;

// 视频文件相关状态
const videoFile = ref<File | null>(null);
const videoSrc = ref<string>('');
const isDragging = ref(false);

// 播放器状态
const videoRef = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const duration = ref(0);
const currentTime = ref(0);

// 裁剪时间段 (秒)
const startTime = ref(0);
const endTime = ref(0);

// 状态管理
const isTrimming = ref(false);
const trimSuccess = ref(false);
const trimError = ref('');
const resultUrl = ref('');
const resultFileName = ref('');

// 清理预览的 Blob URL
const revokeVideoSrc = () => {
  if (videoSrc.value) {
    URL.revokeObjectURL(videoSrc.value);
    videoSrc.value = '';
  }
};

onUnmounted(() => {
  revokeVideoSrc();
});

// 处理拖拽
const onDragOver = () => {
  isDragging.value = true;
};

const onDragLeave = () => {
  isDragging.value = false;
};

const onDrop = (e: DragEvent) => {
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
};

const onFileSelect = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
};

const handleFile = (file: File) => {
  if (!file.type.startsWith('video/')) {
    alert('请选择有效的视频文件');
    return;
  }
  
  // 重置状态
  revokeVideoSrc();
  videoFile.value = file;
  videoSrc.value = URL.createObjectURL(file);
  isPlaying.value = false;
  duration.value = 0;
  currentTime.value = 0;
  startTime.value = 0;
  endTime.value = 0;
  trimSuccess.value = false;
  trimError.value = '';
  resultUrl.value = '';
};

// 视频加载元数据
const onVideoLoaded = () => {
  if (videoRef.value) {
    duration.value = videoRef.value.duration;
    endTime.value = videoRef.value.duration;
  }
};

// 视频时间更新
const onTimeUpdate = () => {
  if (videoRef.value) {
    currentTime.value = videoRef.value.currentTime;
  }
};

// 播放/暂停控制
const togglePlay = () => {
  if (!videoRef.value) return;
  if (isPlaying.value) {
    videoRef.value.pause();
    isPlaying.value = false;
  } else {
    videoRef.value.play();
    isPlaying.value = true;
  }
};

// 调整进度条
const onSeek = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const val = parseFloat(target.value);
  if (videoRef.value) {
    videoRef.value.currentTime = val;
    currentTime.value = val;
  }
};

// 快速跳转 (秒数)
const seekRelative = (seconds: number) => {
  if (videoRef.value) {
    let target = videoRef.value.currentTime + seconds;
    if (target < 0) target = 0;
    if (target > duration.value) target = duration.value;
    videoRef.value.currentTime = target;
    currentTime.value = target;
  }
};

// 格式化时间为 mm:ss.ms
const formatTime = (seconds: number) => {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
};

// 格式化文件大小为 MB
const formatFileSize = (bytes: number) => {
  if (isNaN(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

// 设置当前时间为起点/终点
const setStartToCurrent = () => {
  if (currentTime.value < endTime.value) {
    startTime.value = Number(currentTime.value.toFixed(2));
  } else {
    startTime.value = Number(currentTime.value.toFixed(2));
    endTime.value = Math.min(duration.value, Number((currentTime.value + 1).toFixed(2)));
  }
};

const setEndToCurrent = () => {
  if (currentTime.value > startTime.value) {
    endTime.value = Number(currentTime.value.toFixed(2));
  } else {
    endTime.value = Number(currentTime.value.toFixed(2));
    startTime.value = Math.max(0, Number((currentTime.value - 1).toFixed(2)));
  }
};

// 时间微调
const adjustStart = (val: number) => {
  let target = startTime.value + val;
  if (target < 0) target = 0;
  if (target >= endTime.value) target = endTime.value - 0.1;
  startTime.value = Number(target.toFixed(2));
};

const adjustEnd = (val: number) => {
  let target = endTime.value + val;
  if (target > duration.value) target = duration.value;
  if (target <= startTime.value) target = startTime.value + 0.1;
  endTime.value = Number(target.toFixed(2));
};

// 输入框直接输入时的值校验
const handleStartBlur = () => {
  if (startTime.value < 0) startTime.value = 0;
  if (startTime.value >= endTime.value) {
    startTime.value = Math.max(0, Number((endTime.value - 0.5).toFixed(2)));
  }
};

const handleEndBlur = () => {
  if (endTime.value > duration.value) endTime.value = duration.value;
  if (endTime.value <= startTime.value) {
    endTime.value = Math.min(duration.value, Number((startTime.value + 0.5).toFixed(2)));
  }
};

// 校验是否允许裁剪
const canTrim = computed(() => {
  return videoFile.value && duration.value > 0 && endTime.value > startTime.value;
});

// 裁剪区间 Timeline 高亮位置计算
const trimRangeStyle = computed(() => {
  if (duration.value === 0) return { left: '0%', width: '0%' };
  const left = (startTime.value / duration.value) * 100;
  const width = ((endTime.value - startTime.value) / duration.value) * 100;
  return {
    left: `${left}%`,
    width: `${width}%`
  };
});

// 当前播放时间指针位置计算
const currentPointerStyle = computed(() => {
  if (duration.value === 0) return { left: '0%' };
  const left = (currentTime.value / duration.value) * 100;
  return {
    left: `${left}%`
  };
});

// 执行裁剪
const handleTrim = async () => {
  if (!canTrim.value || !videoFile.value) return;

  isTrimming.value = true;
  trimSuccess.value = false;
  trimError.value = '';

  const formData = new FormData();
  formData.append('video', videoFile.value);
  formData.append('start', startTime.value.toString());
  formData.append('end', endTime.value.toString());

  try {
    const res = await fetch(`${API_BASE}/api/video/trim-local`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || '裁剪处理失败');
    }

    // 获取二进制流并创建本地下载链接
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    resultUrl.value = url;
    resultFileName.value = `trimmed_${videoFile.value.name}`;
    trimSuccess.value = true;

    // 自动触发一次下载
    triggerDownload();

  } catch (error: any) {
    console.error('[Trim Error]', error);
    trimError.value = error.message || '裁剪发生网络或系统错误，请检查后端服务。';
  } finally {
    isTrimming.value = false;
  }
};

// 触发下载裁剪后文件
const triggerDownload = () => {
  if (!resultUrl.value) return;
  const a = document.createElement('a');
  a.href = resultUrl.value;
  a.download = resultFileName.value;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// 清空当前视频
const resetAll = () => {
  revokeVideoSrc();
  videoFile.value = null;
  duration.value = 0;
  currentTime.value = 0;
  startTime.value = 0;
  endTime.value = 0;
  isPlaying.value = false;
  trimSuccess.value = false;
  trimError.value = '';
  resultUrl.value = '';
  resultFileName.value = '';
};

</script>

<template>
  <div class="video-trim-view animate-fade-in">
    <!-- Back to Home -->
    <div class="back-link" @click="router.push('/')">
      <ArrowLeft :size="16" />
      <span>返回首页</span>
    </div>

    <!-- Title -->
    <div class="page-title">
      <div class="icon-wrap">
        <Scissors :size="28" class="logo-icon animate-pulse-glow" />
      </div>
      <div>
        <h2>本地视频裁剪</h2>
        <p>导入本地视频文件，选择您想要的精彩片段进行高精度转码裁剪</p>
      </div>
    </div>

    <!-- Main Container -->
    <div class="main-container glass-panel">
      
      <!-- Video Drop/Import Area -->
      <div 
        v-if="!videoFile"
        class="import-area"
        :class="{ dragging: isDragging }"
        @dragover.prevent="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
        @click="$refs.fileInput.click()"
      >
        <input 
          ref="fileInput"
          type="file"
          accept="video/*"
          class="hidden-input"
          @change="onFileSelect"
        />
        <div class="upload-icon-wrap">
          <Upload :size="48" class="upload-icon" />
        </div>
        <h3>导入本地视频</h3>
        <p class="drag-hint">拖拽视频文件到这里，或点击区域进行浏览选择</p>
        <p class="file-limits">支持 MP4, WebM, MOV 等主流视频格式，推荐 1GB 以内</p>
      </div>

      <!-- Video Workspace (Loaded State) -->
      <div v-else class="workspace-grid">
        
        <!-- Left Side: Player -->
        <div class="player-panel">
          <div class="video-wrapper glass-panel">
            <video 
              ref="videoRef"
              :src="videoSrc"
              @loadedmetadata="onVideoLoaded"
              @timeupdate="onTimeUpdate"
              @click="togglePlay"
            ></video>
            
            <!-- Custom play button overlay when paused -->
            <div v-if="!isPlaying" class="play-overlay" @click="togglePlay">
              <div class="play-btn-circle">
                <Play :size="28" style="transform: translateX(2px);" />
              </div>
            </div>
          </div>

          <!-- Video Custom Controls -->
          <div class="controls-bar glass-panel">
            <button class="control-btn" @click="seekRelative(-10)" title="后退 10 秒">
              <ChevronLeft :size="18" />
              <span class="btn-subtext">-10s</span>
            </button>
            <button class="control-btn play-toggle-btn" @click="togglePlay">
              <Pause v-if="isPlaying" :size="20" />
              <Play v-else :size="20" />
            </button>
            <button class="control-btn" @click="seekRelative(10)" title="前进 10 秒">
              <ChevronRight :size="18" />
              <span class="btn-subtext">+10s</span>
            </button>
            
            <div class="time-display">
              <span class="current">{{ formatTime(currentTime) }}</span>
              <span class="divider">/</span>
              <span class="total">{{ formatTime(duration) }}</span>
            </div>
          </div>

          <!-- Interactive Range Timeline -->
          <div class="timeline-container">
            <div class="timeline-track-wrapper">
              <!-- Total Track (Dark gray background) -->
              <div class="timeline-total-track"></div>
              <!-- Highlighting range [start, end] (Neon Purple Gradient) -->
              <div class="timeline-trim-range" :style="trimRangeStyle"></div>
              <!-- Current Play Pointer (Red/White line) -->
              <div class="timeline-play-pointer" :style="currentPointerStyle"></div>
              
              <!-- Transparent native input overlay for easy scrubbing -->
              <input 
                type="range"
                min="0"
                :max="duration"
                step="0.01"
                v-model="currentTime"
                @input="onSeek"
                class="timeline-slider"
              />
            </div>
            <div class="timeline-markers">
              <span>00:00</span>
              <span>{{ formatTime(duration / 2) }}</span>
              <span>{{ formatTime(duration) }}</span>
            </div>
          </div>
        </div>

        <!-- Right Side: Trimming Console -->
        <div class="console-panel">
          <div class="section-title">
            <Clock :size="16" />
            <span>裁剪选项</span>
          </div>

          <!-- File Meta Info Card -->
          <div class="meta-card glass-panel">
            <div class="meta-row">
              <span class="label">文件名称:</span>
              <span class="value filename-val" :title="videoFile.name">{{ videoFile.name }}</span>
            </div>
            <div class="meta-row">
              <span class="label">文件大小:</span>
              <span class="value">{{ formatFileSize(videoFile.size) }}</span>
            </div>
            <div class="meta-row">
              <span class="label">视频时长:</span>
              <span class="value">{{ formatTime(duration) }}</span>
            </div>
          </div>

          <!-- Start Point Config -->
          <div class="time-config-card glass-panel">
            <div class="card-header">
              <span class="point-tag start">起点</span>
              <span class="time-val">{{ formatTime(startTime) }}</span>
            </div>
            <div class="adjust-inputs">
              <div class="number-input-group">
                <input 
                  type="number"
                  step="0.1"
                  min="0"
                  :max="endTime"
                  v-model="startTime"
                  @blur="handleStartBlur"
                />
                <span class="unit">秒</span>
              </div>
              <button class="btn-set-current" @click="setStartToCurrent">
                将当前时间设为起点
              </button>
            </div>
            <div class="micro-adjust-group">
              <button @click="adjustStart(-1.0)">-1.0s</button>
              <button @click="adjustStart(-0.1)">-0.1s</button>
              <button @click="adjustStart(0.1)">+0.1s</button>
              <button @click="adjustStart(1.0)">+1.0s</button>
            </div>
          </div>

          <!-- End Point Config -->
          <div class="time-config-card glass-panel">
            <div class="card-header">
              <span class="point-tag end">终点</span>
              <span class="time-val">{{ formatTime(endTime) }}</span>
            </div>
            <div class="adjust-inputs">
              <div class="number-input-group">
                <input 
                  type="number"
                  step="0.1"
                  :min="startTime"
                  :max="duration"
                  v-model="endTime"
                  @blur="handleEndBlur"
                />
                <span class="unit">秒</span>
              </div>
              <button class="btn-set-current" @click="setEndToCurrent">
                将当前时间设为终点
              </button>
            </div>
            <div class="micro-adjust-group">
              <button @click="adjustEnd(-1.0)">-1.0s</button>
              <button @click="adjustEnd(-0.1)">-0.1s</button>
              <button @click="adjustEnd(0.1)">+0.1s</button>
              <button @click="adjustEnd(1.0)">+1.0s</button>
            </div>
          </div>

          <!-- Summary segment info -->
          <div class="range-summary">
            <span>已选择片段时长:</span>
            <strong class="highlight-duration">{{ (endTime - startTime).toFixed(1) }}s</strong>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons-group">
            <button 
              class="btn-action-trim btn-gradient-neon" 
              :disabled="!canTrim || isTrimming"
              @click="handleTrim"
            >
              <Scissors :size="18" />
              <span>开始裁剪并下载</span>
            </button>
            
            <button class="btn-action-reset" @click="resetAll" :disabled="isTrimming">
              <Trash2 :size="16" />
              <span>清空并重新导入</span>
            </button>
          </div>

        </div>

      </div>

    </div>

    <!-- Success overlay / dialog -->
    <div v-if="trimSuccess" class="overlay success-overlay fade-in">
      <div class="dialog-card glass-panel text-center">
        <CheckCircle2 :size="64" class="success-icon animate-pulse-glow" />
        <h2>裁剪处理完成!</h2>
        <p>裁剪后的文件已成功生成，并自动开始下载。</p>
        <div class="result-file-box">
          <Video :size="18" />
          <span>{{ resultFileName }}</span>
        </div>
        <div class="dialog-buttons">
          <button class="btn-dialog-primary" @click="triggerDownload">
            <Download :size="18" />
            <span>再次下载</span>
          </button>
          <button class="btn-dialog-secondary" @click="trimSuccess = false">
            <span>继续微调</span>
          </button>
          <button class="btn-dialog-secondary" @click="resetAll">
            <RefreshCw :size="16" />
            <span>裁剪新视频</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Error notice -->
    <div v-if="trimError" class="overlay error-overlay fade-in">
      <div class="dialog-card glass-panel text-center">
        <AlertCircle :size="64" class="error-icon animate-pulse-glow" />
        <h2>裁剪失败</h2>
        <p class="error-msg-detail">{{ trimError }}</p>
        <div class="dialog-buttons text-center justify-center">
          <button class="btn-dialog-primary btn-error-retry" @click="trimError = ''">
            <span>返回调整参数</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Trimming Loading Overlay -->
    <div v-if="isTrimming" class="overlay processing-overlay">
      <div class="dialog-card glass-panel text-center">
        <div class="spinner-container">
          <Loader2 :size="64" class="spin-icon spin" />
          <Scissors :size="24" class="center-scissors animate-pulse" />
        </div>
        <h2>视频切片处理中...</h2>
        <p>正在后台调用 ffmpeg 进行高兼容性重编码，大文件处理需要较长时间，请不要关闭或刷新此页面...</p>
        <div class="loader-steps">
          <div class="step-item active">上传视频流</div>
          <div class="step-arrow">→</div>
          <div class="step-item active">FFmpeg 切片</div>
          <div class="step-arrow">→</div>
          <div class="step-item">下载切片文件</div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.video-trim-view {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 10px 0 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.back-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  width: fit-content;
  transition: color var(--transition-fast);
}

.back-link:hover {
  color: var(--text-accent);
}

.page-title {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 5px;
}

.icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 14px;
  border-radius: var(--radius-md);
}

.logo-icon {
  color: var(--accent-color);
}

.page-title h2 {
  font-size: 1.8rem;
  font-weight: 800;
  color: #fff;
  margin: 0 0 4px 0;
}

.page-title p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin: 0;
}

.main-container {
  width: 100%;
  min-height: 520px;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

/* Hidden elements */
.hidden-input {
  display: none;
}

/* Import Area Style */
.import-area {
  flex: 1;
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  cursor: pointer;
  transition: all var(--transition-normal);
  background: rgba(255, 255, 255, 0.01);
  min-height: 450px;
}

.import-area:hover, .import-area.dragging {
  border-color: var(--accent-color);
  background: rgba(99, 102, 241, 0.03);
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}

.upload-icon-wrap {
  background: rgba(99, 102, 241, 0.08);
  padding: 20px;
  border-radius: 50%;
  margin-bottom: 20px;
  color: var(--text-accent);
}

.import-area h3 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 10px;
  color: #fff;
}

.drag-hint {
  color: var(--text-secondary);
  font-size: 1rem;
  margin-bottom: 8px;
}

.file-limits {
  color: var(--text-secondary);
  opacity: 0.6;
  font-size: 0.85rem;
}

/* Workspace Grid Layout */
.workspace-grid {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 32px;
  width: 100%;
}

/* Player Panel Styling */
.player-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.video-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #000;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
}

.video-wrapper video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
}

.play-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.3s;
}

.play-btn-circle {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.9);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 30px var(--accent-glow);
  transition: all var(--transition-fast);
}

.play-overlay:hover .play-btn-circle {
  transform: scale(1.1);
  background: #4f46e5;
  box-shadow: 0 0 40px var(--accent-color);
}

.controls-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
}

.control-btn {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.play-toggle-btn {
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-accent);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.play-toggle-btn:hover {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

.btn-subtext {
  font-size: 0.65rem;
  margin-top: -2px;
  opacity: 0.8;
}

.time-display {
  margin-left: auto;
  font-family: monospace;
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}

.time-display .current {
  color: #fff;
  font-weight: 700;
}

.time-display .divider {
  margin: 0 6px;
  color: var(--text-secondary);
  opacity: 0.5;
}

.time-display .total {
  color: var(--text-secondary);
}

/* Timeline Custom Overlay range */
.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.timeline-track-wrapper {
  position: relative;
  height: 10px;
  width: 100%;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.05);
  overflow: visible;
}

.timeline-total-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
}

.timeline-trim-range {
  position: absolute;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #a5b4fc);
  border-radius: 4px;
  box-shadow: 0 0 12px var(--accent-glow);
  opacity: 0.75;
}

.timeline-play-pointer {
  position: absolute;
  top: -4px;
  width: 4px;
  height: 18px;
  background: #ff4757;
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(255, 71, 87, 0.6);
  z-index: 2;
  pointer-events: none;
}

.timeline-slider {
  position: absolute;
  top: -4px;
  left: 0;
  width: 100%;
  height: 18px;
  opacity: 0;
  cursor: pointer;
  z-index: 3;
  margin: 0;
}

.timeline-markers {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 0.8rem;
  opacity: 0.7;
}

/* Console Panel Styling */
.console-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 10px;
}

.meta-card {
  padding: 14px 18px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: var(--radius-md);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}

.meta-row .label {
  color: var(--text-secondary);
}

.meta-row .value {
  color: #fff;
  font-weight: 600;
}

.filename-val {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-accent) !important;
}

.time-config-card {
  padding: 16px 18px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: var(--radius-md);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.point-tag {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 4px;
  text-transform: uppercase;
}

.point-tag.start {
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.point-tag.end {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.time-val {
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
  font-family: monospace;
}

.adjust-inputs {
  display: flex;
  gap: 12px;
  align-items: center;
}

.number-input-group {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  flex: 1;
}

.number-input-group input {
  width: 100%;
  border: none;
  background: transparent;
  color: #fff;
  height: 38px;
  font-size: 0.95rem;
  outline: none;
  font-family: monospace;
}

/* Remove spin arrows from input number */
.number-input-group input::-webkit-outer-spin-button,
.number-input-group input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input-group .unit {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.btn-set-current {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  height: 40px;
  padding: 0 14px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.btn-set-current:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--text-secondary);
}

.micro-adjust-group {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.micro-adjust-group button {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  height: 30px;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: monospace;
  border-radius: 6px;
}

.micro-adjust-group button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.15);
}

.range-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.highlight-duration {
  font-size: 1.2rem;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #a5b4fc, #818cf8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.action-buttons-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}

.btn-action-trim {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  height: 48px;
  border-radius: 100px;
  font-weight: 700;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
}

.btn-action-trim:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 22px rgba(99, 102, 241, 0.5);
  filter: brightness(1.1);
}

.btn-action-trim:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn-action-reset {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  height: 44px;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-action-reset:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
  color: #f87171;
}

.btn-action-reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Modal Overlay Styling */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(8, 8, 10, 0.85);
  backdrop-filter: blur(12px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-card {
  width: 480px;
  padding: 40px;
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}

.text-center {
  text-align: center;
}

.success-icon {
  color: #10b981;
  margin-bottom: 24px;
}

.dialog-card h2 {
  font-size: 1.6rem;
  font-weight: 800;
  color: #fff;
  margin-bottom: 12px;
}

.dialog-card p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin-bottom: 24px;
}

.result-file-box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px 18px;
  border-radius: var(--radius-md);
  color: var(--text-accent);
  width: 100%;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 28px;
  justify-content: center;
}

.result-file-box span {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.btn-dialog-primary {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff;
  height: 46px;
  border-radius: 100px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
}

.btn-dialog-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.4);
  filter: brightness(1.08);
}

.btn-dialog-secondary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  height: 44px;
  border-radius: 100px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

.btn-dialog-secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

/* Error dialog specific styling */
.error-icon {
  color: #ef4444;
  margin-bottom: 24px;
}

.error-msg-detail {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.12);
  padding: 12px 18px;
  border-radius: var(--radius-md);
  color: #f87171 !important;
  font-family: monospace;
  font-size: 0.85rem !important;
  text-align: left;
  word-break: break-all;
  width: 100%;
}

.btn-error-retry {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  box-shadow: none;
}

.btn-error-retry:hover {
  background: rgba(255, 255, 255, 0.12);
  box-shadow: none;
}

/* Spinner for Loading overlay */
.spinner-container {
  position: relative;
  width: 90px;
  height: 90px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spin-icon {
  color: var(--accent-color);
  width: 80px !important;
  height: 80px !important;
  opacity: 0.8;
}

.center-scissors {
  position: absolute;
  color: var(--text-accent);
}

.processing-overlay h2 {
  margin-bottom: 12px;
}

.processing-overlay p {
  margin-bottom: 30px;
}

.loader-steps {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.step-item {
  opacity: 0.4;
  font-weight: 500;
}

.step-item.active {
  opacity: 1;
  color: var(--text-accent);
  font-weight: 700;
}

.step-arrow {
  opacity: 0.3;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.7; }
}

.animate-pulse {
  animation: pulse 1.8s infinite ease-in-out;
}

</style>
