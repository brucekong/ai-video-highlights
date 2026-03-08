<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import SemanticSearchPanel from './SemanticSearchPanel.vue';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits(['close', 'result-click']);

const searchPanelRef = ref<any>(null);

const handleResultClick = (res: any) => {
  emit('result-click', res);
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
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="global-search-overlay" @click.self="emit('close')">
        <div class="global-search-container glass-panel animate-scale-in">
          <!-- Header -->
          <div class="modal-header">
            <div class="header-info">
              <div class="search-badge">
                <span>全库搜索</span>
              </div>
              <h3>语义搜索所有视频</h3>
            </div>
            <button class="close-btn" @click="emit('close')">
              <X :size="20" />
            </button>
          </div>

          <!-- Search Content -->
          <div class="modal-content">
            <SemanticSearchPanel
              ref="searchPanelRef"
              placeholder="输入自然语言描述，为您定位到精准时刻..."
              @result-click="handleResultClick"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.global-search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  z-index: 3000;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.global-search-container {
  width: 100%;
  max-width: 800px;
  max-height: 90vh;
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
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.modal-header h3 {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
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

/* Modal Transitons */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.3s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.animate-scale-in { animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }

@keyframes scale-in {
  from { transform: scale(0.95) translateY(20px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
</style>
