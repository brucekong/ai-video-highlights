import type { PrismaClient, Prisma, SubtitleCue } from '@prisma/client';

const LAYOUT_VERSION = 30;

const HARD_MAX_DURATION_MS = 12000;
const SOFT_MAX_DURATION_MS = 8000;
const INCOMPLETE_TAIL_MAX_DURATION_MS = 10000;
const CONTINUATION_MAX_DURATION_MS = 10000;
const LONG_PAUSE_MS = 650;
const MAX_CHINESE_CHARS = 56;
const MAX_LATIN_CHARS = 90;
const SOURCE_KEEP_MAX_DURATION_MS = 6500;
const SOURCE_FORCE_SPLIT_SENTENCE_COUNT = 4;
const DANGLING_LEAD_MAX_GAP_MS = 3200;
const STRONG_CONTINUATION_MAX_GAP_MS = 3200;
const STRONG_CONTINUATION_MAX_DURATION_MS = 12000;
const SAME_SECOND_MERGE_MAX_GAP_MS = 1000;
const SAME_SECOND_MERGE_MAX_DURATION_MS = 6000;
const SAME_SECOND_MERGE_MAX_CHARS = 80;

const DANGLING_LEAD_PATTERNS: Record<string, RegExp> = {
  here: /^(are|is)\b/i,
  there: /^(is|are|was|were)\b/i,
  it: /^(is|was|looks|seems)\b/i,
  that: /^(is|was|looks|sounds)\b/i,
  what: /^(is|are|was|were|do|does|did)\b/i,
  how: /^(do|does|did|is|are|was|were)\b/i,
};

function countCjkChars(text: string): number {
  return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function hasSentenceEnding(text: string): boolean {
  return /[.?!。？！…]$/.test(text.trim());
}

function hasWeakContinuationEnding(text: string): boolean {
  return /[,，、;；:]$/.test(text.trim());
}

function looksIncompleteTail(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasSentenceEnding(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.toLowerCase() || '';

  return /[\u4e00-\u9fa5]$/.test(trimmed)
    || /^(i|you|he|she|we|they|it|my|your|his|her|our|their|its|this|that|these|those|the|a|an|some|any|another|to|of|for|with|on|in|at|from|into|onto|and|or|but|so|because|what|which|who|when|where|why|how|is|are|am|was|were|do|does|did|can|could|should|would|will|shall|have|has|had)$/.test(lastWord);
}

function endsWithStrongContinuationWord(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.replace(/[.,?!;:，。？！；：…]+$/g, '').toLowerCase() || '';
  return /^(to|be|on|in|at|for|with|of|from|into|onto|about|after|before|under|over|need|needs|needed|want|wants|wanted|like|likes|liked|have|has|had|get|gets|got|make|makes|made|take|takes|took|put|puts|keep|keeps|kept|sit|sits|sat|stand|stands|stood|lie|lies|lay|the|a|an|my|your|his|her|our|their|this|that|these|those|most|more|less|another|other|only|same|next|first|last|such|each|every|any|some|no)$/.test(lastWord);
}

function isShortCompletionText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const normalized = trimmed.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  return words.length <= 4 || normalized.length <= 24;
}

function endsWithAdjectivePhrase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || hasSentenceEnding(trimmed)) return false;

  const words = trimmed
    .replace(/[.,?!;:，。？！；：…]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  if (words.length === 0) return false;

  const lastWord = words[words.length - 1] || '';
  const prevWord = words[words.length - 2] || '';
  const prevTwo = words.slice(-2).join(' ');
  const prevThree = words.slice(-3).join(' ');

  const adjectiveOrModifier = /^(perfect|good|great|nice|best|better|important|beautiful|lovely|little|big|small|right|wrong|same|next|first|last|special|fresh|clean|ready|safe|happy|sad|hungry|blue|red|green|young|old)$/.test(lastWord);
  const articlePlusAdjective = /^(the|a|an|this|that|these|those|my|your|his|her|our|their)$/.test(prevWord) && adjectiveOrModifier;
  const degreePlusAdjective = /^(very|so|too|quite|really)$/.test(prevWord) && adjectiveOrModifier;
  const fixedLeadPhrase = /^(the most|the best|such a|such an)$/.test(prevTwo) || /^(one of the)$/.test(prevThree);

  return articlePlusAdjective || degreePlusAdjective || fixedLeadPhrase;
}

function isShortNounCompletion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const normalized = trimmed
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;

  const lastWord = words[words.length - 1] || '';
  const nounLike = /^(spot|place|home|house|tree|time|day|way|idea|one|thing|door|doors|station|line|ticket|barrier|soil|sun|water|bottle|backpack|uniform|goggles|chicken|car|weekend|weekends)$/.test(lastWord);

  return nounLike || words.length <= 2;
}

function startsWithContinuation(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return /^(and|or|but|so|because|then|also|too|with|to|for|of|in|on|at|as|if|when|while|that|which|who|where|how|what|和|与|及|以及|并且|而且|但是|不过|所以|因为|然后|还|也|并|再)/.test(trimmed);
}

function hasAnyPunctuation(text: string): boolean {
  return /[.,?!，。？！、;；:：…]/.test(text.trim().slice(-1));
}

function shouldJoinWithSpace(currentText: string, nextText: string): boolean {
  const trimmedCurrent = currentText.trim();
  const trimmedNext = nextText.trim();
  if (!trimmedCurrent || !trimmedNext) return false;
  if (hasAnyPunctuation(trimmedCurrent)) return true;

  const hasLatin = /[A-Za-z]/.test(trimmedCurrent) || /[A-Za-z]/.test(trimmedNext);
  return hasLatin;
}

function getMaxChars(text: string): number {
  const cjkChars = countCjkChars(text);
  return cjkChars >= Math.max(6, text.length / 3) ? MAX_CHINESE_CHARS : MAX_LATIN_CHARS;
}

function shouldSplitSourceSubtitle(subtitle: SubtitleCueSource, textParts: string[]): boolean {
  if (textParts.length <= 1) return false;

  const fullText = (subtitle.text || '').trim();
  const totalChars = fullText.replace(/\s+/g, '').length;
  const maxChars = getMaxChars(fullText);

  // 调试断句时，优先尊重强标点形成的句子边界，而不是原始字幕块边界。
  if (textParts.some((part) => hasSentenceEnding(part))) return true;
  if (textParts.length >= SOURCE_FORCE_SPLIT_SENTENCE_COUNT) return true;
  if (subtitle.duration > SOURCE_KEEP_MAX_DURATION_MS) return true;
  if (totalChars > maxChars) return true;

  return false;
}

function shouldMergeCue(current: SubtitleCueDraft, seg: SubtitleCueSource): boolean {
  const currentText = current.text.trim();
  const nextText = (seg.text || '').trim();
  const combinedDuration = (seg.offset + seg.duration) - current.offset;
  const gapDuration = seg.offset - (current.offset + current.duration);
  const combinedText = `${currentText}${nextText}`;
  const maxChars = getMaxChars(combinedText);
  const combinedChars = combinedText.replace(/\s+/g, '').length;
  const currentLooksIncomplete = looksIncompleteTail(currentText);
  const hasContinuationSignal = hasWeakContinuationEnding(currentText) || startsWithContinuation(nextText);
  const hasStrongContinuationTail = endsWithStrongContinuationWord(currentText);
  const hasAdjectivePhraseTail = endsWithAdjectivePhrase(currentText);
  const nextLooksLikeCompletion = isShortCompletionText(nextText) || /^[a-z]/.test(nextText);
  const nextLooksLikeNounCompletion = isShortNounCompletion(nextText);
  const closeDisplayedTime = Math.abs((seg.anchorOffset ?? seg.offset) - current.offset) < 1000;

  if (combinedDuration > HARD_MAX_DURATION_MS) return false;
  if (combinedChars > maxChars) return false;

  if (hasStrongContinuationTail && nextLooksLikeCompletion) {
    return gapDuration <= STRONG_CONTINUATION_MAX_GAP_MS
      && combinedDuration <= STRONG_CONTINUATION_MAX_DURATION_MS;
  }

  if (hasAdjectivePhraseTail && nextLooksLikeNounCompletion) {
    return gapDuration <= STRONG_CONTINUATION_MAX_GAP_MS
      && combinedDuration <= STRONG_CONTINUATION_MAX_DURATION_MS;
  }

  if (
    closeDisplayedTime
    && gapDuration <= SAME_SECOND_MERGE_MAX_GAP_MS
    && combinedDuration <= SAME_SECOND_MERGE_MAX_DURATION_MS
    && combinedChars <= SAME_SECOND_MERGE_MAX_CHARS
  ) {
    return true;
  }

  if (current.lockedAfterCompletion) return false;

  const isSameSource = seg.sortOrder === current.sourceEndSortOrder;
  if (isSameSource) {
    if (hasContinuationSignal) {
      return combinedDuration <= CONTINUATION_MAX_DURATION_MS;
    }

    if (currentLooksIncomplete) {
      return combinedDuration <= INCOMPLETE_TAIL_MAX_DURATION_MS;
    }

    return !hasSentenceEnding(currentText) && combinedDuration <= SOFT_MAX_DURATION_MS;
  }

  if (gapDuration > LONG_PAUSE_MS) return false;

  if (hasContinuationSignal) {
    return combinedDuration <= CONTINUATION_MAX_DURATION_MS;
  }

  if (currentLooksIncomplete) {
    return combinedDuration <= INCOMPLETE_TAIL_MAX_DURATION_MS;
  }

  if (!hasSentenceEnding(currentText)) {
    return combinedDuration <= SOFT_MAX_DURATION_MS;
  }

  return false;
}

function joinCueText(currentText: string, nextText: string): string {
  const trimmedCurrent = currentText.trim();
  const trimmedNext = nextText.trim();
  if (!trimmedCurrent) return trimmedNext;
  if (!trimmedNext) return trimmedCurrent;

  const separator = shouldJoinWithSpace(trimmedCurrent, trimmedNext) ? ' ' : '';
  return `${trimmedCurrent}${separator}${trimmedNext}`.trim();
}

export interface SubtitleCueSource {
  text: string;
  translatedText?: string | null;
  offset: number;
  duration: number;
  sortOrder: number;
  anchorOffset?: number;
}

function splitTextIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const protectedText = trimmed
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\./gi, '$1<prd>');
  const parts = protectedText.match(/[^.?!。？！…]+[.?!。？！…]?/g) || [protectedText];
  return parts
    .map((part) => part.replace(/<prd>/g, '.').trim())
    .filter(Boolean);
}

function distributeDuration(totalDuration: number, parts: string[]): number[] {
  if (parts.length === 0) return [];
  if (totalDuration <= 0) return parts.map(() => 0);
  const weights = parts.map((part) => Math.max(part.replace(/\s+/g, '').length, 1));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  let assigned = 0;
  return parts.map((_, index) => {
    if (index === parts.length - 1) {
      return Math.max(totalDuration - assigned, 0);
    }
    const duration = Math.max(1, Math.round((totalDuration * weights[index]) / weightSum));
    assigned += duration;
    return duration;
  });
}

function moveDanglingLeadWord(prevText: string, nextText: string): { prevText: string; nextText: string } | null {
  const trimmedPrev = prevText.trim();
  const trimmedNext = nextText.trim();
  if (!trimmedPrev || !trimmedNext) return null;

  const leadMatch = trimmedPrev.match(/\b(Here|There|It|That|What|How)$/i);
  if (!leadMatch) return null;

  const leadWord = leadMatch[1];
  const nextPattern = DANGLING_LEAD_PATTERNS[leadWord.toLowerCase()];
  if (!nextPattern || !nextPattern.test(trimmedNext)) return null;

  const movedPrev = trimmedPrev.slice(0, leadMatch.index).trim();
  if (!movedPrev || !/[.?!。？！…,:;]$/.test(movedPrev)) return null;

  return {
    prevText: movedPrev,
    nextText: `${leadWord} ${trimmedNext}`.trim(),
  };
}

function rebalanceDanglingLeadIns(subtitles: SubtitleCueSource[]): SubtitleCueSource[] {
  const adjusted = subtitles.map((subtitle) => ({ ...subtitle }));

  for (let index = 0; index < adjusted.length - 1; index += 1) {
    const current = adjusted[index];
    const next = adjusted[index + 1];
    const gapDuration = next.offset - (current.offset + current.duration);

    if (gapDuration > DANGLING_LEAD_MAX_GAP_MS) continue;

    const moved = moveDanglingLeadWord(current.text || '', next.text || '');
    if (!moved) continue;

    current.text = moved.prevText;
    next.text = moved.nextText;
  }

  return adjusted;
}

function expandSubtitleSources(subtitles: SubtitleCueSource[]): SubtitleCueSource[] {
  return subtitles.flatMap((subtitle, index) => {
    const textParts = splitTextIntoSentences(subtitle.text || '');
    if (!shouldSplitSourceSubtitle(subtitle, textParts)) {
      return [subtitle];
    }

    const nextSubtitle = subtitles[index + 1];
    const translatedParts = splitTextIntoSentences(subtitle.translatedText || '');
    const partDurations = distributeDuration(subtitle.duration, textParts);
    const anchorWindowDuration = nextSubtitle
      ? Math.max(1, Math.min(subtitle.duration, nextSubtitle.offset - subtitle.offset))
      : subtitle.duration;
    const partAnchorDurations = distributeDuration(anchorWindowDuration, textParts);
    let runningOffset = subtitle.offset;
    let runningAnchorOffset = subtitle.anchorOffset ?? subtitle.offset;

    return textParts.map((textPart, index) => {
      const duration = partDurations[index] ?? 0;
      const anchorDuration = partAnchorDurations[index] ?? duration;
      const part: SubtitleCueSource = {
        ...subtitle,
        text: textPart,
        translatedText: translatedParts.length === textParts.length
          ? translatedParts[index]
          : (index === 0 ? subtitle.translatedText : undefined),
        offset: runningOffset,
        duration,
        anchorOffset: runningAnchorOffset,
      };
      runningOffset += duration;
      runningAnchorOffset += anchorDuration;
      return part;
    });
  });
}

interface SubtitleCueDraft {
  text: string;
  translatedText?: string;
  overrideText?: string | null;
  overrideTranslatedText?: string | null;
  offset: number;
  duration: number;
  sortOrder: number;
  sourceStartSortOrder: number;
  sourceEndSortOrder: number;
  layoutVersion: number;
  lockedAfterCompletion?: boolean;
}

export function buildSubtitleCues(subtitles: SubtitleCueSource[]): SubtitleCueDraft[] {
  const normalized = expandSubtitleSources(rebalanceDanglingLeadIns(subtitles))
    .filter((s) => (s.text || '').trim() || (s.translatedText || '').trim())
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.offset - b.offset;
    });

  if (normalized.length === 0) return [];

  const merged: SubtitleCueDraft[] = [];
  let current: SubtitleCueDraft | null = null;

  for (const seg of normalized) {
    if (!current) {
      current = {
        text: (seg.text || '').trim(),
        translatedText: seg.translatedText?.trim() || undefined,
        offset: seg.anchorOffset ?? seg.offset,
        duration: seg.duration,
        sortOrder: 0,
        sourceStartSortOrder: seg.sortOrder,
        sourceEndSortOrder: seg.sortOrder,
        layoutVersion: LAYOUT_VERSION,
        lockedAfterCompletion: false,
      };
      continue;
    }

    if (!shouldMergeCue(current, seg)) {
      merged.push(current);
      current = {
        text: (seg.text || '').trim(),
        translatedText: seg.translatedText?.trim() || undefined,
        offset: seg.anchorOffset ?? seg.offset,
        duration: seg.duration,
        sortOrder: 0,
        sourceStartSortOrder: seg.sortOrder,
        sourceEndSortOrder: seg.sortOrder,
        layoutVersion: LAYOUT_VERSION,
        lockedAfterCompletion: false,
      };
      continue;
    }

    const wasIncompleteBeforeMerge = looksIncompleteTail(current.text.trim()) || endsWithStrongContinuationWord(current.text.trim());
    current.text = joinCueText(current.text, seg.text || '');

    if (seg.translatedText?.trim()) {
      current.translatedText = joinCueText(current.translatedText || '', seg.translatedText);
    }

    current.offset = Math.min(current.offset, seg.anchorOffset ?? seg.offset);
    current.duration = (seg.offset + seg.duration) - current.offset;
    current.sourceEndSortOrder = seg.sortOrder;
    if (wasIncompleteBeforeMerge && hasSentenceEnding((seg.text || '').trim())) {
      current.lockedAfterCompletion = true;
    }
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

function hasCueOverride(cue: Pick<SubtitleCue, 'overrideText' | 'overrideTranslatedText'>): boolean {
  return cue.overrideText !== null
    || cue.overrideTranslatedText !== null;
}

function getEffectiveCueText(
  cue: {
    text: string;
    translatedText?: string | null;
    overrideText?: string | null;
    overrideTranslatedText?: string | null;
  }
) {
  return {
    text: cue.overrideText ?? cue.text,
    translatedText: cue.overrideTranslatedText ?? cue.translatedText ?? undefined,
  };
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return !(endA < startB || endB < startA);
}

function joinCueTexts(texts: Array<string | null | undefined>): string | undefined {
  let current = '';

  texts.forEach((text) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    current = current ? joinCueText(current, trimmed) : trimmed;
  });

  return current || undefined;
}

function applyCueOverrides(
  generatedCues: SubtitleCueDraft[],
  existingCues: SubtitleCue[],
  subtitles: SubtitleCueSource[],
): SubtitleCueDraft[] {
  const overrides = existingCues
    .filter(hasCueOverride)
    .sort((a, b) => {
      if (a.sourceStartSortOrder !== b.sourceStartSortOrder) {
        return a.sourceStartSortOrder - b.sourceStartSortOrder;
      }
      return a.sourceEndSortOrder - b.sourceEndSortOrder;
    });

  if (overrides.length === 0) {
    return generatedCues.map((cue) => ({
      ...cue,
      overrideText: null,
      overrideTranslatedText: null,
    }));
  }

  const subtitleBySortOrder = new Map(subtitles.map((subtitle) => [subtitle.sortOrder, subtitle]));
  let nextCues: SubtitleCueDraft[] = generatedCues.map((cue) => ({
    ...cue,
    overrideText: null,
    overrideTranslatedText: null,
  }));

  for (const overrideCue of overrides) {
    const overlapping = nextCues.filter((cue) =>
      rangesOverlap(
        cue.sourceStartSortOrder,
        cue.sourceEndSortOrder,
        overrideCue.sourceStartSortOrder,
        overrideCue.sourceEndSortOrder,
      )
    );

    nextCues = nextCues.filter((cue) =>
      !rangesOverlap(
        cue.sourceStartSortOrder,
        cue.sourceEndSortOrder,
        overrideCue.sourceStartSortOrder,
        overrideCue.sourceEndSortOrder,
      )
    );

    const startSubtitle = subtitleBySortOrder.get(overrideCue.sourceStartSortOrder);
    const endSubtitle = subtitleBySortOrder.get(overrideCue.sourceEndSortOrder);
    const generatedText = joinCueTexts(overlapping.map((cue) => cue.text));
    const generatedTranslatedText = joinCueTexts(overlapping.map((cue) => cue.translatedText));
    const effectiveText = overrideCue.overrideText ?? generatedText ?? overrideCue.text;
    const effectiveTranslatedText = overrideCue.overrideTranslatedText ?? generatedTranslatedText ?? overrideCue.translatedText ?? undefined;
    const offset = startSubtitle?.offset ?? overlapping[0]?.offset ?? overrideCue.offset;
    const duration = endSubtitle
      ? (endSubtitle.offset + endSubtitle.duration) - offset
      : overlapping.length > 0
        ? Math.max((overlapping[overlapping.length - 1].offset + overlapping[overlapping.length - 1].duration) - offset, 1)
        : overrideCue.duration;

    nextCues.push({
      text: effectiveText.trim(),
      translatedText: effectiveTranslatedText?.trim() || undefined,
      overrideText: overrideCue.overrideText,
      overrideTranslatedText: overrideCue.overrideTranslatedText,
      offset,
      duration,
      sortOrder: 0,
      sourceStartSortOrder: overrideCue.sourceStartSortOrder,
      sourceEndSortOrder: overrideCue.sourceEndSortOrder,
      layoutVersion: LAYOUT_VERSION,
      lockedAfterCompletion: false,
    });
  }

  return nextCues
    .sort((a, b) => {
      if (a.sourceStartSortOrder !== b.sourceStartSortOrder) {
        return a.sourceStartSortOrder - b.sourceStartSortOrder;
      }
      if (a.offset !== b.offset) return a.offset - b.offset;
      return a.sourceEndSortOrder - b.sourceEndSortOrder;
    })
    .map((cue, index) => ({
      ...cue,
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

  const existingCues = await prisma.subtitleCue.findMany({
    where: { videoId },
    orderBy: { sortOrder: 'asc' },
  });

  const cues = applyCueOverrides(buildSubtitleCues(subtitles), existingCues, subtitles);

  await prisma.subtitleCue.deleteMany({ where: { videoId } });

  if (cues.length > 0) {
    await prisma.subtitleCue.createMany({
      data: cues.map((cue) => ({
        videoId,
        text: cue.text,
        translatedText: cue.translatedText || null,
        overrideText: cue.overrideText ?? null,
        overrideTranslatedText: cue.overrideTranslatedText ?? null,
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

  const validCues = cues.length > 0 && cues.every((cue) => cue.layoutVersion === LAYOUT_VERSION)
    ? cues
    : await rebuildSubtitleCuesForVideo(prisma, videoId);

  if (validCues.length > 0) {
    return validCues.map((cue) => ({
      text: getEffectiveCueText(cue).text,
      translatedText: getEffectiveCueText(cue).translatedText,
      offset: cue.offset,
      duration: cue.duration,
      sortOrder: cue.sortOrder,
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
    sortOrder: subtitle.sortOrder,
    sourceIndices: [subtitle.sortOrder],
  }));
}
