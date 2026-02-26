<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';

const props = defineProps<{
  videoId: string;
}>();

const emit = defineEmits<{
  (e: 'ready', player: any): void;
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
        // Start polling for current time to sync with outline
        timeUpdateInterval = window.setInterval(() => {
          if (event.target && event.target.getCurrentTime) {
            emit('timeupdate', event.target.getCurrentTime());
          }
        }, 1000);
      },
      onStateChange: (event: any) => {
        // Handle state changes if needed
        if (event.data === (window as any).YT.PlayerState.ENDED) {
          if (timeUpdateInterval) clearInterval(timeUpdateInterval);
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
