import type { RouteLocationRaw, Router } from 'vue-router';
import type { StorybookDraft } from './types';

export function formatStorybookDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatStorybookDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getStorybookPrintRoute(
  videoId: string,
  sourceVideoUrl = ''
): RouteLocationRaw {
  return {
    path: '/storybook/print',
    query: {
      videoId,
      ...(sourceVideoUrl ? { url: sourceVideoUrl } : {}),
    },
  };
}

export function openStorybookPrintView(
  router: Router,
  videoId: string,
  sourceVideoUrl = ''
) {
  const route = router.resolve(getStorybookPrintRoute(videoId, sourceVideoUrl));
  window.open(route.href, '_blank', 'noopener,noreferrer');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildStorybookExportHtml(draft: StorybookDraft): string {
  const pageSections = draft.pages.map((page) => {
    const vocabularyHtml = page.vocabulary.length > 0
      ? page.vocabulary.map((item) => `
          <div class="chip">
            <strong>${escapeHtml(item.english)}</strong>
            <span>${escapeHtml(item.chinese || '待补充释义')}</span>
          </div>
        `).join('')
      : '<p class="muted">当前页没有匹配到词汇，建议人工补充。</p>';

    return `
      <section class="sheet">
        <div class="sheet-head">
          <div>
            <p class="page-index">Page ${page.pageIndex}</p>
            <h2>${escapeHtml(page.sceneTitle)}</h2>
          </div>
          <div class="badge-row">
            <span>${escapeHtml(page.layoutHint)}</span>
            <span>${escapeHtml(page.timeRange.startLabel)} - ${escapeHtml(page.timeRange.endLabel)}</span>
          </div>
        </div>

        <div class="copy-grid">
          <article class="panel">
            <label>中文主文案</label>
            <p>${escapeHtml(page.readingTextZh || '待补充')}</p>
          </article>
          <article class="panel">
            <label>English Copy</label>
            <p>${escapeHtml(page.readingTextEn || 'Pending rewrite')}</p>
          </article>
        </div>

        <div class="quote-grid">
          <article class="panel quote-panel">
            <label>锚点句</label>
            <p>${escapeHtml(page.anchorQuoteZh)}</p>
          </article>
          <article class="panel quote-panel">
            <label>Anchor Line</label>
            <p>${escapeHtml(page.anchorQuoteEn)}</p>
          </article>
        </div>

        <div class="footer-grid">
          <article class="panel">
            <label>建议词汇</label>
            <div class="chips">${vocabularyHtml}</div>
          </article>
          <article class="panel visual-panel">
            <label>配图提示</label>
            <p>${escapeHtml(page.imagePrompt)}</p>
            <small>cues ${page.sourceCueRange.startSortOrder} - ${page.sourceCueRange.endSortOrder} · ${page.sourceCueRange.cueCount} 条 · ${escapeHtml(page.visualTone)}</small>
          </article>
        </div>
      </section>
    `;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(draft.cover.title)} - Storybook Export</title>
    <style>
      :root {
        --bg: #f3ede2;
        --paper: #fffaf1;
        --ink: #302518;
        --muted: #7c6d5b;
        --line: rgba(90, 63, 30, 0.12);
        --accent: #c96c31;
        --accent-soft: rgba(201, 108, 49, 0.1);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(226, 161, 94, 0.24), transparent 20%),
          linear-gradient(180deg, #efe7da, var(--bg));
        color: var(--ink);
        font-family: "Georgia", "Noto Serif SC", serif;
      }
      main {
        width: min(1100px, calc(100% - 32px));
        margin: 0 auto;
        padding: 24px 0 48px;
      }
      .cover {
        padding: 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(201, 108, 49, 0.14), rgba(255, 255, 255, 0.8));
        border: 1px solid rgba(201, 108, 49, 0.12);
        margin-bottom: 24px;
      }
      .cover p,
      .cover h1 { margin: 0; }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font: 700 12px/1.4 system-ui, sans-serif;
        color: var(--accent);
        margin-bottom: 12px;
      }
      h1 {
        font-size: clamp(32px, 5vw, 56px);
        line-height: 0.98;
        margin-bottom: 10px;
      }
      .subtitle,
      .summary {
        color: var(--muted);
        font: 500 16px/1.7 system-ui, sans-serif;
      }
      .summary { margin-top: 12px; max-width: 760px; }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .stat {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid var(--line);
      }
      .stat label,
      .panel label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font: 700 11px/1.4 system-ui, sans-serif;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .stat strong {
        font: 700 22px/1.2 system-ui, sans-serif;
      }
      .sheet {
        padding: 24px;
        margin-bottom: 18px;
        border-radius: 28px;
        background: linear-gradient(180deg, rgba(255, 251, 245, 0.94), rgba(255, 247, 236, 0.92));
        border: 1px solid var(--line);
        box-shadow: 0 18px 40px rgba(76, 54, 30, 0.08);
        page-break-after: always;
      }
      .sheet:last-child { page-break-after: auto; }
      .sheet-head,
      .copy-grid,
      .quote-grid,
      .footer-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .sheet-head {
        align-items: start;
        margin-bottom: 18px;
      }
      .page-index {
        margin: 0 0 6px;
        color: var(--accent);
        font: 700 11px/1.4 system-ui, sans-serif;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h2 {
        margin: 0;
        font-size: 32px;
        line-height: 1.06;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .badge-row span {
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font: 600 12px/1.2 system-ui, sans-serif;
      }
      .panel {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.66);
        border: 1px solid var(--line);
      }
      .panel p,
      .panel small { margin: 0; }
      .panel p {
        line-height: 1.8;
        overflow-wrap: anywhere;
      }
      .quote-panel p { font-style: italic; }
      .footer-grid { margin-top: 16px; }
      .chips {
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
      .visual-panel small { display: block; }
      .chip strong {
        margin-bottom: 4px;
        font: 700 14px/1.4 system-ui, sans-serif;
      }
      .chip span,
      .visual-panel small,
      .muted {
        color: var(--muted);
        font: 500 13px/1.6 system-ui, sans-serif;
      }
      .visual-panel p { margin-bottom: 10px; }
      @media (max-width: 900px) {
        .stats,
        .sheet-head,
        .copy-grid,
        .quote-grid,
        .footer-grid {
          grid-template-columns: 1fr;
        }
        .badge-row { justify-content: flex-start; }
      }
      @media print {
        body { background: #fff; }
        main {
          width: 100%;
          margin: 0;
          padding: 0;
        }
        .cover {
          margin: 0 0 12mm;
          border: 1px solid #ddd;
        }
        .sheet {
          box-shadow: none;
          margin: 0 0 10mm;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="cover">
        <p class="eyebrow">Storybook Export</p>
        <h1>${escapeHtml(draft.cover.title)}</h1>
        <p class="subtitle">${escapeHtml(draft.cover.subtitle)}</p>
        <p class="summary">${escapeHtml(draft.cover.summary)}</p>
        <div class="stats">
          <div class="stat"><label>页数</label><strong>${draft.stats.totalPages}</strong></div>
          <div class="stat"><label>Cues</label><strong>${draft.stats.totalCues}</strong></div>
          <div class="stat"><label>总时长</label><strong>${escapeHtml(formatStorybookDuration(draft.stats.totalDurationMs))}</strong></div>
          <div class="stat"><label>生成时间</label><strong>${escapeHtml(formatStorybookDate(draft.generatedAt))}</strong></div>
        </div>
      </section>
      ${pageSections}
    </main>
  </body>
</html>`;
}

export function downloadStorybookHtml(draft: StorybookDraft) {
  const html = buildStorybookExportHtml(draft);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `${draft.videoId || 'storybook'}-storybook-export.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
