<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { 
  Video, Upload, Play, Pause, ChevronLeft, ChevronRight, 
  Download, RefreshCw, ArrowLeft, CheckCircle2, AlertCircle, 
  Loader2, Scissors, Clock, Trash2, HelpCircle, Camera, Search, X, Copy
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

// 拖动轨道引用
const trackRef = ref<HTMLElement | null>(null);

// 剪切进度百分比 (0 - 100)
const trimProgress = ref(0);

// 已截取的封面图历史列表
interface CapturedCover {
  id: string;
  url: string;
  time: number;
}
const capturedCovers = ref<CapturedCover[]>([]);

// 当前正在放大预览的封面图
const activePreviewCover = ref<CapturedCover | null>(null);

// 截取当前帧画面
const captureCurrentFrame = () => {
  const video = videoRef.value;
  if (!video || duration.value === 0) return;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const coverId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    capturedCovers.value.unshift({
      id: coverId,
      url: dataUrl,
      time: video.currentTime
    });

    // 触发全局通知
    window.dispatchEvent(new CustomEvent('notify', {
      detail: {
        message: `已成功截取并保存 ${formatTime(video.currentTime)} 帧画面，可在右侧查看。`,
        title: '封面截取成功',
        type: 'success',
        duration: 3000
      }
    }));

  } catch (error) {
    console.error('Capture frame failed:', error);
    alert('截取封面失败，请重试。');
  }
};

// 下载封面
const downloadCover = (cover: CapturedCover) => {
  const a = document.createElement('a');
  a.href = cover.url;
  const baseName = videoFile.value ? videoFile.value.name.replace(/\.[^/.]+$/, "") : 'video';
  a.download = `cover_${baseName}_${formatTime(cover.time).replace(':', '_')}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// 复制封面到剪贴板
const copyCoverToClipboard = async (cover: CapturedCover) => {
  try {
    const res = await fetch(cover.url);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    
    // 触发全局通知
    window.dispatchEvent(new CustomEvent('notify', {
      detail: {
        message: '已复制截图到剪贴板，您可以在其他应用（如 ChatGPT、飞书等）中直接粘贴。',
        title: '复制成功',
        type: 'success',
        duration: 3000
      }
    }));
  } catch (error) {
    console.error('Copy cover failed:', error);
    window.dispatchEvent(new CustomEvent('notify', {
      detail: {
        message: '复制图片失败，当前浏览器可能不支持此操作，请使用下载功能。',
        title: '复制失败',
        type: 'error',
        duration: 4000
      }
    }));
  }
};

// 删除封面
const removeCover = (id: string) => {
  capturedCovers.value = capturedCovers.value.filter(c => c.id !== id);
};

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

// 处理拖拽文件
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

// 预设截取时长从当前开始
const clipPreset = (seconds: number) => {
  if (duration.value === 0) return;
  startTime.value = Number(currentTime.value.toFixed(2));
  endTime.value = Number(Math.min(duration.value, currentTime.value + seconds).toFixed(2));
  
  // 预览裁剪区域开头画面
  if (videoRef.value) {
    videoRef.value.currentTime = startTime.value;
    currentTime.value = startTime.value;
  }
};

// 自定义双手柄拖拽逻辑
const onDragStart = (type: 'start' | 'end' | 'play', e: MouseEvent) => {
  e.preventDefault();
  const track = trackRef.value;
  if (!track || duration.value === 0) return;

  const updatePosition = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    let percentage = (clientX - rect.left) / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    const time = percentage * duration.value;

    if (type === 'start') {
      startTime.value = Number(Math.min(time, endTime.value - 0.05).toFixed(2));
      // 拖拽起点时，跳转视频画面，方便预览起点帧
      if (videoRef.value) {
        videoRef.value.currentTime = startTime.value;
        currentTime.value = startTime.value;
      }
    } else if (type === 'end') {
      endTime.value = Number(Math.max(time, startTime.value + 0.05).toFixed(2));
      // 拖拽终点时，跳转视频画面，方便预览终点帧
      if (videoRef.value) {
        videoRef.value.currentTime = endTime.value;
        currentTime.value = endTime.value;
      }
    } else if (type === 'play') {
      currentTime.value = Number(time.toFixed(2));
      if (videoRef.value) {
        videoRef.value.currentTime = currentTime.value;
      }
    }
  };

  updatePosition(e.clientX);

  const onMouseMove = (moveEvent: MouseEvent) => {
    updatePosition(moveEvent.clientX);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
};

// 点击轨道空白处跳转播放进度
const onTrackClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  // 排除点击手柄的情况
  if (target.closest('.timeline-handle') || target.closest('.timeline-playhead-handle')) {
    return;
  }

  const track = trackRef.value;
  if (!track || duration.value === 0) return;

  const rect = track.getBoundingClientRect();
  let percentage = (e.clientX - rect.left) / rect.width;
  percentage = Math.max(0, Math.min(1, percentage));
  const time = percentage * duration.value;

  currentTime.value = Number(time.toFixed(2));
  if (videoRef.value) {
    videoRef.value.currentTime = currentTime.value;
  }
};

// 从起点播放预览
const playFromStart = () => {
  if (videoRef.value) {
    videoRef.value.currentTime = startTime.value;
    currentTime.value = startTime.value;
    videoRef.value.play();
    isPlaying.value = true;
  }
};

// 预览终点前的 3 秒
const playToEndPreview = () => {
  if (videoRef.value) {
    const previewStart = Math.max(startTime.value, endTime.value - 3);
    videoRef.value.currentTime = previewStart;
    currentTime.value = previewStart;
    videoRef.value.play();
    isPlaying.value = true;
  }
};

// 键盘快捷键监听
const handleKeyDown = (e: KeyboardEvent) => {
  // ESC 键关闭弹窗 (大图预览、成功弹窗、失败弹窗)
  if (e.key === 'Escape') {
    let closedAny = false;
    if (activePreviewCover.value) {
      activePreviewCover.value = null;
      closedAny = true;
    } else if (trimSuccess.value) {
      trimSuccess.value = false;
      closedAny = true;
    } else if (trimError.value) {
      trimError.value = '';
      closedAny = true;
    }
    if (closedAny) {
      e.preventDefault();
      return;
    }
  }

  const activeEl = document.activeElement;
  // 如果焦点在输入框，忽略快捷键以免影响正常打字
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    return;
  }

  if (!videoFile.value || duration.value === 0) return;

  switch (e.key) {
    case ' ': // 空格键播放/暂停
      e.preventDefault();
      togglePlay();
      break;
    case '[': // 设置起点
      e.preventDefault();
      setStartToCurrent();
      break;
    case ']': // 设置终点
      e.preventDefault();
      setEndToCurrent();
      break;
    case 'ArrowLeft': // 微调快退
      e.preventDefault();
      seekRelative(e.shiftKey ? -5 : -0.5);
      break;
    case 'ArrowRight': // 微调快进
      e.preventDefault();
      seekRelative(e.shiftKey ? 5 : 0.5);
      break;
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

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
const handleTrim = () => {
  if (!canTrim.value || !videoFile.value) return;

  isTrimming.value = true;
  trimSuccess.value = false;
  trimError.value = '';
  trimProgress.value = 0;

  const formData = new FormData();
  // 必须先 append 文本字段，最后 append 大视频文件
  // 这是因为 Fastify 流式解析 multipart 请求时，如果视频在前，流解析完后后面的文本字段可能还没被传输，导致 data.fields 里拿不到值。
  formData.append('start', startTime.value.toString());
  formData.append('end', endTime.value.toString());
  formData.append('video', videoFile.value);

  // 使用 XMLHttpRequest 替代 fetch 方式以获得真实的流式上传进度监听
  const xhr = new XMLHttpRequest();
  
  // 监听上传进度（占总进度的 0% - 85% 权重）
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentage = (e.loaded / e.total) * 85;
      trimProgress.value = Math.round(percentage);
    }
  });

  // ffmpeg 转码阶段模拟进度（占总进度的 85% - 98% 权重）
  let transcodeTimer: any = null;
  const startTranscodeProgress = () => {
    trimProgress.value = 85;
    transcodeTimer = setInterval(() => {
      if (trimProgress.value < 98) {
        trimProgress.value += 1;
      } else {
        clearInterval(transcodeTimer);
      }
    }, 450); // 每 450ms 递增 1%
  };

  // 监听上传完毕事件，开始进入转码阶段
  xhr.upload.addEventListener('load', () => {
    startTranscodeProgress();
  });

  xhr.addEventListener('load', () => {
    if (transcodeTimer) clearInterval(transcodeTimer);
    
    if (xhr.status >= 200 && xhr.status < 300) {
      trimProgress.value = 100;
      
      // 处理流式下载
      const blob = xhr.response; // 必须是 blob 类型
      const url = URL.createObjectURL(blob);
      resultUrl.value = url;
      resultFileName.value = `trimmed_${videoFile.value!.name}`;
      trimSuccess.value = true;
      isTrimming.value = false;
      
      // 自动触发一次下载
      triggerDownload();
    } else {
      isTrimming.value = false;
      // 尝试解析 Blob 中的错误 JSON 信息
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const errData = JSON.parse(reader.result as string);
          trimError.value = errData.message || errData.error || '裁剪失败';
        } catch {
          trimError.value = '裁剪处理失败，请稍后重试。';
        }
      };
      reader.readAsText(xhr.response || new Blob());
    }
  });

  xhr.addEventListener('error', () => {
    if (transcodeTimer) clearInterval(transcodeTimer);
    isTrimming.value = false;
    trimError.value = '裁剪发生网络或系统错误，请检查后端服务。';
  });

  // 使用 POST 请求，并在 URL 上携带 query string 双重保险
  xhr.open('POST', `${API_BASE}/api/video/trim-local?start=${startTime.value}&end=${endTime.value}`);
  xhr.responseType = 'blob';
  xhr.send(formData);
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
            <button class="control-btn play-toggle-btn" @click="togglePlay" title="播放 / 暂停 (空格键)">
              <Pause v-if="isPlaying" :size="20" />
              <Play v-else :size="20" />
            </button>
            <button class="control-btn" @click="seekRelative(10)" title="前进 10 秒">
              <ChevronRight :size="18" />
              <span class="btn-subtext">+10s</span>
            </button>

            <!-- Camera shortcut for capturing frame -->
            <button 
              class="control-btn camera-btn" 
              @click="captureCurrentFrame" 
              :disabled="duration === 0" 
              title="截取当前画面为封面"
            >
              <Camera :size="18" />
            </button>
            
            <div class="time-display">
              <span class="current">{{ formatTime(currentTime) }}</span>
              <span class="divider">/</span>
              <span class="total">{{ formatTime(duration) }}</span>
            </div>
          </div>

          <!-- Custom Dual-Handle Interactive Timeline -->
          <div class="timeline-container">
            <div class="timeline-track-wrapper" ref="trackRef" @mousedown="onTrackClick">
              <!-- Total Track (Dark background) -->
              <div class="timeline-total-track"></div>
              
              <!-- Highlighting range [start, end] (Neon Purple Gradient) -->
              <div class="timeline-trim-range" :style="trimRangeStyle">
                <!-- Left handle (Start Point) -->
                <div 
                  class="timeline-handle start-handle"
                  @mousedown.stop="onDragStart('start', $event)"
                  title="拖动调整裁剪起点"
                >
                  <div class="handle-bar"></div>
                  <div class="handle-tooltip">{{ formatTime(startTime) }}</div>
                </div>
                <!-- Right handle (End Point) -->
                <div 
                  class="timeline-handle end-handle"
                  @mousedown.stop="onDragStart('end', $event)"
                  title="拖动调整裁剪终点"
                >
                  <div class="handle-bar"></div>
                  <div class="handle-tooltip">{{ formatTime(endTime) }}</div>
                </div>
              </div>
              
              <!-- Playhead Pointer (Red line & dot) -->
              <div 
                class="timeline-playhead-handle" 
                :style="currentPointerStyle"
                @mousedown.stop="onDragStart('play', $event)"
                title="拖动调整当前播放进度"
              >
                <div class="playhead-cap"></div>
                <div class="playhead-line"></div>
                <div class="playhead-tooltip">{{ formatTime(currentTime) }}</div>
              </div>
            </div>
            
            <div class="timeline-markers">
              <span>00:00</span>
              <span class="timeline-tip-center">💡 拖曳紫色区域边缘调整裁剪范围，拖拽红色指针调整播放</span>
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
              <div class="flex items-center gap-2">
                <span class="point-tag start">起点</span>
                <button class="btn-play-preview" @click="playFromStart" title="从起点播放预览">
                  <Play :size="12" />
                  <span>预览</span>
                </button>
                <span class="hotkey-tip">快捷键 [</span>
              </div>
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
                设当前为起点
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
              <div class="flex items-center gap-2">
                <span class="point-tag end">终点</span>
                <button class="btn-play-preview end-preview" @click="playToEndPreview" title="预览终点前 3 秒">
                  <Play :size="12" />
                  <span>预览</span>
                </button>
                <span class="hotkey-tip">快捷键 ]</span>
              </div>
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
                设当前为终点
              </button>
            </div>
            <div class="micro-adjust-group">
              <button @click="adjustEnd(-1.0)">-1.0s</button>
              <button @click="adjustEnd(-0.1)">-0.1s</button>
              <button @click="adjustEnd(0.1)">+0.1s</button>
              <button @click="adjustEnd(1.0)">+1.0s</button>
            </div>
          </div>

          <!-- Cover Capture Panel -->
          <div class="presets-card glass-panel">
            <div class="presets-header flex items-center justify-between">
              <span>选取帧作封面:</span>
              <span class="hotkey-tip" v-if="capturedCovers.length > 0">已截取 {{ capturedCovers.length }} 张</span>
            </div>
            
            <button 
              class="btn-action-capture" 
              @click="captureCurrentFrame" 
              :disabled="duration === 0"
            >
              <Camera :size="15" />
              <span>截取当前帧画面</span>
            </button>

            <!-- Captured list thumbnails -->
            <div v-if="capturedCovers.length > 0" class="covers-grid">
              <div 
                v-for="cover in capturedCovers" 
                :key="cover.id" 
                class="cover-thumbnail-wrapper"
              >
                <img :src="cover.url" class="cover-thumbnail" alt="Cover Preview" />
                <span class="cover-time-tag">{{ formatTime(cover.time) }}</span>
                <div class="cover-actions-overlay">
                  <!-- 🔍 放大查看按钮 -->
                  <button class="cover-action-btn" @click="activePreviewCover = cover" title="放大查看">
                    <Search :size="12" />
                  </button>
                  <!-- 📋 复制到剪贴板按钮 -->
                  <button class="cover-action-btn" @click="copyCoverToClipboard(cover)" title="复制到剪贴板">
                    <Copy :size="12" />
                  </button>
                  <!-- 📥 下载高清按钮 -->
                  <button class="cover-action-btn" @click="downloadCover(cover)" title="下载高清原图">
                    <Download :size="12" />
                  </button>
                  <!-- 🗑️ 删除按钮 -->
                  <button class="cover-action-btn delete" @click="removeCover(cover.id)" title="删除">
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <p v-else class="presets-empty-hint">在播放中看到满意的画面时，点击上方按钮或控制栏相机即可无损截取为封面图。</p>
          </div>

          <!-- Quick Duration Presets -->
          <div class="presets-card glass-panel">
            <div class="presets-header">
              <span>一键向后截取:</span>
            </div>
            <div class="preset-buttons">
              <button @click="clipPreset(5)" :disabled="duration === 0">5s</button>
              <button @click="clipPreset(10)" :disabled="duration === 0">10s</button>
              <button @click="clipPreset(15)" :disabled="duration === 0">15s</button>
              <button @click="clipPreset(30)" :disabled="duration === 0">30s</button>
              <button @click="clipPreset(60)" :disabled="duration === 0">60s</button>
            </div>
          </div>

          <!-- Highlight duration & action buttons -->
          <div class="range-summary">
            <span>已选择片段时长:</span>
            <strong class="highlight-duration">{{ (endTime - startTime).toFixed(1) }}s</strong>
          </div>

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

          <!-- Hotkeys Cheat Sheet -->
          <div class="hotkeys-card glass-panel">
            <div class="hotkeys-title">
              <HelpCircle :size="14" />
              <span>键盘快捷键指引</span>
            </div>
            <div class="hotkeys-list">
              <div class="hotkey-row"><kbd>空格 Space</kbd> <span>播放 / 暂停视频</span></div>
              <div class="hotkey-row"><kbd>[</kbd> <span>当前时间设为起点</span></div>
              <div class="hotkey-row"><kbd>]</kbd> <span>当前时间设为终点</span></div>
              <div class="hotkey-row"><kbd>←</kbd> / <kbd>→</kbd> <span>微调时间进度 ±0.5s</span></div>
              <div class="hotkey-row"><kbd>Shift + ←/→</kbd> <span>快速时间跳转 ±5.0s</span></div>
            </div>
          </div>

        </div>

      </div>

    </div>

    <!-- Teleport overlays to body to avoid transform containing block layout issues and ensure absolute viewport centering -->
    <Teleport to="body">
      <!-- Success overlay / dialog -->
      <Transition name="dialog-fade">
        <div v-if="trimSuccess" class="overlay success-overlay">
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
      </Transition>

      <!-- Error notice -->
      <Transition name="dialog-fade">
        <div v-if="trimError" class="overlay error-overlay">
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
      </Transition>

      <!-- Trimming Loading Overlay -->
      <Transition name="dialog-fade">
        <div v-if="isTrimming" class="overlay processing-overlay">
          <div class="dialog-card glass-panel text-center">
            <div class="spinner-container">
              <Loader2 :size="64" class="spin-icon spin" />
              <Scissors :size="24" class="center-scissors animate-pulse" />
            </div>
            <h2>视频切片处理中...</h2>
            
            <!-- Premium Linear Progress Bar -->
            <div class="progress-container">
              <div class="progress-bar-wrapper">
                <div class="progress-bar-fill" :style="{ width: trimProgress + '%' }"></div>
              </div>
              <div class="progress-percentage-label">
                <span class="progress-status-text">
                  {{ trimProgress < 85 ? `正在上传视频文件...` : `视频上传完成，FFmpeg 正在转码切片...` }}
                </span>
                <span class="progress-num">{{ trimProgress }}%</span>
              </div>
            </div>

            <p>正在后台调用 ffmpeg 进行高兼容性重编码，大文件处理需要较长时间，请不要关闭或刷新此页面...</p>
            <div class="loader-steps">
              <div class="step-item" :class="{ active: trimProgress > 0 }">上传视频流</div>
              <div class="step-arrow">→</div>
              <div class="step-item" :class="{ active: trimProgress >= 85 }">FFmpeg 切片</div>
              <div class="step-arrow">→</div>
              <div class="step-item" :class="{ active: trimProgress === 100 }">下载切片文件</div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- HD Cover Large Preview Modal -->
      <Transition name="dialog-fade">
        <div v-if="activePreviewCover" class="overlay preview-modal-overlay" @click="activePreviewCover = null">
          <div class="preview-dialog-card glass-panel" @click.stop>
            <div class="preview-header">
              <span class="preview-title">📷 封面大图预览 ({{ formatTime(activePreviewCover.time) }})</span>
              <button class="btn-close-preview" @click="activePreviewCover = null">
                <X :size="20" />
              </button>
            </div>
            <div class="preview-img-container">
              <img :src="activePreviewCover.url" class="large-cover-image" alt="Large Cover" />
            </div>
            <div class="preview-footer">
              <button class="btn-dialog-secondary" @click="copyCoverToClipboard(activePreviewCover)">
                <Copy :size="16" />
                <span>复制到剪贴板</span>
              </button>
              <button class="btn-dialog-primary" @click="downloadCover(activePreviewCover)">
                <Download :size="16" />
                <span>下载该高清封面</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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

/* Custom Hands-on Timeline Slider styling */
.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.timeline-track-wrapper {
  position: relative;
  height: 18px;
  width: 100%;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  user-select: none;
}

.timeline-total-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.timeline-trim-range {
  position: absolute;
  top: 0;
  height: 100%;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.22), rgba(139, 92, 246, 0.22));
  border-left: 2px solid var(--accent-color);
  border-right: 2px solid #818cf8;
  box-shadow: inset 0 0 12px rgba(99, 102, 241, 0.2);
}

/* Handles on two ends of the trim range */
.timeline-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 28px;
  border-radius: 4px;
  cursor: ew-resize;
  z-index: 10;
  transition: box-shadow 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.start-handle {
  left: -6px;
  background-color: var(--accent-color);
  border: 1px solid #818cf8;
}

.end-handle {
  right: -6px;
  background-color: #818cf8;
  border: 1px solid #a5b4fc;
}

.timeline-handle:hover {
  background-color: #a5b4fc;
  box-shadow: 0 0 15px var(--accent-glow);
}

.handle-bar {
  width: 2px;
  height: 12px;
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: 1px;
}

/* Handle floating value tooltips */
.handle-tooltip, .playhead-tooltip {
  position: absolute;
  bottom: 34px;
  background: rgba(10, 10, 12, 0.9);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-family: monospace;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: scale(0.9) translateX(-50%);
  left: 50%;
  transform-origin: bottom center;
  transition: opacity 0.2s, transform 0.2s;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
}

.timeline-handle:hover .handle-tooltip,
.timeline-playhead-handle:hover .playhead-tooltip {
  opacity: 1;
  transform: scale(1) translateX(-50%);
}

/* Playhead indicators */
.timeline-playhead-handle {
  position: absolute;
  top: -4px;
  width: 14px;
  height: 26px;
  z-index: 11;
  cursor: ew-resize;
  transform: translateX(-50%);
}

.playhead-cap {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff4757;
  border: 2px solid #fff;
  box-shadow: 0 0 8px rgba(255, 71, 87, 0.8);
}

.playhead-line {
  position: absolute;
  top: 12px;
  left: 6px;
  width: 2px;
  height: 14px;
  background: #ff4757;
  box-shadow: 0 0 5px rgba(255, 71, 87, 0.8);
}

.timeline-markers {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 0.8rem;
  opacity: 0.75;
}

.timeline-tip-center {
  font-size: 0.78rem;
  color: var(--text-accent);
  opacity: 0.85;
}

/* Console Panel Styling */
.console-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-md);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
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
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.hotkey-tip {
  font-size: 0.72rem;
  color: var(--text-secondary);
  opacity: 0.55;
}

.time-val {
  font-size: 1.1rem;
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
  height: 36px;
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
  height: 38px;
  padding: 0 12px;
  font-size: 0.82rem;
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
  height: 28px;
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

/* Presets card */
.presets-card {
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-md);
}

.presets-header {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.preset-buttons {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.preset-buttons button {
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  color: var(--text-accent);
  height: 32px;
  font-size: 0.82rem;
  font-weight: 700;
  border-radius: 6px;
  font-family: monospace;
}

.preset-buttons button:hover:not(:disabled) {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

.preset-buttons button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Hotkey Card style */
.hotkeys-card {
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.015);
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(255, 255, 255, 0.08);
}

.hotkeys-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.hotkeys-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.hotkey-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.hotkey-row kbd {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
  font-family: monospace;
  font-size: 0.72rem;
  color: #fff;
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
  gap: 10px;
}

.btn-action-trim {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: #fff;
  height: 46px;
  border-radius: 100px;
  font-weight: 700;
  font-size: 0.96rem;
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
  height: 42px;
  border-radius: 100px;
  font-weight: 600;
  font-size: 0.9rem;
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

.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.gap-2 {
  gap: 8px;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.7; }
}

.animate-pulse {
  animation: pulse 1.8s infinite ease-in-out;
}

/* 预览播放按钮样式 */
.btn-play-preview {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-accent);
  border: 1px solid rgba(99, 102, 241, 0.3);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-play-preview:hover {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
  box-shadow: 0 0 10px var(--accent-glow);
}

.btn-play-preview.end-preview {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.btn-play-preview.end-preview:hover {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
}

/* 视频裁剪上传与处理进度条样式 */
.progress-container {
  width: 100%;
  margin: 10px 0 25px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-bar-wrapper {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  box-shadow: 0 0 10px var(--accent-glow);
  border-radius: 4px;
  transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-percentage-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
}

.progress-status-text {
  color: var(--text-secondary);
}

.progress-num {
  font-family: monospace;
  font-weight: 700;
  color: var(--text-accent);
}

/* 封面截取卡片与缩略图样式 */
.btn-action-capture {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  height: 38px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.88rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-action-capture:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.15);
  border-color: var(--accent-color);
  color: var(--text-accent);
  box-shadow: 0 0 10px var(--accent-glow);
}

.btn-action-capture:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.presets-empty-hint {
  font-size: 0.76rem;
  color: var(--text-secondary);
  opacity: 0.6;
  text-align: center;
  margin: 4px 0;
  line-height: 1.4;
}

.covers-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 5px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}

/* Custom Scrollbar for Covers Grid */
.covers-grid::-webkit-scrollbar {
  width: 4px;
}
.covers-grid::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}

.cover-thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/10;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #000;
  transition: all var(--transition-fast);
}

.cover-thumbnail-wrapper:hover {
  border-color: var(--accent-color);
  transform: scale(1.02);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
}

.cover-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-time-tag {
  position: absolute;
  bottom: 2px;
  left: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 1px 3px;
  border-radius: 2px;
  font-size: 0.62rem;
  font-family: monospace;
  pointer-events: none;
  z-index: 5;
}

.cover-actions-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 6;
  padding: 4px;
}

.cover-thumbnail-wrapper:hover .cover-actions-overlay {
  opacity: 1;
}

.cover-action-btn {
  width: 24px; /* 尺寸从 28px 缩小到 24px，防止宽度溢出 */
  height: 24px;
  border-radius: 50%;
  background: var(--accent-color);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  cursor: pointer;
}

.cover-action-btn:hover {
  transform: scale(1.1);
  background: #4f46e5;
  box-shadow: 0 0 8px var(--accent-glow);
}

.cover-action-btn.delete {
  background: rgba(239, 68, 68, 0.8);
}

.cover-action-btn.delete:hover {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.camera-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-accent);
  border-color: rgba(99, 102, 241, 0.3);
}

/* 封面大图预览弹窗 */
.preview-modal-overlay {
  background: rgba(4, 4, 6, 0.9) !important;
}

.preview-dialog-card {
  width: 1400px;
  max-width: 96vw;
  max-height: 94vh;
  padding: 24px;
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  background: rgba(20, 20, 25, 0.85);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.preview-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
}

.btn-close-preview {
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}

.btn-close-preview:hover {
  color: #fff;
}

.preview-img-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.large-cover-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.preview-footer .btn-dialog-primary,
.preview-footer .btn-dialog-secondary {
  width: auto;
  min-width: 180px;
  padding: 0 24px;
}

/* 弹窗过渡动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.25s ease;
}

.dialog-fade-enter-active .dialog-card,
.dialog-fade-enter-active .preview-dialog-card,
.dialog-fade-leave-active .dialog-card,
.dialog-fade-leave-active .preview-dialog-card {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog-card,
.dialog-fade-enter-from .preview-dialog-card {
  transform: scale(0.92);
  opacity: 0;
}

.dialog-fade-leave-to .dialog-card,
.dialog-fade-leave-to .preview-dialog-card {
  transform: scale(0.95);
  opacity: 0;
}

</style>
