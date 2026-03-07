<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { Loader2, Sparkles, AlertCircle, FileText, Clock, Play, Send, MessageCircle, User as UserIcon, Bot, Map, Search } from 'lucide-vue-next';
import YouTubePlayer from '../components/YouTubePlayer.vue';
import BilibiliPlayer from '../components/BilibiliPlayer.vue';
import MindMapModal from '../components/MindMapModal.vue';
import VideoSearchModal from '../components/VideoSearchModal.vue';
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
const mindmapRaw = ref(''); // 脑图 Markdown
const showMindMap = ref(false); // 是否显示脑图
const showSearchModal = ref(false); // 是否显示搜索弹窗

// AI 助手相关状态
const activeSidebarTab = ref<'transcript' | 'chat'>('transcript');
const chatInput = ref('');
const chatMessages = ref<{ role: 'user' | 'assistant'; content: string }[]>([]);
const isChatLoading = ref(false);
const chatListRef = ref<HTMLElement | null>(null);
const isAutoScrollEnabled = ref(true);

// 字幕滚动自动归中行为控制变量
const isHoveringTranscript = ref(false);
const autoScrollPaused = ref(false);
const isTranslating = ref(false);
let pollingInterval: any = null;
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

// 智能合并字幕：不再是死板的两两合并，而是根据标点、时长、行数判断，保持语义完整性
const mergedTranscript = computed(() => {
  if (transcript.value.length === 0) return [];
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (let i = 0; i < transcript.value.length; i++) {
    const seg = transcript.value[i];

    if (!current) {
      current = { ...seg };
      continue;
    }

    // 判断逻辑：
    // 1. 如果当前累积的文本还没有标点结尾
    // 2. 或者当前累积时长太短（比如小于 3.5 秒）
    // 3. 且合并后的总时长不超过 10 秒
    const lastChar = current.text.trim().slice(-1);
    const hasEndingPunctuation = /[.?!。？！]/.test(lastChar);
    const currentDuration = (current.duration || 0);
    const combinedDuration = (seg.offset + seg.duration) - current.offset;

    // 如果满足合并条件 (没结束 或是 还是太短)，则继续合入下一条
    const shouldMerge = (!hasEndingPunctuation || currentDuration < 3500) && combinedDuration < 10000;

    if (shouldMerge) {
      // 合并原文
      const isChinese = /[\u4e00-\u9fa5]/.test(seg.text);
      const lastTextChar = current.text.trim().slice(-1);
      const hasAnyPunc = /[.,?!，。？！、;；]/.test(lastTextChar);
      let sep = '';
      if (!hasAnyPunc) {
        sep = isChinese ? '，' : ' ';
      } else {
        sep = ' ';
      }
      current.text = current.text.trim() + sep + seg.text.trim();

      // 合并译文 (如果存在)
      if (seg.translatedText) {
        const lastTransChar = (current.translatedText || '').trim().slice(-1);
        const hasTransPunc = /[.,?!，。？！、;；]/.test(lastTransChar);
        let transSep = '';
        if (current.translatedText && !hasTransPunc) {
          transSep = '，';
        }
        current.translatedText = (current.translatedText || '').trim() + transSep + seg.translatedText.trim();
      } else if (current.translatedText) {
         // 如果当前已有译文但下一条没有，保持译文状态（哪怕是部分翻译）
         current.translatedText = current.translatedText;
      }

      current.duration = combinedDuration;
    } else {
      // 达到断句条件，推入结果并开启新包
      merged.push(current);
      current = { ...seg };
    }
  }

  if (current) merged.push(current);
  return merged;
});

// 是否存在双语数据
const hasBilingualData = computed(() => {
  return transcript.value.some(seg => !!seg.translatedText);
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
  // 如果 URL 中有时间戳且播放器已准备好（虽然初始化时通常没好，但还是检查一下）
  if (route.query.t && playerRef.value) {
    const targetTime = parseInt(route.query.t as string);
    playerRef.value?.seekTo(targetTime);
  }
});

import { onUnmounted } from 'vue';
onUnmounted(() => {
  if (pollingInterval) clearInterval(pollingInterval);
});

// 监听 URL 中的参数变化，实现同一视频多次搜索跳转
watch(() => route.query, (newQuery) => {
  if (newQuery.t && playerRef.value) {
    const targetTime = parseInt(newQuery.t as string);
    playerRef.value?.seekTo(targetTime);
  }
}, { deep: true });

// 监听分析成功，如果是从搜索跳过来的，且是第一次加载的情况
window.addEventListener('video-analyzed', () => {
  if (route.query.t && playerRef.value) {
    const targetTime = parseInt(route.query.t as string);
    setTimeout(() => {
      playerRef.value?.seekTo(targetTime);
    }, 1000); // 稍微延迟确保播放器加载完成
  }
});

watch(() => route.query.url, (newUrl) => {
  if (newUrl) {
    videoUrl.value = newUrl as string;
    handleAnalyze();
  }
});

const isAnalyzingSummary = ref(false); // 是否正在分析摘要/脑图
const isIndexing = ref(false); // 是否正在进行向量化索引（用于语义搜索）

// 轮询更新摘要、脑图、翻译和索引
const pollAnalysisStatus = async () => {
  if (!videoId.value || (!isAnalyzingSummary.value && !isIndexing.value && !isTranslating.value)) {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/videos/${videoId.value}`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();

    if (result.success && result.data) {
      // 1. 更新标题
      if (result.data.videoTitle) {
        videoTitle.value = decodeHtml(result.data.videoTitle);
      }

      // 2. 更新摘要
      if (result.data.takeaways && result.data.takeaways.length > 0) {
        takeaways.value = result.data.takeaways.map((ta: any) => ({
          ...ta,
          title: decodeHtml(ta.title),
          summary: decodeHtml(ta.summary)
        }));
      }

      // 只要摘要或脑图有一个出来了，通常表示 AI 解析已完成
      if ((result.data.takeaways && result.data.takeaways.length > 0) || result.data.mindmap) {
        isAnalyzingSummary.value = false;
      }

      // 3. 更新脑图
      if (result.data.mindmap) {
        mindmapRaw.value = result.data.mindmap;
      }

      // 4. 更新索引状态 (只要后端返回 true，就释放前端按钮)
      if (result.data.isIndexed !== undefined) {
         if (result.data.isIndexed) {
           isIndexing.value = false;
         } else {
           isIndexing.value = true;
         }
      }

      // 5. 更新翻译
      if (result.data.transcript && result.data.transcript.length > 0) {
        let hasMissingTrans = false;
        let transCount = 0;
        transcript.value = transcript.value.map((seg, i) => {
          const updated = result.data.transcript[i];
          if (updated && updated.translatedText) {
            transCount++;
            return { ...seg, translatedText: decodeHtml(updated.translatedText) };
          }
          if (updated && !updated.translatedText && !/[\u4e00-\u9fa5]/.test(seg.text)) {
            hasMissingTrans = true;
          }
          return seg;
        });

        // 严格判定：只有当所有需要翻译的片段都完成后，才停止翻译状态
        if (!hasMissingTrans) {
          isTranslating.value = false;
        }
      }

      // 如果全部完成，停止轮询
      if (!isAnalyzingSummary.value && !isIndexing.value && !isTranslating.value) {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
          console.log('✅ Polling stopped: All tasks finished.');
        }
      }
    }
  } catch (e) {
    console.error('Polling analysis status failed:', e);
  }
};


// 调用后端 AI 分析接口
const handleAnalyze = async () => {
  await waitForAuth(); // 等待认证初始化完成
  if (!checkLogin()) return; // 检查登录状态
  if (!videoId.value || !platform.value) return;
  isLoading.value = true;
  showResult.value = false;
  isTranslating.value = false;
  isAnalyzingSummary.value = false;
  isIndexing.value = false;

  if (pollingInterval) clearInterval(pollingInterval);
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
      // 核心原则：即便 AI 摘要还没好，也要先把视频和字幕展示出来
      videoTitle.value = decodeHtml(result.data.videoTitle || '');
      mindmapRaw.value = result.data.mindmap || '';

      const rawTranscript = result.data.transcript || [];
      transcript.value = rawTranscript.map((seg: any) => ({
        ...seg,
        text: decodeHtml(seg.text),
        translatedText: decodeHtml(seg.translatedText)
      }));

      // 处理摘要
      if (result.data.takeaways && result.data.takeaways.length > 0) {
        takeaways.value = result.data.takeaways.map((ta: any) => ({
          ...ta,
          title: decodeHtml(ta.title),
          summary: decodeHtml(ta.summary)
        }));
        isAnalyzingSummary.value = false;
      } else {
        // 如果摘要为空，开启异步分析状态
        takeaways.value = [];
        isAnalyzingSummary.value = true;
      }

      // 索引状态
      if (!result.data.isIndexed) {
         isIndexing.value = true;
      }

      // 检查是否需要开启异步翻译状态
      // 判定逻辑：如果不是纯中文视频，且当前译文尚未全量覆盖，则进入翻译状态
      const isChineseVideo = transcript.value.slice(0, 10).every(s => /[\u4e00-\u9fa5]/.test(s.text));
      const hasMissingTranslation = transcript.value.some(s => !s.translatedText);

      if (!isChineseVideo && hasMissingTranslation) {
        isTranslating.value = true;
        isBilingual.value = true; // 自动开启双语显示
      }


      showResult.value = true;
      window.dispatchEvent(new Event('video-analyzed')); // 刷新历史

      // 开启轮询 (如果任何一个异步状态处于 active)
      if (isAnalyzingSummary.value || isIndexing.value || isTranslating.value) {
        pollingInterval = setInterval(pollAnalysisStatus, 3000);
      }

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


// --- AI 聊天逻辑 ---

const fetchChatHistory = async () => {
  if (!videoId.value) return;
  try {
    const res = await fetch(`${API_BASE}/api/chat/history/${videoId.value}`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (result.success) {
      chatMessages.value = result.data;
      nextTick(scrollToBottom);
    }
  } catch (e) {
    console.error('Failed to fetch chat history:', e);
  }
};

let isChatProgrammaticScroll = false;

const handleChatScroll = () => {
  if (!chatListRef.value || isChatProgrammaticScroll) {
    isChatProgrammaticScroll = false;
    return;
  }

  const { scrollTop, scrollHeight, clientHeight } = chatListRef.value;
  // If user scrolls up even a little bit, disable auto-scroll
  // 5px buffer for sub-pixel issues
  const atBottom = scrollHeight - scrollTop - clientHeight < 5;

  if (!atBottom) {
    isAutoScrollEnabled.value = false;
  } else {
    isAutoScrollEnabled.value = true;
  }
};

const scrollToBottom = (force = false) => {
  if (chatListRef.value && (force || isAutoScrollEnabled.value)) {
    isChatProgrammaticScroll = true;
    if (force) {
      chatListRef.value.scrollTo({
        top: chatListRef.value.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
    }
  }
};

const sendChatMessage = async () => {
  if (!chatInput.value.trim() || isChatLoading.value || !videoId.value) return;

  const userMsg = chatInput.value;
  chatInput.value = '';
  chatMessages.value.push({ role: 'user', content: userMsg });
  chatMessages.value.push({ role: 'assistant', content: '' });
  isChatLoading.value = true;
  isAutoScrollEnabled.value = true; // Reset auto-scroll on new message
  nextTick(() => scrollToBottom(true));

  try {
    const response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        videoId: videoId.value,
        message: userMsg
      })
    });

    if (!response.ok) throw new Error('Chat failed');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            if (data.content) {
              assistantMsg += data.content;
              chatMessages.value[chatMessages.value.length - 1].content = assistantMsg;
              nextTick(scrollToBottom);
            }
          } catch (e) {
            // ignore partial json
          }
        }
      }
    }
  } catch (error) {
    console.error('Chat error:', error);
    chatMessages.value[chatMessages.value.length - 1].content = '抱歉，对话出了一点问题，请重试。';
  } finally {
    isChatLoading.value = false;
  }
};

// 处理时间戳点击跳转
const handleTimestampClick = (ts: string) => {
  const match = ts.match(/\[(\d+):(\d+)\]/);
  if (match) {
    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const target = minutes * 60 + seconds;
    if (playerRef.value) {
      playerRef.value.seekTo(target);
    }
  }
};

// 解析消息内容，提取时间戳 [mm:ss]
const parseMessageContent = (content: string) => {
  if (!content) return [];
  const parts: { type: 'text' | 'timestamp'; value: string }[] = [];
  const regex = /\[(\d{1,2}:\d{2})\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.substring(lastIndex, match.index) });
    }
    parts.push({ type: 'timestamp', value: match[0] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.substring(lastIndex) });
  }

  return parts;
};

// 预热聊天记录
watch(showResult, (val) => {
  if (val) {
    isAutoScrollEnabled.value = true;
    fetchChatHistory();
  }
});

// 点击要点条目跳转到对应时间（timestamp 是秒）
const jumpToTakeaway = (item: Takeaway, index: number) => {
  activeTakeawayIndex.value = index;
  if (playerRef.value) {
    playerRef.value.seekTo(item.timestamp);
    // 点击摘要时自动置顶，方便观看视频
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 兼容某些布局下的 main-wrapper 滚动
    document.querySelector('.main-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// 字幕跳转
const jumpToTranscript = (seg: TranscriptSegment, index: number) => {
  activeTranscriptIndex.value = index;
  handleSeek(seg.offset);
};

// 通用跳转逻辑
const handleSeek = (offsetMs: number) => {
  if (playerRef.value) {
    playerRef.value.seekTo(offsetMs / 1000);
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
            <div v-if="showResult && (takeaways.length > 0 || isAnalyzingSummary)" class="takeaways-section glass-panel animate-slide-in">
              <div class="sidebar-header">
                <div class="sidebar-title-area">
                   <h3><Sparkles class="icon accent" :size="20"/> 核心摘要</h3>
                   <p v-if="videoTitle" class="video-title-hint">{{ videoTitle }}</p>
                 </div>
                  <div class="sidebar-actions">
                    <button
                      class="btn-mindmap"
                      :disabled="!mindmapRaw"
                      @click="showMindMap = true"
                    >
                      <Loader2 v-if="!mindmapRaw && isAnalyzingSummary" :size="14" class="spin" />
                      <Map v-else :size="14" />
                      <span>查看脑图</span>
                    </button>
                    <button
                      v-if="showResult"
                      class="btn-search-in-video"
                      :disabled="isIndexing"
                      @click="showSearchModal = true"
                      title="语义搜索视频内容"
                    >
                      <Loader2 v-if="isIndexing" :size="14" class="spin" />
                      <Search v-else :size="14" />
                      <span>语义搜索</span>
                    </button>
                    <span v-if="takeaways.length > 0" class="badge animate-fade-in">{{ takeaways.length }} 条精选</span>
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

              <!-- Summary Loading State -->
              <div v-if="isAnalyzingSummary && takeaways.length === 0" class="takeaway-loading-placeholder animate-fade-in">
                <div class="loading-icon-pulse">
                  <Sparkles :size="32" class="spin" />
                </div>
                <div class="loading-text">
                  <h4>AI 正在提取核心摘要...</h4>
                  <p>我们正在深度分析视频文本并为您生成关键跳转点，请稍候。</p>
                </div>
              </div>

              <div v-else class="takeaways-list">
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


          <!-- Right Sidebar: Transcript & Chat -->
          <div v-if="showResult" class="outline-sidebar glass-panel animate-slide-in">
            <!-- Sidebar Tabs -->
            <div class="sidebar-tabs">
              <button
                class="sidebar-tab"
                :class="{ active: activeSidebarTab === 'transcript' }"
                @click="activeSidebarTab = 'transcript'"
              >
                <FileText :size="16" />
                <span>转录</span>
              </button>
              <button
                class="sidebar-tab"
                :class="{ active: activeSidebarTab === 'chat' }"
                @click="activeSidebarTab = 'chat'"
              >
                <MessageCircle :size="16" />
                <span>AI 助手</span>
                <span v-if="activeSidebarTab !== 'chat' && chatMessages.length > 0" class="tab-dot"></span>
              </button>
            </div>

            <!-- Tab Content: Transcript -->
            <div v-if="activeSidebarTab === 'transcript'" class="tab-pane">
              <div class="sidebar-header">
                <div class="sidebar-title-area">
                   <h3>视频转录</h3>
                 </div>
                  <div class="sidebar-actions">
                    <div v-if="isTranslating" class="translating-hint">
                      <Loader2 :size="12" class="spin" />
                      <span>正在翻译中文...</span>
                    </div>
                    <button
                      v-if="hasBilingualData"
                      class="toggle-bilingual-btn"
                      :class="{ active: isBilingual }"
                      @click="isBilingual = !isBilingual"
                      title="切换中英双语"
                    >
                      {{ isBilingual ? '双语' : '单语' }}
                    </button>
                    <span class="badge">{{ mergedTranscript.length }} 条记录</span>
                  </div>
               </div>

            <div
              class="transcript-list"
              @scroll="handleTranscriptScroll"
              @mouseenter="handleTranscriptMouseEnter"
              @mouseleave="handleTranscriptMouseLeave"
              ref="transcriptListRef"
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

            <!-- Tab Content: AI Chat -->
            <div v-else class="tab-pane chat-pane">
              <div ref="chatListRef" class="chat-messages" @scroll="handleChatScroll">
                <div v-if="chatMessages.length === 0" class="chat-empty">
                  <div class="empty-icon-wrapper">
                    <Bot :size="40" class="accent-glow-text" />
                  </div>
                  <h4>我是你的 AI 视频助手</h4>
                  <p>你可以问我关于视频内容的任何问题</p>
                  <div class="quick-prompts">
                    <button class="quick-prompt-btn" @click="chatInput = '总结一下这个视频的核心要点'; sendChatMessage()">总结核心要点</button>
                    <button class="quick-prompt-btn" @click="chatInput = '视频中提到了哪些具体的建议？'; sendChatMessage()">有哪些建议？</button>
                  </div>
                </div>

                <div
                  v-for="(msg, idx) in chatMessages"
                  :key="idx"
                  class="chat-message-wrapper"
                  :class="msg.role"
                >
                  <div class="message-avatar">
                    <Bot v-if="msg.role === 'assistant'" :size="16" />
                    <UserIcon v-else :size="16" />
                  </div>
                  <div class="message-bubble">
                    <div v-if="msg.content" class="message-content">
                      <template v-for="(part, pIdx) in parseMessageContent(msg.content)">
                        <span v-if="part.type === 'text'" :key="'text-' + idx + '-' + pIdx">{{ part.value }}</span>
                        <a
                          v-else-if="part.type === 'timestamp'"
                          :key="'ts-' + idx + '-' + pIdx"
                          href="javascript:void(0)"
                          class="timestamp-link"
                          @click="handleTimestampClick(part.value)"
                        >
                          {{ part.value }}
                        </a>
                      </template>
                    </div>
                    <div v-else-if="isChatLoading && idx === chatMessages.length - 1" class="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Chat Input -->
              <div class="chat-input-wrapper">
                <div class="input-container">
                  <textarea
                    v-model="chatInput"
                    placeholder="问点什么..."
                    @keydown.enter.prevent="sendChatMessage"
                    :disabled="isChatLoading"
                  ></textarea>
                  <button
                    class="send-btn"
                    :disabled="!chatInput.trim() || isChatLoading"
                    @click="sendChatMessage"
                  >
                    <Send :size="18" />
                  </button>
            </div>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <!-- Mind Map Modal -->
        <MindMapModal
          :show="showMindMap"
          :markdown="mindmapRaw"
          :title="videoTitle"
          @close="showMindMap = false"
        />

        <VideoSearchModal
          :show="showSearchModal"
          :video-id="videoId"
          :video-title="videoTitle"
          @close="showSearchModal = false"
          @seek="handleSeek"
        />
      </Teleport>
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

.btn-mindmap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-color);
  padding: 6px 12px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
  border: 1px solid rgba(99, 102, 241, 0.2);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.btn-mindmap:hover {
  background: var(--accent-color);
  color: white;
  /* transform: translateY(-1px); */
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


/* Sidebar Tabs */
.sidebar-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
  position: relative;
}

.sidebar-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.sidebar-tab.active {
  background: rgba(0, 163, 255, 0.1);
  color: var(--accent-color);
}

.tab-dot {
  position: absolute;
  top: 8px;
  right: 12px;
  width: 6px;
  height: 6px;
  background: var(--accent-color);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--accent-shadow);
}

.tab-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Chat Pane */
.chat-pane {
  display: flex;
  flex-direction: column;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Removed scroll-behavior: smooth to prevent jitter during streaming */
  overflow-anchor: auto;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
}

.empty-icon-wrapper {
  margin-bottom: 16px;
  padding: 20px;
  background: rgba(0, 163, 255, 0.05);
  border-radius: 50%;
}

.chat-empty h4 {
  color: var(--text-primary);
  margin-bottom: 8px;
  font-size: 1.1rem;
}

.chat-empty p {
  font-size: 0.9rem;
  margin-bottom: 24px;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.quick-prompt-btn {
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.quick-prompt-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent-color);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.chat-message-wrapper {
  display: flex;
  gap: 12px;
  max-width: 90%;
}

.chat-message-wrapper.user {
  flex-direction: row-reverse;
  align-self: flex-end;
}

.chat-message-wrapper.assistant {
  align-self: flex-start;
}

.message-avatar {
  width: 30px;
  height: 30px;
  min-width: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.user .message-avatar {
  background: var(--accent-color);
  color: white;
}

.assistant .message-avatar {
  background: rgba(0, 163, 255, 0.1);
  color: var(--accent-color);
  border-color: rgba(0, 163, 255, 0.2);
}

.message-bubble {
  padding: 12px 14px;
  border-radius: 16px;
  font-size: 0.95rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.user .message-bubble {
  background: var(--accent-color);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 12px var(--accent-shadow);
}

.assistant .message-bubble {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

.timestamp-link {
  color: var(--accent-color);
  text-decoration: none;
  font-weight: 600;
  padding: 0 2px;
  border-bottom: 1.5px dashed var(--accent-color);
  cursor: pointer;
}

.timestamp-link:hover {
  background: rgba(0, 163, 255, 0.1);
}

/* Typing Indicator */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) { animation-delay: 0s; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Chat Input */
.chat-input-wrapper {
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.input-container {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 8px 12px;
  transition: all 0.2s ease;
}

.input-container:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 15px rgba(0, 163, 255, 0.1);
}

.input-container textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.95rem;
  padding: 6px 0;
  resize: none;
  max-height: 120px;
  min-height: 24px;
  line-height: 1.5;
}

.input-container textarea:focus {
  outline: none;
}

.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--accent-color);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  background: #0088cc;
}

.send-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

/* Updated Sidebar Header for Tabs */
.outline-sidebar {
  padding: 0 !important;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
  position: sticky;
  top: 100px;
}

.accent { color: var(--accent-color); }
.accent-light { color: var(--text-accent); }

.sidebar-header {
  padding: 18px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.sidebar-title-area {
  display: flex;
  flex-direction: column;
}

.sidebar-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}


.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.translating-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--accent-color);
  opacity: 0.8;
  padding-right: 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

/* Premium Badge Style */
.badge {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.badge:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
}

.btn-search-in-video {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  color: var(--accent-color);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-search-in-video:hover {
  background: var(--accent-color);
  color: white;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

/* Bilingual Toggle Button */
.toggle-bilingual-btn {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle-bilingual-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
}

.toggle-bilingual-btn.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-light);
  box-shadow: 0 4px 12px var(--accent-shadow);
}

.transcript-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px 16px;
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
  max-width: 440px;
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


.btn-search-in-video:disabled, .btn-mindmap:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(0.6);
}

.takeaway-loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 20px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  margin: 20px 0;
  text-align: center;
}

.loading-icon-pulse {
  background: rgba(99, 102, 241, 0.1);
  padding: 20px;
  border-radius: 50%;
  color: var(--accent-color);
  animation: pulse-glow 2s infinite ease-in-out;
}

.loading-text h4 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: #fff;
}

.loading-text p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  max-width: 400px;
}

@keyframes pulse-glow {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  70% { box-shadow: 0 0 0 15px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}
</style>

