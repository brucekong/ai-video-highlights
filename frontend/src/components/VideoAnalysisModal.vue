<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Sparkles, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-vue-next';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits(['close', 'submit-task']);

interface AnalyzeRequest {
  videoId: string;
  url: string;
  platform: 'youtube' | 'bilibili';
  forceRefresh?: boolean;
}

const videoUrl = ref('');
const isAnalyzing = ref(false);
const errorMsg = ref('');
const showSuccess = ref(false);

const videoInfo = computed(() => {
  const url = videoUrl.value;
  if (!url) return null;

  // Youtube
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&]{11})/);
  if (ytMatch) return { platform: 'youtube' as const, videoId: ytMatch[1] };

  // Bilibili
  const biliMatch = url.match(/(BV[a-zA-Z0-9]{10})/);
  if (biliMatch) return { platform: 'bilibili' as const, videoId: biliMatch[1] };

  return null;
});

const hasValidUrl = computed(() => !!videoInfo.value);

const handleEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close');
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleEsc);
});

const handleAnalyze = () => {
  if (!videoInfo.value) return;

  const payload: AnalyzeRequest = {
    url: videoUrl.value,
    videoId: videoInfo.value.videoId,
    platform: videoInfo.value.platform
  };

  // 立即发出任务并关闭弹窗
  emit('submit-task', payload);
  videoUrl.value = '';
  emit('close');
};
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content glass-panel animate-zoom-in">
        <div class="modal-header">
          <div class="title-with-icon">
            <Sparkles class="icon accent" :size="24" />
            <h3>异步解析新视频</h3>
          </div>
          <button class="btn-icon" @click="emit('close')">
            <X :size="20" />
          </button>
        </div>

        <div class="modal-body">
          <p class="description">输入视频链接，我们将为您在后台开启解析任务。解析完成后，你将在通知中心收到提醒。</p>

          <div class="input-section">
            <div class="input-group" :class="{ 'error': errorMsg, 'success': showSuccess }">
              <Sparkles v-if="!isAnalyzing && !showSuccess" class="input-icon" :size="18" />
              <Loader2 v-else-if="isAnalyzing" class="input-icon spin" :size="18" />
              <CheckCircle2 v-else-if="showSuccess" class="input-icon success-icon" :size="18" />

              <input
                v-model="videoUrl"
                type="text"
                placeholder="YouTube 或 Bilibili 链接..."
                :disabled="isAnalyzing || showSuccess"
                @keyup.enter="handleAnalyze"
              />

              <button
                class="btn-analyze"
                :disabled="!hasValidUrl || isAnalyzing || showSuccess"
                @click="handleAnalyze"
              >
                <span>{{ isAnalyzing ? '正在分析' : '开始分析' }}</span>
              </button>
            </div>
          </div>

          <Transition name="slide-up">
            <div v-if="errorMsg" class="error-msg">
              <AlertCircle :size="16" />
              <span>{{ errorMsg }}</span>
            </div>
            <div v-else-if="showSuccess" class="success-msg">
              <CheckCircle2 :size="16" />
              <span>解析任务已提交，完成后将自动同步到历史记录</span>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 100%;
  max-width: 500px;
  background: rgba(15, 15, 18, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.title-with-icon {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-with-icon h3 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  color: #fff;
}

.icon.accent {
  color: var(--accent-color);
}

.modal-body {
  padding: 30px 24px;
}

.description {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin-bottom: 24px;
}

.input-section {
  margin-bottom: 16px;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 4px 4px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.input-group:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.15);
}

.input-group.error {
  border-color: #ef4444;
}

.input-group.success {
  border-color: #10b981;
}

.input-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.input-icon.spin {
  color: var(--accent-color);
}

.input-icon.success-icon {
  color: #10b981;
}

input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 0.95rem;
  padding: 10px 0;
  min-width: 0;
}

input::placeholder {
  color: var(--text-muted);
}

.btn-analyze {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-analyze:hover:not(:disabled) {
  background: #4F46E5;
  transform: translateY(-1px);
}

.btn-analyze:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 8px;
}

.success-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #10b981;
  font-size: 0.85rem;
  margin-top: 8px;
}

/* Animations */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.animate-zoom-in {
  animation: zoomIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes zoomIn {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

.slide-up-enter-active {
  transition: all 0.3s ease-out;
}
.slide-up-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.btn-icon {
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}
</style>
