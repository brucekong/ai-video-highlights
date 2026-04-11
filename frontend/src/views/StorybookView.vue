<template>
  <div class="storybook-view animate-fade-in">
    <div class="hero-panel glass-panel">
      <div class="hero-copy">
        <p class="eyebrow">Storybook Draft</p>
        <h2>{{ draft?.cover.title || '视频画册草稿' }}</h2>
        <p class="hero-subtitle">{{ draft?.cover.subtitle || '从翻译 cues 派生的阅读版页面草稿' }}</p>
        <p class="hero-summary">{{ draft?.cover.summary || '输入一个已有分析结果的视频，即可查看自动拆页后的画册草稿。' }}</p>
      </div>

      <div class="hero-actions">
        <div class="action-stack">
          <button class="primary-action" :disabled="!draft" @click="handleDownloadHtml">
            下载 HTML
          </button>
          <button class="secondary-action" :disabled="!draft" @click="handleOpenPrintView">
            打印 / PDF
          </button>
          <button class="tertiary-action" :disabled="!sourceVideoUrl" @click="backToVideo">
            返回视频
          </button>
        </div>
        <div class="meta-card">
          <span>页数</span>
          <strong>{{ draft?.stats.totalPages ?? 0 }}</strong>
        </div>
        <div class="meta-card">
          <span>Cues</span>
          <strong>{{ draft?.stats.totalCues ?? 0 }}</strong>
        </div>
      </div>
    </div>

    <div v-if="!videoId" class="empty-state glass-panel">
      <h3>缺少视频 ID</h3>
      <p>请从视频详情页进入，或在地址栏里带上 `?videoId=...` 后再打开。</p>
    </div>

    <div v-else-if="isLoading" class="empty-state glass-panel">
      <h3>正在生成画册草稿</h3>
      <p>我们只读取现有字幕 cues 做分页整理，不会改动已有视频数据。</p>
    </div>

    <div v-else-if="errorMessage" class="empty-state glass-panel error">
      <h3>草稿加载失败</h3>
      <p>{{ errorMessage }}</p>
    </div>

    <template v-else-if="draft">
      <div class="stats-grid">
        <div class="stat-item glass-panel">
          <span>总时长</span>
          <strong>{{ formatStorybookDuration(draft.stats.totalDurationMs) }}</strong>
        </div>
        <div class="stat-item glass-panel">
          <span>双语页</span>
          <strong>{{ draft.stats.bilingualPages }}</strong>
        </div>
        <div class="stat-item glass-panel">
          <span>生成时间</span>
          <strong>{{ formatStorybookDate(draft.generatedAt) }}</strong>
        </div>
      </div>

      <div v-if="draft.pages.length === 0" class="empty-state glass-panel">
        <h3>暂时没有可用页面</h3>
        <p>这个视频还没有整理出可阅读的 cues，可以先回到视频页检查字幕解析结果。</p>
      </div>

      <div v-else class="pages-grid">
        <article v-for="page in draft.pages" :key="page.pageIndex" class="page-card">
          <div class="page-paper">
            <div class="page-head">
              <div>
                <p class="page-index">Page {{ page.pageIndex }}</p>
                <h3>{{ page.sceneTitle }}</h3>
              </div>
              <div class="page-badges">
                <span>{{ page.layoutHint }}</span>
                <span>{{ page.timeRange.startLabel }} - {{ page.timeRange.endLabel }}</span>
              </div>
            </div>

            <div class="page-body">
              <section class="reading-block">
                <label>中文主文案</label>
                <p>{{ page.readingTextZh || '待补充' }}</p>
              </section>
              <section class="reading-block">
                <label>English Copy</label>
                <p>{{ page.readingTextEn || 'Pending rewrite' }}</p>
              </section>
            </div>

            <div class="quotes-grid">
              <div class="quote-card">
                <label>锚点句</label>
                <p>{{ page.anchorQuoteZh }}</p>
              </div>
              <div class="quote-card">
                <label>Anchor Line</label>
                <p>{{ page.anchorQuoteEn }}</p>
              </div>
            </div>

            <div class="page-footer">
              <div class="vocabulary-block">
                <label>建议词汇</label>
                <div v-if="page.vocabulary.length > 0" class="vocabulary-list">
                  <div v-for="item in page.vocabulary" :key="`${page.pageIndex}-${item.english}`" class="vocabulary-chip">
                    <strong>{{ item.english }}</strong>
                    <span v-if="item.chinese">{{ item.chinese }}</span>
                    <span v-else class="muted">待补充释义</span>
                  </div>
                </div>
                <p v-else class="muted">当前页还没有匹配到词汇，可在后续编辑时补充。</p>
              </div>

              <div class="visual-block">
                <label>配图提示</label>
                <p>{{ page.imagePrompt }}</p>
                <small>
                  cues {{ page.sourceCueRange.startSortOrder }} - {{ page.sourceCueRange.endSortOrder }}
                  · {{ page.sourceCueRange.cueCount }} 条
                  · {{ page.visualTone }}
                </small>
              </div>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../services/auth';
import {
  downloadStorybookHtml,
  formatStorybookDate,
  formatStorybookDuration,
  openStorybookPrintView,
} from '../features/storybook/helpers';
import { fetchStorybookDraft } from '../features/storybook/service';
import type { StorybookDraft } from '../features/storybook/types';

const route = useRoute();
const router = useRouter();
const { getAuthHeaders } = useAuth();

const draft = ref<StorybookDraft | null>(null);
const isLoading = ref(false);
const errorMessage = ref('');

const videoId = computed(() => String(route.query.videoId || '').trim());
const sourceVideoUrl = computed(() => String(route.query.url || '').trim());

const loadDraft = async () => {
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
};

const backToVideo = () => {
  if (!sourceVideoUrl.value) return;
  router.push({
    path: '/video',
    query: {
      url: sourceVideoUrl.value,
    },
  });
};

const handleDownloadHtml = () => {
  if (!draft.value) return;
  downloadStorybookHtml(draft.value);
};

const handleOpenPrintView = () => {
  if (!videoId.value) return;
  openStorybookPrintView(router, videoId.value, sourceVideoUrl.value);
};

onMounted(loadDraft);
watch(() => videoId.value, loadDraft);
</script>

<style scoped>
.storybook-view {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 0 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  padding: 28px;
  border-radius: 24px;
  background:
    linear-gradient(135deg, rgba(255, 248, 231, 0.14), rgba(255, 214, 153, 0.08)),
    var(--bg-panel);
  border: 1px solid rgba(255, 214, 153, 0.2);
}

.eyebrow {
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #f6c37a;
  margin-bottom: 10px;
}

.hero-copy h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
  margin-bottom: 10px;
}

.hero-subtitle {
  color: #f5dfbe;
  margin-bottom: 10px;
}

.hero-summary {
  color: var(--text-secondary);
  max-width: 760px;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 180px;
}

.action-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.primary-action,
.secondary-action,
.tertiary-action {
  padding: 12px 16px;
  border-radius: 14px;
  font-weight: 700;
}

.primary-action {
  background: linear-gradient(135deg, #f0a44f, #cf6e2a);
  color: #fff;
}

.secondary-action {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #fff4de;
}

.tertiary-action {
  background: rgba(0, 0, 0, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.primary-action:disabled,
.secondary-action:disabled,
.tertiary-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.meta-card,
.stat-item,
.empty-state {
  padding: 18px 20px;
  border-radius: 18px;
}

.meta-card span,
.stat-item span,
.reading-block label,
.quote-card label,
.vocabulary-block label,
.visual-block label {
  display: block;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.meta-card strong,
.stat-item strong {
  font-size: 1.4rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.empty-state {
  text-align: center;
  background: rgba(255, 255, 255, 0.04);
}

.empty-state.error {
  border: 1px solid rgba(255, 138, 128, 0.22);
}

.empty-state h3 {
  margin-bottom: 8px;
}

.empty-state p {
  color: var(--text-secondary);
}

.pages-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.page-card {
  border-radius: 28px;
  padding: 1px;
  background: linear-gradient(135deg, rgba(255, 224, 188, 0.4), rgba(255, 255, 255, 0.06));
}

.page-paper {
  border-radius: 27px;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(255, 244, 224, 0.96), rgba(252, 247, 238, 0.92)),
    #faf6ee;
  color: #2f2416;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.page-index {
  color: #9f6f37;
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.page-head h3 {
  font-size: 1.5rem;
  line-height: 1.1;
}

.page-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.page-badges span {
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(207, 110, 42, 0.1);
  color: #8e5528;
  font-size: 0.82rem;
}

.page-body,
.quotes-grid,
.page-footer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.reading-block,
.quote-card,
.vocabulary-block,
.visual-block {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(143, 105, 54, 0.08);
}

.reading-block p,
.quote-card p,
.visual-block p {
  line-height: 1.75;
}

.vocabulary-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.vocabulary-chip {
  min-width: 140px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(240, 164, 79, 0.12);
}

.vocabulary-chip strong,
.visual-block small {
  display: block;
}

.muted {
  color: #77695a;
}

@media (max-width: 960px) {
  .hero-panel,
  .page-body,
  .quotes-grid,
  .page-footer,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .hero-actions {
    min-width: 0;
  }

  .page-head {
    flex-direction: column;
  }

  .page-badges {
    justify-content: flex-start;
  }
}
</style>
