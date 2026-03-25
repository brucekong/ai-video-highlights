<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { AlertTriangle, Loader2, X } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'danger';
  loading?: boolean;
}>(), {
  confirmText: '确认',
  cancelText: '取消',
  confirmVariant: 'default',
  loading: false,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm'): void;
}>();

const handleEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show && !props.loading) {
    emit('close');
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleEsc);
});
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="modal-overlay" @click.self="!loading && emit('close')">
      <div class="modal-content glass-panel animate-zoom-in">
        <div class="modal-header">
          <div class="title-with-icon">
            <AlertTriangle class="icon accent" :size="22" />
            <h3>{{ title }}</h3>
          </div>
          <button class="btn-icon" @click="emit('close')" :disabled="loading">
            <X :size="18" />
          </button>
        </div>

        <div class="modal-body">
          <p class="description">{{ message }}</p>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="emit('close')" :disabled="loading">
            {{ cancelText }}
          </button>
          <button
            class="btn-primary"
            :class="{ danger: confirmVariant === 'danger' }"
            @click="emit('confirm')"
            :disabled="loading"
          >
            <Loader2 v-if="loading" :size="16" class="spin" />
            <span>{{ confirmText }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 20px;
}

.modal-content {
  width: 100%;
  max-width: 460px;
  background: rgba(15, 15, 18, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 22px 24px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.title-with-icon {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-with-icon h3 {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
  color: #fff;
}

.icon.accent {
  color: #f59e0b;
}

.btn-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.btn-icon:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal-body {
  padding: 22px 24px 12px;
}

.description {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.65;
  margin: 0;
}

.modal-footer {
  padding: 16px 24px 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-secondary,
.btn-primary {
  min-width: 92px;
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 0.88rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
}

.btn-primary {
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: white;
}

.btn-primary.danger {
  border-color: #ef4444;
  background: #ef4444;
}

.btn-secondary:disabled,
.btn-primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
