import type { Prisma, PrismaClient } from '@prisma/client';
import type { StorybookDraft, StorybookDraftPage, StorybookVocabularyItem } from './types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

interface TranscriptCueSegment {
  text: string;
  translatedText?: string | null;
  offset: number;
  duration: number;
  sortOrder?: number;
}

interface GlossaryItem {
  english: string;
  chinese: string;
  phonetic?: string;
  type?: 'word' | 'phrase';
}

function getEffectiveCueText(cue: {
  text: string;
  translatedText?: string | null;
  overrideText?: string | null;
  overrideTranslatedText?: string | null;
}) {
  return {
    text: cue.overrideText ?? cue.text,
    translatedText: cue.overrideTranslatedText ?? cue.translatedText ?? undefined,
  };
}

const TARGET_SCENE_DURATION_MS = 18000;
const MAX_SCENE_DURATION_MS = 32000;
const TARGET_SCENE_LINES = 3;
const MAX_SCENE_LINES = 5;
const TARGET_ZH_CHARS = 120;
const TARGET_EN_WORDS = 60;

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'before', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'get',
  'got', 'had', 'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'just', 'like', 'look', 'me', 'more', 'my', 'need', 'now', 'of', 'on', 'one',
  'or', 'our', 'out', 'really', 'said', 'say', 'see', 'she', 'so', 'some', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'up', 'us', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you',
  'your',
]);

function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .trim();
}

function formatMsLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function countWords(text: string): number {
  return cleanText(text)
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function hasSentenceEnding(text: string): boolean {
  return /[.?!。？！…]$/.test(cleanText(text));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildParagraph(lines: string[], maxLength: number): string {
  const uniqueLines = lines
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line, index, array) => index === 0 || line !== array[index - 1]);

  return truncateText(cleanText(uniqueLines.join(' ')), maxLength);
}

function buildSceneTitle(zhText: string, enText: string, pageIndex: number): string {
  const zhCandidate = cleanText(zhText)
    .split(/[。！？!?，,；;]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 4);

  if (zhCandidate) {
    return truncateText(zhCandidate, 16);
  }

  const englishWords = cleanText(enText)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  if (englishWords.length > 0) {
    return englishWords.join(' ');
  }

  return `故事页 ${pageIndex}`;
}

function chooseLayoutHint(zhText: string, enText: string): StorybookDraftPage['layoutHint'] {
  if (zhText.length <= 42 && enText.length <= 80) return 'caption-focus';
  if (zhText.length >= 88 || enText.length >= 150) return 'split-layout';
  return 'full-bleed';
}

function chooseVisualTone(zhText: string, enText: string): string {
  const normalized = `${zhText} ${enText}`.toLowerCase();

  if (/(first time|第一次|初次|陌生|new|unknown)/.test(normalized)) {
    return 'curious and exploratory';
  }
  if (/(family|together|一起|家人|朋友)/.test(normalized)) {
    return 'warm and intimate';
  }
  if (/(train|subway|station|bus|street|city|地铁|车站|街道|城市)/.test(normalized)) {
    return 'urban documentary';
  }
  if (/(happy|excited|开心|兴奋|惊喜)/.test(normalized)) {
    return 'bright and uplifting';
  }
  return 'calm illustrated documentary';
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function extractVocabulary(englishText: string, glossary: GlossaryItem[]): StorybookVocabularyItem[] {
  const normalizedText = cleanText(englishText).toLowerCase();
  const wordsInScene = new Set(
    normalizedText
      .split(/[^a-zA-Z']+/)
      .map((word) => normalizeWord(word))
      .filter(Boolean)
  );

  const glossaryMatches = glossary.filter((item) => {
    const normalizedEnglish = cleanText(item.english).toLowerCase();
    if (!normalizedEnglish) return false;

    if (normalizedEnglish.includes(' ')) {
      return normalizedText.includes(normalizedEnglish);
    }

    return wordsInScene.has(normalizeWord(normalizedEnglish));
  });

  if (glossaryMatches.length > 0) {
    return glossaryMatches.slice(0, 3).map((item) => ({
      english: item.english,
      chinese: item.chinese,
      phonetic: item.phonetic,
      source: 'glossary',
    }));
  }

  const derivedWords = Array.from(wordsInScene)
    .filter((word) => word.length >= 4 && word.length <= 14 && !STOP_WORDS.has(word))
    .slice(0, 3);

  return derivedWords.map((word) => ({
    english: word,
    chinese: '',
    source: 'derived',
  }));
}

function buildScenes(segments: TranscriptCueSegment[]): TranscriptCueSegment[][] {
  const scenes: TranscriptCueSegment[][] = [];
  let currentScene: TranscriptCueSegment[] = [];

  for (const segment of segments) {
    if (currentScene.length === 0) {
      currentScene.push(segment);
      continue;
    }

    const sceneStart = currentScene[0]?.offset ?? segment.offset;
    const projectedDuration = (segment.offset + segment.duration) - sceneStart;
    const projectedLines = currentScene.length + 1;
    const projectedZhChars = currentScene.reduce((sum, item) => (
      sum + cleanText(item.translatedText || '').length
    ), cleanText(segment.translatedText || '').length);
    const projectedEnWords = currentScene.reduce((sum, item) => (
      sum + countWords(item.text)
    ), countWords(segment.text));
    const previous = currentScene[currentScene.length - 1];
    const hasNaturalPause = previous
      ? segment.offset - (previous.offset + previous.duration) > 1200
      : false;
    const previousHasEnding = previous ? hasSentenceEnding(previous.translatedText || previous.text) : false;

    const shouldSplit = (
      projectedLines > MAX_SCENE_LINES
      || projectedDuration > MAX_SCENE_DURATION_MS
      || (projectedLines > TARGET_SCENE_LINES && projectedZhChars > TARGET_ZH_CHARS)
      || (projectedLines > TARGET_SCENE_LINES && projectedEnWords > TARGET_EN_WORDS)
      || (
        projectedLines > TARGET_SCENE_LINES
        && projectedDuration >= TARGET_SCENE_DURATION_MS
        && (hasNaturalPause || previousHasEnding)
      )
    );

    if (shouldSplit) {
      scenes.push(currentScene);
      currentScene = [segment];
      continue;
    }

    currentScene.push(segment);
  }

  if (currentScene.length > 0) {
    scenes.push(currentScene);
  }

  return scenes;
}

function parseGlossary(keywordGlossary: Prisma.JsonValue | null): GlossaryItem[] {
  if (!Array.isArray(keywordGlossary)) return [];

  const results: GlossaryItem[] = [];
  for (const item of keywordGlossary) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const english = cleanText(String(record.english || ''));
      const chinese = cleanText(String(record.chinese || ''));

      if (english && chinese) {
        results.push({
          english,
          chinese,
          phonetic: cleanText(String(record.phonetic || '')) || undefined,
          type: record.type === 'phrase' ? 'phrase' : 'word',
        });
      }
    }
  }
  return results;
}

export async function buildStorybookDraft(
  prisma: DbClient,
  videoId: string
): Promise<StorybookDraft | null> {
  const video = await prisma.video.findUnique({
    where: { videoId },
    select: {
      videoId: true,
      title: true,
      keywordGlossary: true,
    },
  });

  if (!video) {
    return null;
  }

  const cues = await prisma.subtitleCue.findMany({
    where: { videoId },
    orderBy: { sortOrder: 'asc' },
    select: {
      text: true,
      translatedText: true,
      overrideText: true,
      overrideTranslatedText: true,
      offset: true,
      duration: true,
      sortOrder: true,
    },
  });

  const transcript: TranscriptCueSegment[] = cues.length > 0
    ? cues.map((cue) => {
      const effective = getEffectiveCueText(cue);
      return {
        text: effective.text,
        translatedText: effective.translatedText,
        offset: cue.offset,
        duration: cue.duration,
        sortOrder: cue.sortOrder,
      };
    })
    : await prisma.subtitle.findMany({
      where: { videoId },
      orderBy: { sortOrder: 'asc' },
      select: {
        text: true,
        translatedText: true,
        offset: true,
        duration: true,
        sortOrder: true,
      },
    });

  const usableSegments = transcript.filter((segment) => cleanText(segment.text || segment.translatedText || ''));

  if (usableSegments.length === 0) {
    return {
      videoId,
      videoTitle: video.title || videoId,
      source: 'subtitle-cues',
      generatedAt: new Date().toISOString(),
      cover: {
        title: video.title || videoId,
        subtitle: '画册草稿',
        summary: '当前视频还没有可用于排版的字幕 cues。',
      },
      stats: {
        totalPages: 0,
        totalCues: 0,
        totalDurationMs: 0,
        bilingualPages: 0,
      },
      pages: [],
    };
  }

  const scenes = buildScenes(usableSegments);
  const glossary = parseGlossary(video.keywordGlossary);
  const totalDurationMs = usableSegments.length > 0
    ? (usableSegments[usableSegments.length - 1]!.offset + usableSegments[usableSegments.length - 1]!.duration)
    : 0;

  const pages = scenes.map((scene, index) => {
    const zhParagraph = buildParagraph(
      scene.map((segment) => segment.translatedText || segment.text),
      140
    );
    const enParagraph = buildParagraph(
      scene.map((segment) => segment.text),
      260
    );
    const sceneTitle = buildSceneTitle(zhParagraph, enParagraph, index + 1);
    const visualTone = chooseVisualTone(zhParagraph, enParagraph);
    const startOffset = scene[0]?.offset ?? 0;
    const lastSegment = scene[scene.length - 1];
    const endOffset = lastSegment ? lastSegment.offset + lastSegment.duration : startOffset;
    const vocabulary = extractVocabulary(enParagraph, glossary);
    const layoutHint = chooseLayoutHint(zhParagraph, enParagraph);

    return {
      pageIndex: index + 1,
      sceneTitle,
      timeRange: {
        startMs: startOffset,
        endMs: endOffset,
        startLabel: formatMsLabel(startOffset),
        endLabel: formatMsLabel(endOffset),
      },
      sourceCueRange: {
        startSortOrder: scene[0]?.sortOrder ?? index,
        endSortOrder: lastSegment?.sortOrder ?? index,
        cueCount: scene.length,
      },
      readingTextZh: zhParagraph,
      readingTextEn: enParagraph,
      anchorQuoteZh: truncateText(cleanText(scene[0]?.translatedText || scene[0]?.text || ''), 56),
      anchorQuoteEn: truncateText(cleanText(scene[0]?.text || ''), 100),
      vocabulary,
      layoutHint,
      visualTone,
      imagePrompt: [
        video.title || videoId,
        sceneTitle,
        visualTone,
        'storybook keyframe reference, keep the original scene and character relationship',
      ].filter(Boolean).join(', '),
    } satisfies StorybookDraftPage;
  });

  return {
    videoId,
    videoTitle: video.title || videoId,
    source: 'subtitle-cues',
    generatedAt: new Date().toISOString(),
    cover: {
      title: video.title || '未命名视频',
      subtitle: '基于现有翻译 cues 自动拆分的画册草稿',
      summary: pages.length > 0
        ? `当前草稿共 ${pages.length} 页，建议先人工微调页标题、主文案和配图，再进入正式排版。`
        : '当前视频还没有生成可阅读的画册页草稿。',
    },
    stats: {
      totalPages: pages.length,
      totalCues: usableSegments.length,
      totalDurationMs,
      bilingualPages: pages.filter((page) => Boolean(page.readingTextZh && page.readingTextEn)).length,
    },
    pages,
  };
}
