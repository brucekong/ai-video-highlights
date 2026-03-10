<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';

const props = defineProps<{
  videoId: string;
}>();

const emit = defineEmits<{
  (e: 'ready', player: any): void;
  (e: 'duration', seconds: number): void;
  (e: 'timeupdate', currentTime: number): void;
}>();

const playerContainer = ref<HTMLDivElement | null>(null);
let player: any = null;
let timeUpdateInterval: number | null = null;

// Load YouTube IFrame API
const loadYouTubeAPI = (): Promise<void> => {
  return new Promise((resolve) => {
    if ((window as any).YT && (window as any).YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      resolve();
    };
  });
};

const startTimePolling = (playerTarget: any) => {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  timeUpdateInterval = window.setInterval(() => {
    if (playerTarget && playerTarget.getCurrentTime) {
      emit('timeupdate', playerTarget.getCurrentTime());
    }
  }, 100); // 100ms 轮询以获得细腻平滑的指针运动
};

const stopTimePolling = () => {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
};

const initPlayer = () => {
  if (!playerContainer.value) return;

  player = new (window as any).YT.Player(playerContainer.value, {
    height: '100%',
    width: '100%',
    videoId: props.videoId,
    playerVars: {
      autoplay: 0,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: (event: any) => {
        emit('ready', event.target);
        if (event.target.getDuration) {
          emit('duration', event.target.getDuration());
        }
        startTimePolling(event.target);
      },
      onStateChange: (event: any) => {
        const state = event.data;
        const YT = (window as any).YT;

        if (state === YT.PlayerState.PLAYING) {
          startTimePolling(event.target);
        } else if (state === YT.PlayerState.ENDED || state === YT.PlayerState.PAUSED) {
          // 暂停或结束时停止轮询以节省资源，但在 seek 时会重新触发状态变化
          // 这里可以根据需要决定是否在 PAUSED 时停止。通常停止对资源更好。
          stopTimePolling();
        }
      }
    }
  });
};

onMounted(async () => {
  await loadYouTubeAPI();
  initPlayer();
});

watch(() => props.videoId, (newId) => {
  if (player && player.loadVideoById) {
    player.loadVideoById(newId);
    // On new video load, we should wait and then re-emit duration
    setTimeout(() => {
      if (player && player.getDuration) {
        emit('duration', player.getDuration());
      }
    }, 1000);
  } else {
    initPlayer();
  }
});

onUnmounted(() => {
  if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
  }
  if (player && player.destroy) {
    player.destroy();
  }
});

// Method for parent to call
defineExpose({
  seekTo: (seconds: number) => {
    if (player && player.seekTo) {
      player.seekTo(seconds, true);
      player.playVideo();
      // 在 seek 后立即重启轮询，防止状态处于非播放时指针停滞
      startTimePolling(player);
    }
  },
  setLoop: (start: number, end: number) => {
    if (player && player.seekTo) {
      player.seekTo(start, true);
      player.playVideo();
      startTimePolling(player);

      const checkEnd = () => {
        if (player && player.getCurrentTime) {
          const currentTime = player.getCurrentTime();
          // 增加 0.08s 的提前量，防止由于轮询延迟导致听到下一句的开头
          if (currentTime >= end - 0.08) {
            player.seekTo(start, true);
          }
          if (player.loopRequestId) {
            player.loopRequestId = requestAnimationFrame(checkEnd);
          }
        }
      };

      if (player.loopRequestId) cancelAnimationFrame(player.loopRequestId);
      player.loopRequestId = requestAnimationFrame(checkEnd);
    }
  },
  stopLoop: () => {
    if (player && player.loopRequestId) {
      cancelAnimationFrame(player.loopRequestId);
      player.loopRequestId = null;
    }
  }
});
</script>

<template>
  <div class="video-wrapper">
    <!-- The div below will be replaced by the iframe -->
    <div ref="playerContainer" class="youtube-container"></div>
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

.youtube-container {
  width: 100%;
  height: 100%;
}
</style>
