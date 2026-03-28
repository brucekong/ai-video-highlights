<script setup lang="ts">
import { CheckCircle2, AlertTriangle, Info } from 'lucide-vue-next';

withDefaults(defineProps<{
  show: boolean;
  title: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}>(), {
  type: 'info',
});

const emit = defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <Transition name="toast">
    <div v-if="show" class="notice-toast glass-panel" :class="type" @click="emit('close')">
      <div class="notice-icon-wrap" :class="type">
        <CheckCircle2 v-if="type === 'success'" :size="18" class="notice-icon" />
        <AlertTriangle v-else-if="type === 'error'" :size="18" class="notice-icon" />
        <Info v-else :size="18" class="notice-icon" />
      </div>
      <div class="notice-copy">
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notice-toast {
  position: fixed;
  top: 24px;
  right: 24px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(15, 15, 18, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 3000;
  cursor: pointer;
}

.notice-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.notice-icon-wrap.success {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.22);
  color: #34d399;
}

.notice-icon-wrap.error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.22);
  color: #f87171;
}

.notice-icon-wrap.info {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.22);
  color: #a5b4fc;
}

.notice-copy {
  min-width: 0;
}

.notice-copy h3 {
  margin: 0 0 4px;
  font-size: 0.92rem;
  color: #fff;
  line-height: 1.3;
}

.notice-copy p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
  font-size: 0.82rem;
  word-break: break-word;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

@media (max-width: 640px) {
  .notice-toast {
    top: 16px;
    right: 16px;
    left: 16px;
    width: auto;
  }
}
</style>
