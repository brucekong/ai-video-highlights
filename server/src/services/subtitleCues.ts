import type { PrismaClient, Prisma } from '@prisma/client';

const LAYOUT_VERSION = 3;

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
    text: cue.text.trim(),
    translatedText: cue.translatedText?.trim() || cue.translatedText,
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
