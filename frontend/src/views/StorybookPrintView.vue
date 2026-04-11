<template>
  <div class="print-view">
    <div class="print-toolbar" v-if="draft">
      <button class="toolbar-btn" @click="printCurrentPage">打印 / 另存为 PDF</button>
      <button class="toolbar-btn secondary" :disabled="!sourceVideoUrl" @click="backToVideo">返回视频</button>
    </div>

    <div v-if="!videoId" class="empty-state">
      <h3>缺少视频 ID</h3>
      <p>请从画册预览页进入打印页。</p>
    </div>

    <div v-else-if="isLoading" class="empty-state">
      <h3>正在准备打印版画册</h3>
      <p>只读取现有字幕数据，不会改动视频内容。</p>
    </div>

    <div v-else-if="errorMessage" class="empty-state error">
      <h3>打印版加载失败</h3>
      <p>{{ errorMessage }}</p>
    </div>

    <main v-else-if="draft" class="storybook-print">
      <section class="cover-sheet">
        <p class="cover-kicker">Storybook Print</p>
        <h1>{{ draft.cover.title }}</h1>
        <p class="cover-subtitle">{{ draft.cover.subtitle }}</p>
        <p class="cover-summary">{{ draft.cover.summary }}</p>

        <div class="cover-stats">
          <div class="stat-box">
            <label>页数</label>
            <strong>{{ draft.stats.totalPages }}</strong>
          </div>
          <div class="stat-box">
            <label>Cues</label>
            <strong>{{ draft.stats.totalCues }}</strong>
          </div>
          <div class="stat-box">
            <label>总时长</label>
            <strong>{{ formatStorybookDuration(draft.stats.totalDurationMs) }}</strong>
          </div>
          <div class="stat-box">
            <label>生成时间</label>
            <strong>{{ formatStorybookDate(draft.generatedAt) }}</strong>
          </div>
        </div>
      </section>

      <section v-for="page in draft.pages" :key="page.pageIndex" class="print-sheet">
        <header class="sheet-header">
          <div>
            <p class="sheet-index">Page {{ page.pageIndex }}</p>
            <h2>{{ page.sceneTitle }}</h2>
          </div>
          <div class="sheet-badges">
            <span>{{ page.layoutHint }}</span>
            <span>{{ page.timeRange.startLabel }} - {{ page.timeRange.endLabel }}</span>
          </div>
        </header>

        <div class="sheet-grid">
          <article class="print-panel">
            <label>中文主文案</label>
            <p>{{ page.readingTextZh }}</p>
          </article>
          <article class="print-panel">
            <label>English Copy</label>
            <p>{{ page.readingTextEn }}</p>
          </article>
        </div>

        <div class="sheet-grid compact">
          <article class="print-panel">
            <label>锚点句</label>
            <p>{{ page.anchorQuoteZh }}</p>
          </article>
          <article class="print-panel">
            <label>Anchor Line</label>
            <p>{{ page.anchorQuoteEn }}</p>
          </article>
        </div>

        <div class="sheet-grid compact">
          <article class="print-panel">
            <label>建议词汇</label>
            <div v-if="page.vocabulary.length > 0" class="chip-list">
              <div v-for="item in page.vocabulary" :key="`${page.pageIndex}-${item.english}`" class="chip">
                <strong>{{ item.english }}</strong>
                <span>{{ item.chinese || '待补充释义' }}</span>
              </div>
            </div>
            <p v-else class="muted">当前页还没有匹配到词汇。</p>
          </article>
          <article class="print-panel">
            <label>配图提示</label>
            <p>{{ page.imagePrompt }}</p>
            <small>
              cues {{ page.sourceCueRange.startSortOrder }} - {{ page.sourceCueRange.endSortOrder }}
              · {{ page.sourceCueRange.cueCount }} 条
              · {{ page.visualTone }}
            </small>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../services/auth';
import { fetchStorybookDraft } from '../features/storybook/service';
import type { StorybookDraft } from '../features/storybook/types';
import { formatStorybookDate, formatStorybookDuration } from '../features/storybook/helpers';

const route = useRoute();
const router = useRouter();
const { getAuthHeaders } = useAuth();

const draft = ref<StorybookDraft | null>(null);
const isLoading = ref(false);
const errorMessage = ref('');

const videoId = computed(() => String(route.query.videoId || '').trim());
const sourceVideoUrl = computed(() => String(route.query.url || '').trim());

async function loadDraft() {
  if (!videoId.value) {
    draft.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    draft.value = await fetchStorybookDraft(videoId.value, getAuthHeaders());
  } catch (error) {
    draft.value = null;
    errorMessage.value = error instanceof Error ? error.message : '画册草稿获取失败';
  } finally {
    isLoading.value = false;
  }
}

function backToVideo() {
  if (!sourceVideoUrl.value) return;
  router.push({
    path: '/video',
    query: {
      url: sourceVideoUrl.value,
    },
  });
}

function printCurrentPage() {
  window.print();
}

onMounted(loadDraft);
watch(() => videoId.value, loadDraft);
</script>

<style scoped>
.print-view {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(214, 153, 86, 0.14), transparent 20%),
    linear-gradient(180deg, #f2ebde, #ebe1d0);
  color: #302518;
}

.print-toolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  background: rgba(245, 238, 227, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(94, 69, 38, 0.12);
}

.toolbar-btn {
  padding: 10px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #c77434, #b4531f);
  color: #fff;
  font-weight: 700;
}

.toolbar-btn.secondary {
  background: rgba(255, 255, 255, 0.65);
  color: #5a4530;
  border: 1px solid rgba(90, 69, 48, 0.14);
}

.empty-state {
  width: min(720px, calc(100% - 32px));
  margin: 40px auto;
  padding: 24px;
  border-radius: 24px;
  background: rgba(255, 251, 243, 0.86);
  border: 1px solid rgba(90, 69, 48, 0.1);
  text-align: center;
}

.empty-state.error {
  border-color: rgba(169, 68, 66, 0.18);
}

.storybook-print {
  width: min(1100px, calc(100% - 32px));
  margin: 0 auto;
  padding: 24px 0 48px;
}

.cover-sheet,
.print-sheet {
  background: rgba(255, 250, 242, 0.94);
  border: 1px solid rgba(90, 69, 48, 0.12);
  border-radius: 28px;
  box-shadow: 0 18px 50px rgba(73, 50, 22, 0.08);
}

.cover-sheet {
  padding: 30px;
  margin-bottom: 20px;
}

.cover-kicker,
.sheet-index {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: #bc692f;
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 10px;
}

.cover-sheet h1 {
  font-size: clamp(2.2rem, 5vw, 4rem);
  line-height: 0.98;
  margin-bottom: 12px;
}

.cover-subtitle,
.cover-summary {
  color: #6f604d;
}

.cover-summary {
  margin-top: 10px;
  max-width: 760px;
}

.cover-stats,
.sheet-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.cover-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 22px;
}

.stat-box,
.print-panel {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(90, 69, 48, 0.1);
}

.stat-box label,
.print-panel label {
  display: block;
  margin-bottom: 8px;
  color: #7b6a55;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.72rem;
  font-weight: 700;
}

.stat-box strong {
  font-size: 1.3rem;
}

.print-sheet {
  padding: 24px;
  margin-bottom: 18px;
  page-break-after: always;
}

.print-sheet:last-child {
  page-break-after: auto;
}

.sheet-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  margin-bottom: 16px;
}

.sheet-header h2 {
  font-size: 2rem;
  line-height: 1.04;
}

.sheet-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.sheet-badges span {
  display: inline-flex;
  align-items: center;
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(201, 108, 49, 0.1);
  color: #b35d24;
  font-size: 0.8rem;
}

.sheet-grid.compact {
  margin-top: 16px;
}

.print-panel p,
.print-panel small {
  margin: 0;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chip {
  min-width: 140px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(201, 108, 49, 0.08);
}

.chip strong,
.chip span,
.print-panel small {
  display: block;
}

.chip strong {
  margin-bottom: 4px;
}

.chip span,
.print-panel small,
.muted {
  color: #7b6a55;
}

@media (max-width: 960px) {
  .cover-stats,
  .sheet-header,
  .sheet-grid {
    grid-template-columns: 1fr;
  }

  .sheet-badges {
    justify-content: flex-start;
  }
}

@media print {
  .print-toolbar {
    display: none;
  }

  .storybook-print {
    width: 100%;
    margin: 0;
    padding: 0;
  }

  .cover-sheet,
  .print-sheet {
    box-shadow: none;
  }
}
</style>
