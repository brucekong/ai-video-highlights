<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  bvid: string;
}>();

const emit = defineEmits<{
  (e: 'ready'): void;
  (e: 'timeupdate', currentTime: number): void;
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
let timeUpdateInterval: number | null = null;

const embedUrl = computed(() => {
  return `//player.bilibili.com/player.html?bvid=${props.bvid}&page=1&high_quality=1&danmaku=0&autoplay=0`;
});

onMounted(() => {
  // B站 iframe 不支持 postMessage API 来获取播放时间
  // 所以 timeupdate 事件无法完美工作
  // 但我们仍然 emit ready 事件
  emit('ready');
});

onUnmounted(() => {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
  }
});

// B站 iframe 播放器没有对外暴露 seekTo API
// 但我们仍然暴露接口以保持组件接口一致
defineExpose({
  seekTo: (seconds: number) => {
    // B站嵌入播放器通过 URL hash 跳转时间
    // 重新设置 iframe src 并带上 t 参数（秒）
    if (iframeRef.value) {
      const baseUrl = `//player.bilibili.com/player.html?bvid=${props.bvid}&page=1&high_quality=1&danmaku=0&autoplay=1`;
      iframeRef.value.src = `${baseUrl}&t=${Math.floor(seconds)}`;
    }
  }
});
</script>

<template>
  <div class="video-wrapper">
    <iframe
      ref="iframeRef"
      :src="embedUrl"
      class="bilibili-iframe"
      scrolling="no"
      border="0"
      frameborder="no"
      framespacing="0"
      allowfullscreen
      sandbox="allow-same-origin allow-scripts allow-forms"
    />
  </div>
</template>

<style scoped>
.video-wrapper {
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #000;
  border-radius: var(--radius-xl);
  overflow: hidden;
  position: relative;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--border-color);
  transition: all var(--transition-normal);
}

.video-wrapper:hover {
  border-color: var(--accent-glow);
  box-shadow: 0 20px 50px -10px var(--accent-glow);
}

.bilibili-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
