import type { PrismaClient, Prisma } from '@prisma/client';

const LAYOUT_VERSION = 2;

export interface SubtitleCueSource {
  text: string;
  translatedText?: string | null;
  offset: number;
  duration: number;
  sortOrder: number;
}

interface SubtitleCueDraft {
  text: string;
  translatedText?: string;
  offset: number;
  duration: number;
  sortOrder: number;
  sourceStartSortOrder: number;
  sourceEndSortOrder: number;
  layoutVersion: number;
}

function measureSubtitleWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += 0.5;
    } else if (/[\u4e00-\u9fa5]/.test(char)) {
      width += 2;
    } else if (/[A-Z]/.test(char)) {
      width += 1.15;
    } else {
      width += 1;
    }
  }
  return width;
}

function isConnectorWord(word: string): boolean {
  return /^(a|an|the|to|of|in|on|at|for|from|by|and|or|but|so|if|is|am|are|was|were|be|been|being|it|it's|its|you|your|we|our|they|their|he|she|that|this|these|those|behind|under|over|with)$/i.test(word);
}

function layoutEnglishText(text: string, maxWidth: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  if (measureSubtitleWidth(normalized) <= maxWidth) return normalized;

  const words = normalized.split(' ');
  if (words.length < 4) return normalized;

  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length - 1; i++) {
    const first = words.slice(0, i).join(' ');
    const second = words.slice(i).join(' ');
    const firstWidth = measureSubtitleWidth(first);
    const secondWidth = measureSubtitleWidth(second);

    if (firstWidth > maxWidth * 1.25 || secondWidth > maxWidth * 1.25) {
      continue;
    }

    let score = Math.abs(firstWidth - secondWidth);
    if (firstWidth < maxWidth * 0.35 || secondWidth < maxWidth * 0.35) {
      score += 10;
    }
    if (isConnectorWord(words[i - 1])) {
      score += 6;
    }
    if (isConnectorWord(words[i])) {
      score += 6;
    }
    if (/[,:;]$/.test(words[i - 1])) {
      score -= 1.5;
    }
    if (/[.?!]$/.test(words[i - 1])) {
      score += 4;
    }

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    return normalized;
  }

  return `${words.slice(0, bestIndex).join(' ')}\n${words.slice(bestIndex).join(' ')}`;
}

function layoutChineseText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, '').trim();
  if (!normalized || normalized.length <= maxChars) return normalized;

  const midpoint = Math.floor(normalized.length / 2);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 2; i < normalized.length - 1; i++) {
    const first = normalized.slice(0, i);
    const second = normalized.slice(i);
    if (first.length > maxChars * 1.4 || second.length > maxChars * 1.4) {
      continue;
    }

    let score = Math.abs(i - midpoint);
    if (/[，。！？；：,.!?]$/.test(first)) {
      score += 3;
    }
    if (/^[，。！？；：,.!?]/.test(second)) {
      score += 6;
    }

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) {
    bestIndex = Math.min(maxChars, normalized.length - 1);
  }

  return `${normalized.slice(0, bestIndex)}\n${normalized.slice(bestIndex)}`;
}

function applyCueLayout(text: string | undefined): string | undefined {
  if (!text) return text;
  const normalized = text.trim();
  if (!normalized) return normalized;

  const isMostlyChinese = (normalized.match(/[\u4e00-\u9fa5]/g) || []).length >= Math.max(4, Math.floor(normalized.length / 3));
  return isMostlyChinese
    ? layoutChineseText(normalized, 18)
    : layoutEnglishText(normalized, 34);
}

export function buildSubtitleCues(subtitles: SubtitleCueSource[]): SubtitleCueDraft[] {
  const normalized = subtitles
    .filter((s) => (s.text || '').trim() || (s.translatedText || '').trim())
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (normalized.length === 0) return [];

  const merged: SubtitleCueDraft[] = [];
  let current: SubtitleCueDraft | null = null;

  for (const seg of normalized) {
    if (!current) {
      current = {
        text: (seg.text || '').trim(),
        translatedText: seg.translatedText?.trim() || undefined,
        offset: seg.offset,
        duration: seg.duration,
        sortOrder: 0,
        sourceStartSortOrder: seg.sortOrder,
        sourceEndSortOrder: seg.sortOrder,
        layoutVersion: LAYOUT_VERSION,
      };
      continue;
    }

    const lastChar = current.text.trim().slice(-1);
    const hasEndingPunctuation = /[.?!。？！]/.test(lastChar);
    const currentDuration = current.duration || 0;
    const combinedDuration = (seg.offset + seg.duration) - current.offset;

    let shouldMerge = false;
    if (!hasEndingPunctuation) {
      shouldMerge = combinedDuration < 28000;
    } else {
      shouldMerge = currentDuration < 3500 && combinedDuration < 10000;
    }

    if (!shouldMerge) {
      merged.push(current);
      current = {
        text: (seg.text || '').trim(),
        translatedText: seg.translatedText?.trim() || undefined,
        offset: seg.offset,
        duration: seg.duration,
        sortOrder: 0,
        sourceStartSortOrder: seg.sortOrder,
        sourceEndSortOrder: seg.sortOrder,
        layoutVersion: LAYOUT_VERSION,
      };
      continue;
    }

    const isChinese = /[\u4e00-\u9fa5]/.test(seg.text);
    const lastTextChar = current.text.trim().slice(-1);
    const hasAnyPunctuation = /[.,?!，。？！、;；]/.test(lastTextChar);
    const textSep = hasAnyPunctuation ? ' ' : (isChinese ? '，' : ' ');
    current.text = `${current.text.trim()}${textSep}${(seg.text || '').trim()}`.trim();

    if (seg.translatedText?.trim()) {
      const lastTransChar = (current.translatedText || '').trim().slice(-1);
      const hasTransPunctuation = /[.,?!，。？！、;；]/.test(lastTransChar);
      const transSep = current.translatedText && !hasTransPunctuation ? '，' : '';
      current.translatedText = `${(current.translatedText || '').trim()}${transSep}${seg.translatedText.trim()}`.trim();
    }

    current.duration = combinedDuration;
    current.sourceEndSortOrder = seg.sortOrder;
  }

  if (current) {
    merged.push(current);
  }

  return merged.map((cue, index) => ({
    ...cue,
    text: applyCueLayout(cue.text) || cue.text,
    translatedText: applyCueLayout(cue.translatedText) || cue.translatedText,
    sortOrder: index,
  }));
}

export async function rebuildSubtitleCuesForVideo(
  prisma: PrismaClient | Prisma.TransactionClient,
  videoId: string
) {
  const subtitles = await prisma.subtitle.findMany({
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

  const cues = buildSubtitleCues(subtitles);

  await prisma.subtitleCue.deleteMany({ where: { videoId } });

  if (cues.length > 0) {
    await prisma.subtitleCue.createMany({
      data: cues.map((cue) => ({
        videoId,
        text: cue.text,
        translatedText: cue.translatedText || null,
        offset: cue.offset,
        duration: cue.duration,
        sortOrder: cue.sortOrder,
        sourceStartSortOrder: cue.sourceStartSortOrder,
        sourceEndSortOrder: cue.sourceEndSortOrder,
        layoutVersion: cue.layoutVersion,
      })),
    });
  }

  return cues;
}

export async function getPreferredTranscriptForVideo(
  prisma: PrismaClient | Prisma.TransactionClient,
  videoId: string
) {
  const cues = await prisma.subtitleCue.findMany({
    where: { videoId },
    orderBy: { sortOrder: 'asc' },
  });

  if (cues.length > 0) {
    return cues.map((cue) => ({
      text: cue.text,
      translatedText: cue.translatedText,
      offset: cue.offset,
      duration: cue.duration,
      sourceIndices: Array.from(
        { length: cue.sourceEndSortOrder - cue.sourceStartSortOrder + 1 },
        (_, index) => cue.sourceStartSortOrder + index
      ),
    }));
  }

  const subtitles = await prisma.subtitle.findMany({
    where: { videoId },
    orderBy: { sortOrder: 'asc' },
  });

  return subtitles.map((subtitle) => ({
    text: subtitle.text,
    translatedText: subtitle.translatedText,
    offset: subtitle.offset,
    duration: subtitle.duration,
    sourceIndices: [subtitle.sortOrder],
  }));
}
