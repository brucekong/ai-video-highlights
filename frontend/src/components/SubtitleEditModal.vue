<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { X, Check, Loader2, Type, Languages } from 'lucide-vue-next';

interface TranscriptSegment {
  text: string;
  translatedText?: string;
  offset: number;
  duration: number;
}

const props = defineProps<{
  show: boolean;
  segment: TranscriptSegment | null;
  isBilingual: boolean;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', data: { text: string, translatedText: string }): void;
  (e: 'translate', text: string): void;
}>();

const editForm = ref({
  text: '',
  translatedText: ''
});

const isTranslating = ref(false);

// Sync local form with backdrop segment when modal opens
watch(() => props.show, (newVal) => {
  if (newVal && props.segment) {
    editForm.value = {
      text: props.segment.text,
      translatedText: props.segment.translatedText || ''
    };
    isTranslating.value = false;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEsc);
  } else {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', handleEsc);
  }
});

const handleEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show && !props.isSaving && !isTranslating.value) {
    emit('close');
  }
};

const handleSave = () => {
  emit('save', { ...editForm.value });
};

const fastTranslate = async () => {
  if (!editForm.value.text || isTranslating.value) return;
  
  isTranslating.value = true;
  try {
     // NOTE: We could emit instead and have parent handle, 
     // but we'll try to get it directly if possible, 
     // or let parent pass a function.
     // For now, let's emit to keep VideoView in control of API calls.
     emit('translate', editForm.value.text);
  } catch (err) {
    console.error('Translation trigger failed:', err);
  } finally {
    // isTranslating will be reset by parent if we can, 
    // but here we wait for parent to update props.segment's translatedText? 
    // No, better to just let parent return the string.
  }
};

// Expose a method to update the form from outside (e.g. after translation)
defineExpose({
  updateTranslatedText: (text: string) => {
    editForm.value.translatedText = text;
    isTranslating.value = false;
  },
  setTranslating: (val: boolean) => {
    isTranslating.value = val;
  }
});

onUnmounted(() => {
  document.body.style.overflow = '';
  window.removeEventListener('keydown', handleEsc);
});

const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="modal-overlay" @click.self="(!isSaving && !isTranslating) && emit('close')">
      <div class="modal-container glass-panel animate-scale-in">
        <!-- Header -->
        <div class="modal-header">
          <div class="header-info">
            <div class="edit-badge">编辑字幕 / Edit Subtitle</div>
            <div class="time-stamp">{{ segment ? formatTimeFromMs(segment.offset) : '00:00' }}</div>
          </div>
          <button class="close-btn" @click="emit('close')" :disabled="isSaving || isTranslating">
            <X :size="20" />
          </button>
        </div>

        <!-- Content -->
        <div class="modal-content">
          <div class="input-group">
            <div class="label-row">
              <label class="input-label">
                <Languages :size="16" class="label-icon" />
                <span>中文翻译 / Chinese Translation</span>
              </label>
              <button 
                class="btn-ai-translate" 
                @click="fastTranslate" 
                :disabled="isTranslating || !editForm.text"
                title="使用 AI 一键翻译原文"
              >
                <Sparkles v-if="!isTranslating" :size="12" />
                <Loader2 v-else :size="12" class="spin" />
                <span>AI 一键翻译</span>
              </button>
            </div>
            <textarea 
              v-model="editForm.translatedText" 
              class="edit-textarea trans" 
              placeholder="请输入中文翻译..."
              rows="3"
              :disabled="isTranslating"
            ></textarea>
          </div>

          <div class="input-group">
            <label class="input-label">
              <Type :size="16" class="label-icon" />
              <span>原始内容 / Original Text</span>
            </label>
            <textarea 
              v-model="editForm.text" 
              class="edit-textarea orig" 
              placeholder="Original content here..."
              rows="3"
              :disabled="isTranslating"
            ></textarea>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn-cancel" @click="emit('close')" :disabled="isSaving || isTranslating">
            取消 / Cancel
          </button>
          <button class="btn-save" @click="handleSave" :disabled="isSaving || isTranslating">
            <Loader2 v-if="isSaving" :size="18" class="spin" />
            <Check v-else :size="18" />
            <span>保存修改 / Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.btn-ai-translate {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-color);
  border: 1px solid rgba(99, 102, 241, 0.2);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-ai-translate:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--accent-color);
  transform: translateY(-1px);
}

.btn-ai-translate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-container {
  width: 100%;
  max-width: 600px;
  background: rgba(20, 22, 32, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.6);
}

.modal-header {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.edit-badge {
  background: var(--accent-color);
  color: white;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.time-stamp {
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 8px;
  border-radius: 6px;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.close-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  transform: rotate(90deg);
}

.modal-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.label-icon {
  opacity: 0.7;
}

.edit-textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 14px;
  color: var(--text-primary);
  font-size: 1rem;
  line-height: 1.6;
  resize: vertical;
  transition: all 0.2s ease;
  font-family: inherit;
}

.edit-textarea:focus {
  outline: none;
  border-color: var(--accent-color);
  background: rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
}

.edit-textarea.trans {
  border-left: 4px solid var(--accent-color);
}

.edit-textarea.orig {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.modal-footer {
  padding: 20px 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.btn-cancel {
  padding: 10px 20px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.btn-save {
  padding: 10px 24px;
  border-radius: 10px;
  background: var(--accent-color);
  border: none;
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.btn-save:hover:not(:disabled) {
  background: #4f46e5;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}

.btn-save:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.animate-scale-in {
  animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes scale-in {
  from {
    transform: scale(0.95) translateY(20px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
