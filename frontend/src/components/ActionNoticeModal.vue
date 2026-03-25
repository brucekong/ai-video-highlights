<script setup lang="ts">
import { CheckCircle2, AlertTriangle, Info } from 'lucide-vue-next';

withDefaults(defineProps<{
  show: boolean;
  title: string;
  message: string;
  type?: 'success' | 'error' | 'info';
  buttonText?: string;
}>(), {
  type: 'info',
  buttonText: '我知道了',
});

const emit = defineEmits<{
  (e: 'close'): void;
}>();
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="notice-overlay" @click.self="emit('close')">
      <div class="notice-modal glass-panel animate-zoom-in">
        <div class="notice-icon-wrap" :class="type">
          <CheckCircle2 v-if="type === 'success'" :size="30" class="notice-icon" />
          <AlertTriangle v-else-if="type === 'error'" :size="30" class="notice-icon" />
          <Info v-else :size="30" class="notice-icon" />
        </div>
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>

        <div class="notice-actions">
          <button class="btn-primary" @click="emit('close')">{{ buttonText }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notice-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 20px;
}

.notice-modal {
  width: 100%;
  max-width: 420px;
  padding: 28px 24px 22px;
  text-align: center;
  background: rgba(15, 15, 18, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.notice-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  margin: 0 auto 16px;
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

.notice-modal h3 {
  margin: 0 0 10px;
  font-size: 1.1rem;
  color: #fff;
}

.notice-modal p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
  font-size: 0.94rem;
}

.notice-actions {
  margin-top: 22px;
  display: flex;
  justify-content: center;
}

.btn-primary {
  min-width: 110px;
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: white;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}
</style>
