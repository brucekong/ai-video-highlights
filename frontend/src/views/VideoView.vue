<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Loader2, Sparkles, AlertCircle, FileText, Clock, Play } from 'lucide-vue-next';
import YouTubePlayer from '../components/YouTubePlayer.vue';
import BilibiliPlayer from '../components/BilibiliPlayer.vue';
import { useAuth } from '../services/auth';

const API_BASE = import.meta.env.VITE_API_URL;
const { checkLogin, waitForAuth, getAuthHeaders } = useAuth();

console.log('API_BASE====', API_BASE)
interface Takeaway {
  id: string;
  title: string;
  summary: string;
  timestamp: number;  // 秒（AI 返回的单位）
  duration: string;   // 如 "2:30"
}


interface TranscriptSegment {
  text: string;
  translatedText?: string;
  offset: number;   // 毫秒
  duration: number;  // 毫秒
}


const route = useRoute();
const videoUrl = ref('');
const isLoading = ref(false);
const showResult = ref(false);
const takeaways = ref<Takeaway[]>([]);
const transcript = ref<TranscriptSegment[]>([]);

const videoTitle = ref('');
const activeTakeawayIndex = ref<number | null>(null);
const activeTranscriptIndex = ref<number | null>(null);
const currentVideoTime = ref(0);
const videoDuration = ref(0); // 从播放器获取的真实时长
const isBilingual = ref(true); // 是否开启双语模式

// 字幕滚动自动归中行为控制变量
const isHoveringTranscript = ref(false);
const autoScrollPaused = ref(false);
let resumeScrollTimeout: any = null;
let programmaticScrollTimeout: any = null;
let isProgrammaticScroll = false;

const startResumeTimeout = (duration: number) => {
  if (resumeScrollTimeout) clearTimeout(resumeScrollTimeout);
  resumeScrollTimeout = setTimeout(() => {
    autoScrollPaused.value = false;
  }, duration);
};

const handleTranscriptScroll = () => {
  if (isProgrammaticScroll) return; // ignore code-triggered scroll
  autoScrollPaused.value = true;
  if (isHoveringTranscript.value) {
    startResumeTimeout(10000); // Wait 10s if hovering
  } else {
    startResumeTimeout(3000); // Wait 3s if not hovering
  }
};

const handleTranscriptMouseEnter = () => {
  isHoveringTranscript.value = true;
  if (autoScrollPaused.value) {
    startResumeTimeout(10000);
  }
};

const handleTranscriptMouseLeave = () => {
  isHoveringTranscript.value = false;
  if (autoScrollPaused.value) {
    startResumeTimeout(3000);
  }
};

// 合并过密的字幕（两两合并），减少前端列表频繁跳动
const mergedTranscript = computed(() => {
  if (transcript.value.length === 0) return [];
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (let i = 0; i < transcript.value.length; i++) {
    const seg = transcript.value[i];
    if (i % 2 === 0) {
      if (current) merged.push(current);
      current = { ...seg };
    } else if (current) {
      // 1. 合并原文
      const lastChar = current.text.trim().slice(-1);
      const hasPunctuation = /[.,?!，。？！、;；]/.test(lastChar);
      const isChinese = /[\u4e00-\u9fa5]/.test(seg.text);
      let sep = '';
      if (!hasPunctuation) {
        sep = isChinese ? '，' : ', ';
      } else {
        sep = isChinese ? '' : ' ';
      }
      current.text = current.text.trim() + sep + seg.text.trim();

      // 2. 合并译文
      if (seg.translatedText) {
        const lastTransChar = (current.translatedText || '').trim().slice(-1);
        const hasTransPunctuation = /[.,?!，。？！、;；]/.test(lastTransChar);
        let transSep = '';
        if (current.translatedText && !hasTransPunctuation) {
          transSep = '，';
        }
        current.translatedText = (current.translatedText || '').trim() + transSep + seg.translatedText.trim();
      }

      current.duration = (seg.offset + seg.duration) - current.offset;
    }
  }
  if (current) merged.push(current);
  return merged;
});


const errorMsg = ref('');

const playerRef = ref<any>(null);

// 检测视频平台
const platform = computed<'youtube' | 'bilibili' | ''>(() => {
  const url = videoUrl.value;
  if (!url) return '';
  if (/bilibili\.com\/video\/BV/.test(url) || /b23\.tv/.test(url)) return 'bilibili';
  if (/youtu\.?be/.test(url) || /youtube\.com/.test(url)) return 'youtube';
  return '';
});

// 提取 YouTube Video ID
const youtubeVideoId = computed(() => {
  if (platform.value !== 'youtube') return '';
  const match = videoUrl.value.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([^&?]+)/);
  return match ? match[1] : '';
});

// 提取 Bilibili BV 号
const bilibiliBvid = computed(() => {
  if (platform.value !== 'bilibili') return '';
  const match = videoUrl.value.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : '';
});

// 统一的 videoId（用于发给后端）
const videoId = computed(() => {
  if (platform.value === 'youtube') return youtubeVideoId.value;
  if (platform.value === 'bilibili') return bilibiliBvid.value;
  return '';
});

// 是否有有效的视频链接
const hasValidUrl = computed(() => !!videoId.value);

// 解码 HTML 实体（如 &#39; -> '）
const decodeHtml = (html: string | null) => {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};

// 格式化秒数为 mm:ss（用于 takeaway 的 timestamp）
const formatTimeFromSeconds = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// 格式化毫秒为 mm:ss（用于字幕的 offset）
const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// 获取历史记录






onMounted(() => {
  if (route.query.url) {
    videoUrl.value = route.query.url as string;
    handleAnalyze();
  }
});

watch(() => route.query.url, (newUrl) => {
  if (newUrl) {
    videoUrl.value = newUrl as string;
    handleAnalyze();
  }
});

// 调用后端 AI 分析接口
const handleAnalyze = async () => {
  await waitForAuth(); // 等待认证初始化完成
  if (!checkLogin()) return; // 检查登录状态
  if (!videoId.value || !platform.value) return;
  isLoading.value = true;
  showResult.value = false;
  errorMsg.value = '';
  // 重置视频状态防止上一个视频的进度导致当前页面错乱闪烁
  activeTakeawayIndex.value = null;
  activeTranscriptIndex.value = null;
  currentVideoTime.value = 0;

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        videoId: videoId.value,
        url: videoUrl.value,
        platform: platform.value,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      takeaways.value = (result.data.takeaways || []).map((ta: any) => ({
        ...ta,
        title: decodeHtml(ta.title),
        summary: decodeHtml(ta.summary)
      }));
      transcript.value = (result.data.transcript || []).map((seg: any) => ({
        ...seg,
        text: decodeHtml(seg.text),
        translatedText: decodeHtml(seg.translatedText)
      }));
      videoTitle.value = decodeHtml(result.data.videoTitle || '');
      showResult.value = true;
      window.dispatchEvent(new Event('video-analyzed')); // 刷新历史
    } else {
      throw new Error('Invalid response format');
    }
  } catch (error: any) {
    console.error('AI analysis failed:', error);
    errorMsg.value = error.message || 'AI analysis failed.';
  } finally {
    isLoading.value = false;
  }
};

// 点击要点条目跳转到对应时间（timestamp 是秒）
const jumpToTakeaway = (item: Takeaway, index: number) => {
  activeTakeawayIndex.value = index;
  if (playerRef.value) {
    playerRef.value.seekTo(item.timestamp);
  }
};

// 点击字幕条目跳转到对应时间（offset 是毫秒）
const jumpToTranscript = (seg: TranscriptSegment, index: number) => {
  activeTranscriptIndex.value = index;
  if (playerRef.value) {
    playerRef.value.seekTo(seg.offset / 1000);
  }
};

// 视频时间更新时，自动高亮当前要点和字幕
const handleDuration = (duration: number) => {
  if (duration > 0) {
    videoDuration.value = duration;
  }
};

const handleTimelineClick = (event: MouseEvent) => {
  const container = event.currentTarget as HTMLElement;
  if (!container || !totalVideoDuration.value) return;

  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percent = Math.max(0, Math.min(1, clickX / rect.width));
  const targetTime = percent * totalVideoDuration.value;

  if (playerRef.value) {
    playerRef.value.seekTo(targetTime);
  }
};

const handleTimeUpdate = (time: number) => {
  currentVideoTime.value = time;

  // 高亮 takeaway（timestamp 是秒）
    for (let i = takeaways.value.length - 1; i >= 0; i--) {
      if (time >= takeaways.value[i].timestamp - 0.5) {
        if (activeTakeawayIndex.value !== i) {
          activeTakeawayIndex.value = i;
        }
        break;
      }
    }

  // 高亮字幕（offset 是毫秒）
  const timeMs = time * 1000;
  for (let i = mergedTranscript.value.length - 1; i >= 0; i--) {
    if (timeMs >= mergedTranscript.value[i].offset - 500) {
      if (activeTranscriptIndex.value !== i) {
        activeTranscriptIndex.value = i;

        // 仅在未手动暂停滚动时，触发平滑滚动归中显示
        if (!autoScrollPaused.value) {
          const el = document.getElementById(`seg-${i}`);
          if (el) {
            const container = document.querySelector('.transcript-list');
            if (container) {
              isProgrammaticScroll = true;
              if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
              // 设置标记覆盖平滑滚动（行为大约持续 500-800ms）的时间
              programmaticScrollTimeout = setTimeout(() => {
                isProgrammaticScroll = false;
              }, 800);

              // Scroll right list only, keeping the element centered vertically
              const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
              container.scrollTo({ top: targetTop, behavior: 'smooth' });
            } else {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }
      break;
    }
  }
};

const takeawayColors = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316'  // orange-500
];

const totalVideoDuration = computed(() => {
  // 优先使用播放器上报的真实时长
  if (videoDuration.value > 0) {
    return videoDuration.value;
  }

  if (transcript.value.length > 0) {
    const lastSeg = transcript.value[transcript.value.length - 1];
    return (lastSeg.offset + lastSeg.duration) / 1000;
  }
  if (takeaways.value.length > 0) {
    return takeaways.value[takeaways.value.length - 1].timestamp + 120; // default buffer
  }
  return 100;
});

const takeawayMap = computed(() => {
  if (takeaways.value.length === 0) return [];
  const total = totalVideoDuration.value;

  return takeaways.value.map((ta, index) => {
    const start = ta.timestamp;

    // Default max distance to next takeaway or end of video
    const maxDistance = index < takeaways.value.length - 1
      ? takeaways.value[index + 1].timestamp - start
      : total - start;

    // Attempt to parse duration string (e.g. "2:30", "1:15") into seconds
    let pillDuration = 0;
    if (ta.duration) {
      const parts = ta.duration.split(':');
      if (parts.length === 2) {
        pillDuration = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
      } else if (parts.length === 3) {
        pillDuration = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);
      } else {
        pillDuration = parseInt(ta.duration) || 0;
      }
    }

    // Fallback if AI didn't provide valid duration or it's unreasonably large
    if (pillDuration <= 0 || pillDuration > total) {
      pillDuration = Math.max(10, maxDistance * 0.6); // default chunk
    }

    // Cap the pill width so it doesn't overlap the next span entirely
    const actualDuration = Math.min(pillDuration, Math.max(maxDistance * 0.9, 5));

    // Calculate percentages
    const leftPercent = Math.max(0, Math.min(100, (start / total) * 100));
    let widthPercent = Math.max(2, Math.min(100 - leftPercent, (actualDuration / total) * 100));

    const color = takeawayColors[index % takeawayColors.length];

    return {
      ...ta,
      index,
      color,
      leftPercent,
      widthPercent
    };
  });
});

// 点击历史记录



</script>

<template>
<div class="container animate-fade-in">

        <!-- Empty State -->
        <div v-if="!hasValidUrl && !showResult && !errorMsg" class="empty-state glass-panel">
           <div class="empty-icon-wrap">
              <Sparkles :size="64" class="empty-icon" />
           </div>
           <h2>AI Video Highlights</h2>
           <p>在上方粘贴 YouTube 或 Bilibili 链接并点击“AI 分析转换”。我们的 AI 将提取核心摘要，方便您精准跳转到精彩片段。</p>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading && !showResult" class="empty-state glass-panel">
           <div class="empty-icon-wrap">
              <Loader2 :size="48" class="empty-icon spin" />
           </div>
           <h2>AI 正在分析中...</h2>
           <p>正在获取字幕并使用 AI 进行深度分析。根据视频长度，这可能需要 10-30 秒，请稍候。</p>
        </div>

        <!-- Error State -->
        <div v-if="errorMsg && !showResult && !isLoading" class="empty-state glass-panel error-state">
           <div class="empty-icon-wrap error-icon-wrap">
              <AlertCircle :size="48" class="empty-icon error-icon" />
           </div>
           <h2>分析失败</h2>
           <p>{{ errorMsg }}</p>
           <button class="btn-primary" style="margin-top: 20px;" @click="handleAnalyze">
             <Sparkles :size="18" class="icon" />
             <span>重试</span>
           </button>
        </div>

        <!-- Video & Result Area -->
        <div v-if="hasValidUrl || showResult" v-show="!isLoading || showResult" class="content-grid" :class="{ 'has-sidebar': showResult }">

          <!-- Left: Video Player + Takeaways -->
          <div class="left-column">
            <div class="video-section glass-panel">
              <YouTubePlayer
                v-if="platform === 'youtube' && youtubeVideoId"
                ref="playerRef"
                :key="'yt-' + youtubeVideoId"
                :video-id="youtubeVideoId"
                @timeupdate="handleTimeUpdate"
                @duration="handleDuration"
              />
              <BilibiliPlayer
                v-else-if="platform === 'bilibili' && bilibiliBvid"
                ref="playerRef"
                :key="'bili-' + bilibiliBvid"
                :bvid="bilibiliBvid"
                @timeupdate="handleTimeUpdate"
                @duration="handleDuration"
              />
            </div>

            <!-- AI Takeaways (below video) -->
            <div v-if="showResult && takeaways.length > 0" class="takeaways-section glass-panel animate-slide-in">
              <div class="sidebar-header">
                <div class="sidebar-title-area">
                   <h3><Sparkles class="icon accent" :size="20"/> 核心摘要</h3>
                   <p v-if="videoTitle" class="video-title-hint">{{ videoTitle }}</p>
                 </div>
                 <div class="sidebar-actions">
                   <span class="badge">{{ takeaways.length }} 个精彩片段</span>
                 </div>
               </div>

              <div class="takeaways-timeline-container">
                <div class="takeaways-timeline" @click="handleTimelineClick">
                  <div
                    v-for="item in takeawayMap"
                    :key="'map-' + item.index"
                    class="timeline-segment"
                    :style="{ left: item.leftPercent + '%', width: item.widthPercent + '%', backgroundColor: item.color }"
                    :class="{ active: activeTakeawayIndex === item.index }"
                    @click.stop="jumpToTakeaway(item, item.index)"
                  >
                    <div class="timeline-tooltip">{{ item.title }}</div>
                  </div>
                  <!-- Progress Indicator -->
                  <div class="timeline-progress" :style="{ left: Math.min(100, (currentVideoTime / totalVideoDuration) * 100) + '%' }"></div>
                </div>
              </div>

              <div class="takeaways-list">
                <div
                  v-for="item in takeawayMap"
                  :key="item.id || item.index"
                  :id="`takeaway-${item.index}`"
                  class="transcript-item takeaway-item"
                  :class="{ 'active': activeTakeawayIndex === item.index }"
                  :style="activeTakeawayIndex === item.index ? { borderLeftColor: item.color, backgroundColor: item.color + '0a' } : {}"
                  @click="jumpToTakeaway(item, item.index)"
                >
                  <div class="seg-time" :style="{ color: item.color, backgroundColor: item.color + '1a' }">
                    <Clock :size="12" class="seg-time-icon" />
                    <span>{{ formatTimeFromSeconds(item.timestamp) }}</span>
                  </div>
                  <div class="takeaway-content">
                    <div class="takeaway-title">{{ item.title }}</div>
                    <div class="takeaway-summary">{{ item.summary }}</div>
                  </div>
                  <div class="seg-play-icon">
                    <Play :size="14" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Transcript Sidebar -->
          <div v-if="showResult && mergedTranscript.length > 0" class="outline-sidebar glass-panel animate-slide-in">
            <div class="sidebar-header">
              <div class="sidebar-title-area">
                 <h3><FileText class="icon accent" :size="20"/> 视频转录</h3>
               </div>
                <div class="sidebar-actions">
                  <button
                    class="toggle-bilingual-btn"
                    :class="{ active: isBilingual }"
                    @click="isBilingual = !isBilingual"
                    title="切换中英双语"
                  >
                    {{ isBilingual ? '双语' : '单语' }}
                  </button>
                  <span class="badge">{{ mergedTranscript.length }} 段内容</span>
                </div>
             </div>

            <div
              class="transcript-list"
              @scroll="handleTranscriptScroll"
              @mouseenter="handleTranscriptMouseEnter"
              @mouseleave="handleTranscriptMouseLeave"
            >
              <div
                v-for="(seg, index) in mergedTranscript"
                :key="index"
                :id="`seg-${index}`"
                class="transcript-item"
                :class="{ 'active': activeTranscriptIndex === index }"
                @click="jumpToTranscript(seg, index)"
              >
                <div class="seg-time">
                  <Clock :size="12" class="seg-time-icon" />
                  <span>{{ formatTimeFromMs(seg.offset) }}</span>
                </div>
                <div class="seg-text">
                  <div v-if="isBilingual && seg.translatedText" class="translated-text">{{ seg.translatedText }}</div>
                  <div class="original-text" :class="{ 'has-translation': isBilingual && seg.translatedText }">{{ seg.text }}</div>
                </div>
                <div class="seg-play-icon">
                  <Play :size="14" />
                </div>
              </div>
            </div>
          </div>

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
  margin-bottom: auto; /* push meta bottom */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  min-height: 2.8em;
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
  /* position: sticky;
  top: 100px;
  z-index: 10; */
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
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.toggle-bilingual-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 12px;
  border-radius: 100px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.toggle-bilingual-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.toggle-bilingual-btn.active {
  background: var(--accent-glow);
  border-color: var(--accent-color);
  color: var(--text-accent);
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
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.translated-text {
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-word;
}

.original-text {
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--text-secondary);
  word-break: break-word;
}

.original-text.has-translation {
  opacity: 0.7;
  font-size: 0.8rem;
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
  top: -8px;
  bottom: -8px;
  width: 2px;
  background: linear-gradient(to bottom,
    transparent,
    var(--accent-color) 20%,
    var(--accent-color) 80%,
    transparent
  );
  z-index: 10;
  pointer-events: none;
  transition: left 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.5); /* Glowing needle body */
}

.timeline-progress::before {
  content: '';
  position: absolute;
  top: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  background-color: var(--accent-color);
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 12px var(--accent-color), 0 2px 4px rgba(0,0,0,0.5);
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
