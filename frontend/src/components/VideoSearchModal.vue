<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { X } from 'lucide-vue-next';
import SemanticSearchPanel from './SemanticSearchPanel.vue';

const props = defineProps<{
  show: boolean;
  videoId: string;
  videoTitle?: string;
}>();

const emit = defineEmits(['close', 'seek']);

const searchPanelRef = ref<any>(null);

const handleResultClick = (res: any) => {
  emit('seek', res.offset);
  emit('close');
};

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

// Auto-focus input when shown
watch(() => props.show, (newVal) => {
  if (newVal) {
    nextTick(() => {
      searchPanelRef.value?.focus();
    });
  }
});
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="video-search-overlay" @click.self="emit('close')">
      <div class="video-search-container glass-panel animate-scale-in">
        <!-- Header -->
        <div class="modal-header">
          <div class="header-info">
            <div class="search-badge">视频内检索</div>
            <h3 :title="videoTitle">{{ videoTitle || '搜索视频内容' }}</h3>
          </div>
          <button class="close-btn" @click="emit('close')">
            <X :size="20" />
          </button>
        </div>

        <!-- Search Content -->
        <div class="modal-content">
          <SemanticSearchPanel
            ref="searchPanelRef"
            :video-id="videoId"
            placeholder="输入自然语言描述，为您定位到精准时刻..."
            :min-score="0.4"
            @result-click="handleResultClick"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.video-search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  z-index: 2500;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.video-search-container {
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: rgba(18, 20, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
  border-radius: 24px;
  overflow: hidden;
}

.modal-header {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-badge {
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.modal-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.modal-content {
  padding: 24px;
  overflow-y: auto;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Modal Transitons */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.3s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }

@keyframes scale-in {
  from { transform: scale(0.95) translateY(20px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
</style>
