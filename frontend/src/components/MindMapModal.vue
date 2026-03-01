<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { X, ZoomIn, ZoomOut, Maximize2, Download } from 'lucide-vue-next';

const props = defineProps<{
  show: boolean;
  markdown: string;
  title?: string;
}>();

const emit = defineEmits(['close']);

const svgRef = ref<SVGSVGElement | null>(null);
const markmapRef = ref<Markmap | null>(null);
const transformer = new Transformer();

const initMarkmap = async () => {
  if (!svgRef.value || !props.markdown) return;

  const { root } = transformer.transform(props.markdown);

  if (markmapRef.value) {
    markmapRef.value.setData(root);
    markmapRef.value.fit();
  } else {
    markmapRef.value = Markmap.create(svgRef.value, {
      autoFit: true,
      zoom: true,
      pan: true,
      duration: 500,
    }, root);
  }
};

const handleZoomIn = () => markmapRef.value?.rescale(1.25);
const handleZoomOut = () => markmapRef.value?.rescale(0.8);
const handleFit = () => markmapRef.value?.fit();

const downloadSvg = () => {
  if (!svgRef.value) return;
  const svgData = new XMLSerializer().serializeToString(svgRef.value);
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mindmap-${props.title || 'video'}.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const handleEsc = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close');
  }
};

watch(() => props.show, async (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEsc);
    await nextTick();
    setTimeout(initMarkmap, 100);
  } else {
    document.body.style.overflow = '';
    window.removeEventListener('keydown', handleEsc);
    // 关键：当 Modal 关闭时，由于 v-if 会销毁 SVG 元素，
    // 我们必须清空 markmap 实例引用，确保下次打开时重新绑定到新的 SVG 元素。
    markmapRef.value = null;
  }
});

watch(() => props.markdown, () => {
  if (props.show) initMarkmap();
});

onUnmounted(() => {
  document.body.style.overflow = '';
  window.removeEventListener('keydown', handleEsc);
});
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="mindmap-modal-overlay" @click.self="emit('close')">
      <div class="mindmap-modal-container glass-panel animate-scale-in">
        <!-- Header -->
        <div class="modal-header">
          <div class="header-info">
            <div class="mindmap-badge">智能脑图</div>
            <h3>{{ title || '视频知识脑图' }}</h3>
          </div>
          <button class="close-btn" @click="emit('close')">
            <X :size="20" />
          </button>
        </div>

        <!-- Content -->
        <div class="modal-content">
          <svg ref="svgRef" class="markmap-canvas"></svg>

          <!-- Floating Toolbar -->
          <div class="floating-toolbar glass-panel">
            <button class="tool-btn" @click="handleZoomIn" title="放大">
              <ZoomIn :size="18" />
            </button>
            <button class="tool-btn" @click="handleZoomOut" title="缩小">
              <ZoomOut :size="18" />
            </button>
            <button class="tool-btn" @click="handleFit" title="自适应">
              <Maximize2 :size="18" />
            </button>
            <div class="tool-divider"></div>
            <button class="tool-btn accent" @click="downloadSvg" title="下载 SVG">
              <Download :size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mindmap-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 2000;
  display: flex;
  align-items: flex-start; /* 改为 flex-start 靠上显示 */
  justify-content: center;
  padding: 5vh 2vw 2vw; /* 增加顶部间距 5vh */
}

.mindmap-modal-container {
  width: 95vw;
  height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  position: relative;
  background: rgba(15, 17, 26, 0.95);
}

.modal-header {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.mindmap-badge {
  background: var(--accent-color);
  color: white;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.modal-header h3 {
  font-size: 1.25rem;
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
  transition: all 0.2s ease;
  display: flex;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
  transform: rotate(90deg);
}

.modal-content {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 30px 30px;
}

.markmap-canvas {
  width: 100%;
  height: 100%;
}

.floating-toolbar {
  position: absolute;
  bottom: 24px;
  right: 24px;
  display: flex;
  gap: 8px;
  padding: 8px;
  background: rgba(25, 28, 41, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
}

.tool-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent-color);
}

.tool-btn.accent:hover {
  background: var(--accent-color);
  color: white;
}

.tool-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  align-self: center;
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

</style>

<style>
/*
  必须使用非 scoped 样式，因为 Markmap 渲染的 SVG 是动态生成的，
  Scoped CSS 的 data-v 属性属性无法应用到这些深层节点上。
*/
.markmap-canvas .markmap-node-text,
.markmap-canvas .markmap-foreign {
  fill: #ffffff !important;
  color: #ffffff !important;
  font-weight: 300 !important;
  font-size: 12px !important;
}

.markmap-canvas .markmap-foreign * {
  color: #ffffff !important;
}

.markmap-canvas .markmap-link {
  stroke-opacity: 0.9 !important;
}

.markmap-canvas .markmap-circle {
  fill: #111827 !important;
}
</style>
