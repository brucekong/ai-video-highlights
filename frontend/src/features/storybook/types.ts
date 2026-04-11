export interface StorybookVocabularyItem {
  english: string;
  chinese: string;
  phonetic?: string;
  source: 'glossary' | 'derived';
}

export interface StorybookDraftPage {
  pageIndex: number;
  sceneTitle: string;
  timeRange: {
    startMs: number;
    endMs: number;
    startLabel: string;
    endLabel: string;
  };
  sourceCueRange: {
    startSortOrder: number;
    endSortOrder: number;
    cueCount: number;
  };
  readingTextZh: string;
  readingTextEn: string;
  anchorQuoteZh: string;
  anchorQuoteEn: string;
  vocabulary: StorybookVocabularyItem[];
  layoutHint: 'full-bleed' | 'split-layout' | 'caption-focus';
  visualTone: string;
  imagePrompt: string;
}

export interface StorybookDraft {
  videoId: string;
  videoTitle: string;
  source: 'subtitle-cues';
  generatedAt: string;
  cover: {
    title: string;
    subtitle: string;
    summary: string;
  };
  stats: {
    totalPages: number;
    totalCues: number;
    totalDurationMs: number;
    bilingualPages: number;
  };
  pages: StorybookDraftPage[];
}
