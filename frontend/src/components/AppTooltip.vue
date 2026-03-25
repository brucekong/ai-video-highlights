<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount } from 'vue';

const props = withDefaults(defineProps<{
  text: string;
  teleport?: boolean;
  align?: 'center' | 'left';
  disabled?: boolean;
}>(), {
  teleport: false,
  align: 'center',
  disabled: false,
});

const isOpen = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const tooltipPos = ref({ left: 0, top: 0 });

const tooltipStyle = computed(() => {
  if (!props.teleport) return undefined;

  if (props.align === 'left') {
    return {
      '--tooltip-left': `${tooltipPos.value.left}px`,
      '--tooltip-top': `${tooltipPos.value.top}px`,
    };
  }

  return {
    '--tooltip-left': `${tooltipPos.value.left}px`,
    '--tooltip-top': `${tooltipPos.value.top}px`,
  };
});

const updatePosition = () => {
  if (!triggerRef.value || !props.teleport) return;
  const rect = triggerRef.value.getBoundingClientRect();
  tooltipPos.value = {
    left: props.align === 'left' ? rect.left : rect.left + rect.width / 2,
    top: rect.top,
  };
};

const openTooltip = async () => {
  if (props.disabled) return;
  isOpen.value = true;
  await nextTick();
  updatePosition();
};

const closeTooltip = () => {
  isOpen.value = false;
};

const handleWindowChange = () => {
  if (!isOpen.value) return;
  updatePosition();
};

window.addEventListener('scroll', handleWindowChange, true);
window.addEventListener('resize', handleWindowChange);

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleWindowChange, true);
  window.removeEventListener('resize', handleWindowChange);
});
</script>

<template>
  <div
    ref="triggerRef"
    class="app-tooltip"
    @mouseenter="openTooltip"
    @mouseleave="closeTooltip"
    @focusin="openTooltip"
    @focusout="closeTooltip"
  >
    <slot />

    <Transition name="tooltip-fade">
      <Teleport v-if="teleport" to="body">
        <div
          v-if="isOpen && !disabled"
          class="tooltip-bubble is-teleport"
          :class="{ 'align-left': align === 'left' }"
          :style="tooltipStyle"
        >
          {{ text }}
        </div>
      </Teleport>
      <div
        v-else-if="isOpen && !disabled"
        class="tooltip-bubble"
        :class="{ 'align-left': align === 'left' }"
      >
        {{ text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-tooltip {
  position: relative;
  display: inline-block;
  vertical-align: middle;
}

.tooltip-bubble {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-12px);
  background: #1e293b;
  color: #f8fafc;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
  width: max-content;
  min-width: 60px;
  max-width: 280px;
  white-space: normal;
  word-break: break-word;
  pointer-events: none;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 9999999;
}

.tooltip-bubble.align-left {
  left: 0;
  transform: translateY(-12px);
  text-align: left;
}

.tooltip-bubble.is-teleport {
  position: fixed;
  left: var(--tooltip-left);
  top: var(--tooltip-top);
  bottom: auto;
  transform: translate(-50%, calc(-100% - 12px));
}

.tooltip-bubble.is-teleport.align-left {
  left: var(--tooltip-left);
  top: var(--tooltip-top);
  transform: translate(0, calc(-100% - 12px));
}

.tooltip-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: #1e293b transparent transparent transparent;
}

.tooltip-bubble.align-left::after {
  left: 20px;
  transform: translateX(0);
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}

.tooltip-bubble.align-left.tooltip-fade-enter-from,
.tooltip-bubble.align-left.tooltip-fade-leave-to {
  transform: translateY(-6px);
}

.tooltip-bubble.is-teleport.tooltip-fade-enter-from,
.tooltip-bubble.is-teleport.tooltip-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% - 6px));
}

.tooltip-bubble.is-teleport.align-left.tooltip-fade-enter-from,
.tooltip-bubble.is-teleport.align-left.tooltip-fade-leave-to {
  transform: translate(0, calc(-100% - 6px));
}
</style>
