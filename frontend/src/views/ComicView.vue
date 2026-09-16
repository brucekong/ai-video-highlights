<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BookOpen, ArrowLeft, Download, RefreshCw, Copy, Plus, Trash2,
  ChevronLeft, ChevronRight, Check,
  Film, Smartphone, Upload, AlertCircle, Loader2, ZoomIn, X,
  Video, Sparkles, Archive
} from 'lucide-vue-next';
import JSZip from 'jszip';

interface ComicScene {
  id: string;
  index: number;
  time: number;
  start: number;
  end: number;
  text: string;
  translatedText: string;
  customImageSrc?: string;
  cacheBuster: number;
  isNudging?: boolean;
}

interface VideoTakeaway {
  id: string;
  title: string;
  storyTitle?: string;
  timestamp: number;
  duration: string;
}

interface AvailableVideo {
  videoId: string;
  title: string;
  duration?: number;
  takeaways: VideoTakeaway[];
}

const route = useRoute();
const router = useRouter();
const API_BASE = import.meta.env.VITE_API_URL || '';

// 路由与查询参数
const videoId = ref<string>((route.query.videoId as string) || '');
const startQuery = ref<number>(parseFloat(String(route.query.start || '0')));
const endQuery = ref<number>(parseFloat(String(route.query.end || '0')));
const initialTitle = ref<string>((route.query.title as string) || '');

// 数据状态
const clipTitle = ref(initialTitle.value || '连环画分镜故事');
const storyTitle = ref(initialTitle.value || '');
const scenes = ref<ComicScene[]>([]);
const isLoading = ref(false);
const isDetectingLocal = ref(false);
const errorMessage = ref('');
const isExporting = ref(false);
const isExportingZip = ref(false);
const zipProgress = ref({ current: 0, total: 0 });
const copySuccessNotice = ref(false);
const isAutoDetected = ref(false);

// 系统已有视频列表选择
const availableVideos = ref<AvailableVideo[]>([]);
const selectedVideoId = ref<string>(videoId.value);
const selectedTakeawayIndex = ref<number | ''>(route.query.takeawayIndex !== undefined ? Number(route.query.takeawayIndex) : '');

// 显示与排版风格
// xiaohongshu: 3:4 竖屏卡片杂志风; cinema: 经典 16:9 电影胶片风
const cardStyle = ref<'xiaohongshu' | 'cinema'>('xiaohongshu');
const showCardText = ref(false); // 默认不显示下方文字配字（纯净连环画画面模式）

// 本地视频模式
const localVideoFile = ref<File | null>(null);

// 模态预览大图
const previewScene = ref<ComicScene | null>(null);

// 格式化时间 00:00.0
const formatTimeLabel = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
};

// 获取分镜图片链接
const getSceneImageUrl = (scene: ComicScene) => {
  if (scene.customImageSrc) {
    return scene.customImageSrc;
  }
  if (videoId.value) {
    return `${API_BASE}/api/videos/${videoId.value}/comic/frame?time=${scene.time}&_t=${scene.cacheBuster}`;
  }
  return '';
};

// 获取系统中已有的分析视频列表
const fetchAvailableVideos = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/comic/videos`);
    if (res.ok) {
      const data = await res.json();
      availableVideos.value = data || [];
      // 如果当前没有 videoId，但系统有视频，默认选中第一个
      if (!videoId.value && availableVideos.value.length > 0) {
        const first = availableVideos.value[0];
        selectedVideoId.value = first.videoId;
        videoId.value = first.videoId;
        if (first.takeaways && first.takeaways.length > 0) {
          selectedTakeawayIndex.value = 0;
        }
        loadComicData();
      }
    }
  } catch (err) {
    console.error('Fetch comic videos failed:', err);
  }
};

// 切换选择的视频
const onVideoSelectChange = () => {
  if (!selectedVideoId.value) return;
  videoId.value = selectedVideoId.value;
  selectedTakeawayIndex.value = '';
  startQuery.value = 0;
  endQuery.value = 0;
  const found = availableVideos.value.find((v) => v.videoId === videoId.value);
  if (found && found.takeaways && found.takeaways.length > 0) {
    selectedTakeawayIndex.value = 0;
  }
  loadComicData();
};

// 切换选择的故事切片
const onTakeawaySelectChange = () => {
  loadComicData();
};

// 加载已有分析视频的连环画分镜数据 (自动对齐原片硬字幕关键帧)
const loadComicData = async () => {
  if (!videoId.value) return;

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const params = new URLSearchParams();
    if (selectedTakeawayIndex.value !== '') {
      params.append('takeawayIndex', String(selectedTakeawayIndex.value));
    } else {
      if (!isNaN(startQuery.value) && startQuery.value > 0) {
        params.append('start', startQuery.value.toString());
      }
      if (!isNaN(endQuery.value) && endQuery.value > startQuery.value) {
        params.append('end', endQuery.value.toString());
      }
    }

    const res = await fetch(`${API_BASE}/api/videos/${videoId.value}/comic/data?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || '获取分镜数据失败');
    }

    const data = await res.json();
    isAutoDetected.value = !!data.autoDetected;
    if (data.storyTitle) {
      storyTitle.value = data.storyTitle;
      clipTitle.value = data.storyTitle;
    } else if (data.title) {
      clipTitle.value = data.title;
    }

    scenes.value = (data.scenes || []).map((s: any, idx: number) => ({
      id: s.id || `scene_${idx + 1}`,
      index: idx + 1,
      time: s.time,
      start: s.start,
      end: s.end,
      text: s.text || '',
      translatedText: s.text || '',
      cacheBuster: Date.now(),
    }));

    if (scenes.value.length === 0) {
      errorMessage.value = '该片段未检测到有效分镜台词或镜头，请尝试选择其他故事切片。';
    }
  } catch (err: any) {
    errorMessage.value = err.message || '加载连环画数据失败，请重试';
  } finally {
    isLoading.value = false;
  }
};

// 微调抽帧时间（避开闭眼、模糊）
const nudgeSceneTime = async (scene: ComicScene, delta: number) => {
  const newTime = Math.max(0, Number((scene.time + delta).toFixed(2)));
  scene.time = newTime;
  scene.isNudging = true;
  scene.cacheBuster = Date.now();
  setTimeout(() => {
    scene.isNudging = false;
  }, 200);
};

// 删除分镜卡片
const removeScene = (index: number) => {
  scenes.value.splice(index, 1);
  scenes.value.forEach((s, idx) => {
    s.index = idx + 1;
  });
};

// 插入新分镜
const addSceneAfter = (index: number) => {
  const current = scenes.value[index];
  const newTime = Number((current.time + 2.0).toFixed(2));
  const newScene: ComicScene = {
    id: `scene_${Date.now()}`,
    index: index + 2,
    time: newTime,
    start: current.end,
    end: current.end + 3.0,
    text: '',
    translatedText: '',
    cacheBuster: Date.now(),
  };

  scenes.value.splice(index + 1, 0, newScene);
  scenes.value.forEach((s, idx) => {
    s.index = idx + 1;
  });
};

// 本地视频自动识别镜头与字幕
const handleLocalVideoUpload = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  localVideoFile.value = file;
  isDetectingLocal.value = true;
  errorMessage.value = '';

  try {
    const formData = new FormData();
    formData.append('video', file);

    const res = await fetch(`${API_BASE}/api/video/comic/auto-detect-local`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || '自动识别本地视频镜头失败');
    }

    const data = await res.json();
    clipTitle.value = data.title || file.name.replace(/\.[^/.]+$/, '');
    storyTitle.value = data.storyTitle || clipTitle.value;
    isAutoDetected.value = true;

    scenes.value = (data.scenes || []).map((s: any, idx: number) => ({
      id: s.id || `local_cut_${idx + 1}`,
      index: idx + 1,
      time: s.time,
      start: s.start,
      end: s.end,
      text: s.text || '',
      translatedText: s.text || '',
      customImageSrc: s.customImageSrc,
      cacheBuster: Date.now(),
    }));

    if (data.matchedVideoId) {
      videoId.value = data.matchedVideoId;
      selectedVideoId.value = data.matchedVideoId;
    }
  } catch (err: any) {
    errorMessage.value = err.message || '自动分析视频镜头失败，请重试';
  } finally {
    isDetectingLocal.value = false;
  }
};

// 复制所有分镜文案
const copyAllNarration = () => {
  if (scenes.value.length === 0) return;
  const content = scenes.value
    .filter((s) => s.text)
    .map((s) => `${s.index.toString().padStart(2, '0')}. ${s.text}`)
    .join('\n\n');

  navigator.clipboard.writeText(content);
  copySuccessNotice.value = true;
  setTimeout(() => {
    copySuccessNotice.value = false;
  }, 2000);
};

// 辅助函数：加载图片到 HTMLImageElement
const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
};

/**
 * 在画面角落绘制精致的高清编号角标（如 #01）
 * 无底部任何 scene 提示，编号直接嵌入画面右上角
 */
function drawCornerNumberBadge(
  ctx: CanvasRenderingContext2D,
  index: number,
  x: number,
  y: number,
  w: number,
  _h: number
) {
  const badgeText = `#${String(index).padStart(2, '0')}`;

  ctx.save();
  const isHighRes = w >= 1200;
  const fontSize = isHighRes ? 28 : 20;
  const paddingH = isHighRes ? 18 : 12;
  const paddingV = isHighRes ? 8 : 5;
  const radius = isHighRes ? 20 : 14;
  const offsetEdge = isHighRes ? 28 : 16;

  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const textMetrics = ctx.measureText(badgeText);
  const badgeW = textMetrics.width + paddingH * 2;
  const badgeH = fontSize + paddingV * 2;

  const badgeX = x + w - badgeW - offsetEdge;
  const badgeY = y + offsetEdge;

  // 阴影与半透明深色质感背景
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = isHighRes ? 10 : 6;
  ctx.shadowOffsetY = isHighRes ? 3 : 2;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
  ctx.fill();

  // 细边框
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = isHighRes ? 1.5 : 1;
  ctx.stroke();

  // 居中文字
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

  ctx.restore();
}

/**
 * 渲染单个分镜为 Canvas：纯净画面 + 右上角编号角标，无底部任何 scene 提示
 */
const renderSceneToCanvas = async (
  scene: ComicScene,
  format: 'cinema' | 'xiaohongshu'
): Promise<HTMLCanvasElement> => {
  const imgUrl = getSceneImageUrl(scene);
  if (!imgUrl) throw new Error('无法获取分镜图片链接');

  const img = await loadImage(imgUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas');

  if (format === 'xiaohongshu') {
    // 3:4 小红书比例 1080 x 1440
    canvas.width = 1080;
    canvas.height = 1440;

    // 纯白画报背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const imgW = 1080;
    const imgH = Math.round((1080 * 9) / 16);
    const imgY = Math.round((1440 - imgH) / 2);

    ctx.drawImage(img, 0, imgY, imgW, imgH);
    drawCornerNumberBadge(ctx, scene.index, 0, imgY, imgW, imgH);
  } else {
    // 16:9 原始宽屏画质 1920 x 1080
    const w = img.naturalWidth || 1920;
    const h = img.naturalHeight || 1080;
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, 0, 0, w, h);
    drawCornerNumberBadge(ctx, scene.index, 0, 0, w, h);
  }

  return canvas;
};

// 导出整幅连环画高清垂直长图
const exportVerticalComicStrip = async () => {
  if (scenes.value.length === 0 || isExporting.value) return;
  isExporting.value = true;

  try {
    const cardWidth = 1080;
    const padding = 48;
    const cardSpacing = 24;
    const imgWidth = cardWidth - padding * 2;
    const imgHeight = Math.round((imgWidth * 9) / 16);
    const textHeight = showCardText.value ? 140 : 0;
    const cardHeight = imgHeight + textHeight;
    const headerHeight = 190;
    const footerHeight = 80;

    const totalHeight = headerHeight + scenes.value.length * (cardHeight + cardSpacing) + footerHeight;

    const canvas = document.createElement('canvas');
    canvas.width = cardWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 Canvas 上下文');

    // 绘制背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cardWidth, totalHeight);

    // 绘制头部 Banner
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(storyTitle.value || clipTitle.value || '精彩连环画分镜', cardWidth / 2, 85);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.fillText(`连环画分镜 · 全 ${scenes.value.length} 幕`, cardWidth / 2, 130);

    // 装饰线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, 160);
    ctx.lineTo(cardWidth - padding, 160);
    ctx.stroke();

    let currentY = headerHeight;

    for (let i = 0; i < scenes.value.length; i++) {
      const scene = scenes.value[i];
      const imgUrl = getSceneImageUrl(scene);
      const x = padding;
      const y = currentY;
      const w = imgWidth;

      // 绘制圆角画面
      try {
        const img = await loadImage(imgUrl);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, imgHeight, 16);
        ctx.clip();
        ctx.drawImage(img, x, y, w, imgHeight);
        ctx.restore();

        // 仅在画面上绘制编号角标（如 #01），无底部 scene 提示
        drawCornerNumberBadge(ctx, scene.index, x, y, w, imgHeight);
      } catch (err) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y, w, imgHeight);
      }

      if (showCardText.value && scene.text) {
        // 用户主动开启文字配字时才绘制
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'left';

        const maxTextWidth = w - 48;
        const words = scene.text.split(' ');
        let currentLine = '';
        let lineY = y + imgHeight + 40;

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const testLine = currentLine ? `${currentLine} ${words[wIdx]}` : words[wIdx];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxTextWidth && currentLine) {
            ctx.fillText(currentLine, x + 16, lineY);
            currentLine = words[wIdx];
            lineY += 30;
            if (lineY > y + cardHeight - 10) break;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine && lineY <= y + cardHeight - 10) {
          ctx.fillText(currentLine, x + 16, lineY);
        }
      }

      currentY += cardHeight + cardSpacing;
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Generated by AI Video Highlights · 视频分镜连环画', cardWidth / 2, totalHeight - 35);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clipTitle.value || 'comic'}_分镜连环画长图.png`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    alert('长图生成失败：' + (err.message || '未知错误'));
  } finally {
    isExporting.value = false;
  }
};

// 单张分镜单独图片下载（画面角标编号，无底部 scene 提示）
const downloadSingleCard = async (scene: ComicScene) => {
  try {
    const canvas = await renderSceneToCanvas(scene, cardStyle.value);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(scene.index).padStart(2, '0')}_${clipTitle.value || 'comic'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    alert('下载单图失败：' + (err.message || '未知错误'));
  }
};

// 批量打包导出所有分镜单独图片 (ZIP)
const exportAllScenesZip = async () => {
  if (scenes.value.length === 0 || isExportingZip.value) return;
  isExportingZip.value = true;
  zipProgress.value = { current: 0, total: scenes.value.length };

  try {
    const ZipConstructor = (JSZip as any)?.default || JSZip;
    const zip = new ZipConstructor();
    const folderName = `${clipTitle.value || 'comic'}_分镜单图`;
    const folder = zip.folder(folderName) || zip;

    for (let i = 0; i < scenes.value.length; i++) {
      const scene = scenes.value[i];
      zipProgress.value.current = i + 1;

      const canvas = await renderSceneToCanvas(scene, cardStyle.value);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        const filename = `${String(scene.index).padStart(2, '0')}.png`;
        folder.file(filename, blob);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clipTitle.value || 'comic'}_分镜单图全集(${scenes.value.length}张).zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    alert('批量导出单图失败：' + (err.message || '未知错误'));
  } finally {
    isExportingZip.value = false;
  }
};

onMounted(() => {
  fetchAvailableVideos();
  if (videoId.value) {
    loadComicData();
  }
});
</script>

<template>
  <div class="comic-view animate-fade-in">
    <!-- Top Action Bar -->
    <header class="comic-header glass-panel">
      <div class="header-left">
        <button class="btn-back" @click="router.back()">
          <ArrowLeft :size="16" />
          <span>返回</span>
        </button>

        <!-- 视频与切片选择器 (避免手动拖拽和一个个微调) -->
        <div class="video-picker-wrap">
          <div class="select-box">
            <Video :size="14" class="select-icon" />
            <select
              v-model="selectedVideoId"
              class="comic-select"
              @change="onVideoSelectChange"
            >
              <option value="" disabled>选择分析视频...</option>
              <option
                v-for="v in availableVideos"
                :key="v.videoId"
                :value="v.videoId"
              >
                {{ v.title || v.videoId }}
              </option>
            </select>
          </div>

          <!-- 核心故事切片选择 -->
          <div
            v-if="availableVideos.find((v) => v.videoId === selectedVideoId)?.takeaways?.length"
            class="select-box"
          >
            <BookOpen :size="14" class="select-icon" />
            <select
              v-model="selectedTakeawayIndex"
              class="comic-select takeaway-select"
              @change="onTakeawaySelectChange"
            >
              <option value="">全片智能分镜</option>
              <option
                v-for="(ta, idx) in availableVideos.find((v) => v.videoId === selectedVideoId)?.takeaways"
                :key="ta.id || idx"
                :value="idx"
              >
                {{ ta.storyTitle || ta.title }} ({{ ta.duration }})
              </option>
            </select>
          </div>
        </div>

        <div v-if="isAutoDetected" class="auto-badge" title="通过 FFmpeg 视觉算法已自动提取镜头切换点">
          <Sparkles :size="12" />
          <span>已自动识别镜头</span>
        </div>
      </div>

      <div class="header-center">
        <!-- 风格切换 -->
        <div class="style-switcher">
          <button
            class="btn-style-tab"
            :class="{ active: cardStyle === 'xiaohongshu' }"
            @click="cardStyle = 'xiaohongshu'"
          >
            <Smartphone :size="14" />
            <span>小红书 3:4 卡片</span>
          </button>
          <button
            class="btn-style-tab"
            :class="{ active: cardStyle === 'cinema' }"
            @click="cardStyle = 'cinema'"
          >
            <Film :size="14" />
            <span>电影宽屏画报</span>
          </button>
        </div>

        <button
          class="btn-toggle-en"
          :class="{ active: showCardText }"
          @click="showCardText = !showCardText"
        >
          <span>{{ showCardText ? '隐藏文字配字' : '显示文字配字' }}</span>
        </button>

        <button
          class="btn-reload"
          :disabled="isLoading || !videoId"
          @click="loadComicData"
          title="重新自动识别"
        >
          <RefreshCw :size="14" :class="{ spin: isLoading }" />
          <span>重新识别</span>
        </button>
      </div>

      <div class="header-right">
        <button
          class="btn-header-action"
          :disabled="scenes.length === 0"
          @click="copyAllNarration"
          title="一键复制所有分镜台词文案"
        >
          <Check v-if="copySuccessNotice" :size="14" class="text-success" />
          <Copy v-else :size="14" />
          <span>{{ copySuccessNotice ? '已复制' : '复制台词' }}</span>
        </button>

        <!-- 批量打包导出所有分镜单独图片 (ZIP) -->
        <button
          class="btn-header-action btn-export-zip"
          :disabled="scenes.length === 0 || isExportingZip || isExporting"
          @click="exportAllScenesZip"
          title="将每个分镜导出为单独高清图片并打包为 ZIP 下载"
        >
          <Loader2 v-if="isExportingZip" :size="15" class="spin" />
          <Archive v-else :size="15" />
          <span>{{ isExportingZip ? `打包中 (${zipProgress.current}/${zipProgress.total})...` : '打包单图 (ZIP)' }}</span>
        </button>

        <button
          class="btn-header-action btn-export-primary"
          :disabled="scenes.length === 0 || isExporting || isExportingZip"
          @click="exportVerticalComicStrip"
          title="导出整幅垂直连环画高清长图"
        >
          <Loader2 v-if="isExporting" :size="15" class="spin" />
          <Download v-else :size="15" />
          <span>{{ isExporting ? '合成长图中...' : '导出高清长图' }}</span>
        </button>
      </div>
    </header>

    <!-- 主体区域 -->
    <main class="comic-main">
      <!-- Loading State -->
      <div v-if="isLoading || isDetectingLocal" class="comic-loading-state glass-panel">
        <Loader2 :size="40" class="spin text-primary" />
        <h3>AI 正在自动识别镜头切变并对齐字幕...</h3>
        <p>通过视觉画面分析自动挑出各幕精彩场景，无需手动调整</p>
      </div>

      <!-- Error State -->
      <div v-else-if="errorMessage" class="comic-error-state glass-panel">
        <AlertCircle :size="36" class="text-danger" />
        <h3>无法生成连环画</h3>
        <p>{{ errorMessage }}</p>
        <button class="btn-retry" @click="loadComicData">
          <RefreshCw :size="14" />
          <span>重试加载</span>
        </button>
      </div>

      <!-- No Video Selected: Local Video Dropzone -->
      <div v-else-if="!videoId && scenes.length === 0" class="comic-dropzone glass-panel">
        <div class="dropzone-inner">
          <Upload :size="48" class="dropzone-icon" />
          <h3>导入本地视频自动识别连环画</h3>
          <p>拖拽或选择本地 MP4 视频，后端 FFmpeg 视觉算法自动识别镜头转场并智能匹配字幕</p>
          <label class="btn-select-file">
            <span>选择视频自动识别</span>
            <input type="file" accept="video/mp4,video/*" class="hidden-input" @change="handleLocalVideoUpload" />
          </label>
        </div>
      </div>

      <!-- Storyboard Card Grid -->
      <div v-else class="comic-grid-container" :class="`style-${cardStyle}`">
        <div class="comic-grid-meta">
          <div class="meta-left">
            <span class="meta-tag">共 {{ scenes.length }} 幕精准分镜</span>
            <span v-if="isAutoDetected" class="meta-subtag">✨ 已精准对齐原片硬字幕关键帧</span>
          </div>
          <span class="meta-hint">💡 画面已自动对齐原片英文字幕与生动表情，默认以纯图画连环画呈现（已隐去多余文字配字）；悬浮画面可微调换帧。</span>
        </div>

        <div class="comic-cards-grid">
          <article
            v-for="(scene, index) in scenes"
            :key="scene.id"
            class="comic-card glass-panel"
            :class="{ nudging: scene.isNudging }"
          >
            <!-- Card Head -->
            <div class="card-head">
              <div class="scene-badge">
                <span class="scene-num">#{{ scene.index.toString().padStart(2, '0') }}</span>
                <span class="scene-time">{{ formatTimeLabel(scene.time) }}</span>
              </div>
              <div class="scene-actions">
                <button class="btn-icon" @click="previewScene = scene" title="放大预览画面">
                  <ZoomIn :size="13" />
                </button>
                <button class="btn-icon" @click="downloadSingleCard(scene)" title="下载此分镜单独图片（带编号角标）">
                  <Download :size="13" />
                </button>
                <button class="btn-icon text-danger-hover" @click="removeScene(index)" title="删除此格">
                  <Trash2 :size="13" />
                </button>
              </div>
            </div>

            <!-- Image Frame -->
            <div class="card-image-wrap">
              <img
                :src="getSceneImageUrl(scene)"
                :alt="`Scene ${scene.index}`"
                class="scene-img"
                loading="lazy"
              />

              <!-- 图片右上角编号角标 -->
              <div class="scene-corner-badge">
                #{{ scene.index.toString().padStart(2, '0') }}
              </div>

              <!-- 悬浮微调按钮 (0.5s 快速换帧) -->
              <div class="nudge-controls">
                <button
                  class="btn-nudge"
                  @click="nudgeSceneTime(scene, -0.5)"
                  title="向前微调 0.5 秒"
                >
                  <ChevronLeft :size="14" />
                  <span>-0.5s</span>
                </button>
                <span class="nudge-label">{{ scene.time }}s</span>
                <button
                  class="btn-nudge"
                  @click="nudgeSceneTime(scene, 0.5)"
                  title="向后微调 0.5 秒"
                >
                  <span>+0.5s</span>
                  <ChevronRight :size="14" />
                </button>
              </div>
            </div>

            <!-- Text & Subtitle Area -->
            <div v-if="showCardText" class="card-body">
              <div class="text-input-wrap">
                <textarea
                  v-model="scene.text"
                  rows="2"
                  class="comic-text-editor"
                  placeholder="在此输入分镜台词或动作说明..."
                ></textarea>
              </div>
            </div>

            <!-- Add Card In-between -->
            <div class="card-tail-insert">
              <button class="btn-insert-scene" @click="addSceneAfter(index)" title="在此处插入一格分镜">
                <Plus :size="12" />
                <span>插入分镜</span>
              </button>
            </div>
          </article>
        </div>
      </div>
    </main>

    <!-- Modal: Image Zoom Preview -->
    <div v-if="previewScene" class="preview-modal-backdrop" @click="previewScene = null">
      <div class="preview-modal-card glass-panel" @click.stop>
        <button class="btn-close-modal" @click="previewScene = null">
          <X :size="18" />
        </button>
        <div class="preview-modal-img-wrap">
          <img :src="getSceneImageUrl(previewScene)" alt="Zoom preview" class="preview-big-img" />
        </div>
        <div class="preview-modal-meta">
          <h3>#{{ previewScene.index }} - {{ previewScene.translatedText }}</h3>
          <p class="preview-time-tag">时间截点: {{ previewScene.time }}s</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comic-view {
  min-height: 100vh;
  padding: 16px 24px 80px;
  background: var(--bg-base);
  color: var(--text-primary);
}

/* Header */
.comic-header {
  position: sticky;
  top: 16px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 18px;
  border-radius: 16px;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-back:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
}

.video-picker-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-box {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0 8px;
}

.select-icon {
  color: #818cf8;
  margin-right: 4px;
}

.comic-select {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 4px;
  cursor: pointer;
  outline: none;
  max-width: 180px;
}

.comic-select option {
  background: #1e293b;
  color: #f8fafc;
}

.takeaway-select {
  max-width: 220px;
}

.auto-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.header-center {
  display: flex;
  align-items: center;
  gap: 10px;
}

.style-switcher {
  display: flex;
  align-items: center;
  padding: 3px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.btn-style-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-style-tab.active {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
  font-weight: 600;
}

.btn-toggle-en,
.btn-reload {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-toggle-en:hover,
.btn-reload:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.btn-toggle-en.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.4);
  color: #818cf8;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-header-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-header-action:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.btn-export-primary {
  background: #6366f1;
  color: #ffffff;
  border: none;
  font-weight: 600;
}

.btn-export-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-export-zip {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #34d399;
  font-weight: 600;
}

.btn-export-zip:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.25);
  color: #6ee7b7;
}

/* States */
.comic-loading-state,
.comic-error-state,
.comic-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 380px;
  text-align: center;
  border-radius: 20px;
  padding: 48px;
}

.comic-dropzone .dropzone-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 460px;
}

.dropzone-icon {
  color: #6366f1;
  margin-bottom: 8px;
}

.btn-select-file {
  display: inline-block;
  padding: 10px 22px;
  border-radius: 10px;
  background: #6366f1;
  color: white;
  font-weight: 600;
  cursor: pointer;
  margin-top: 6px;
}

.hidden-input {
  display: none;
}

/* Grid & Cards */
.comic-grid-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 4px;
}

.meta-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-tag {
  font-size: 14px;
  font-weight: 700;
  color: #818cf8;
}

.meta-subtag {
  font-size: 12px;
  color: #10b981;
  font-weight: 600;
}

.meta-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.comic-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.style-xiaohongshu .comic-cards-grid {
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
}

.comic-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: transform 0.2s, box-shadow 0.2s;
}

.comic-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.15);
}

.scene-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scene-num {
  font-size: 12px;
  font-weight: 700;
  color: #6366f1;
}

.scene-time {
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
}

.scene-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
}

.text-danger-hover:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

/* Image Frame */
.card-image-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  overflow: hidden;
}

.scene-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scene-corner-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  z-index: 2;
}

/* Nudge Controls overlay */
.nudge-controls {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  opacity: 0.85;
  transition: opacity 0.2s;
}

.card-image-wrap:hover .nudge-controls {
  opacity: 1;
}

.btn-nudge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-nudge:hover {
  background: #6366f1;
}

.nudge-label {
  font-size: 10px;
  font-family: monospace;
  color: #cbd5e1;
}

/* Card Body & Text */
.card-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.comic-text-editor {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 10px;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.2s;
}

.comic-text-editor:focus {
  outline: none;
  border-color: #6366f1;
}

.original-sub {
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
  margin: 0;
  line-height: 1.4;
}

.card-tail-insert {
  display: flex;
  justify-content: center;
  padding: 8px 14px 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
}

.btn-insert-scene {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.2s;
}

.btn-insert-scene:hover {
  color: #6366f1;
}

/* Modal */
.preview-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.preview-modal-card {
  position: relative;
  max-width: 900px;
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  background: #0f172a;
}

.btn-close-modal {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  color: white;
  cursor: pointer;
}

.preview-big-img {
  width: 100%;
  display: block;
}

.preview-modal-meta {
  padding: 16px 20px;
}

.preview-modal-meta h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.preview-time-tag {
  font-size: 12px;
  color: #94a3b8;
  font-family: monospace;
  margin: 0;
}

.text-success {
  color: #10b981;
}
.text-danger {
  color: #ef4444;
}
.text-primary {
  color: #6366f1;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
