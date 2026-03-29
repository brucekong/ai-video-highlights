<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { Loader2, Sparkles, AlertCircle, FileText, Clock, Play, Send, MessageCircle, User as UserIcon, Bot, Map, Search, RefreshCw, Scissors, Edit2, Volume2 } from 'lucide-vue-next';
import YouTubePlayer from '../components/YouTubePlayer.vue';
import BilibiliPlayer from '../components/BilibiliPlayer.vue';
import MindMapModal from '../components/MindMapModal.vue';
import VideoSearchModal from '../components/VideoSearchModal.vue';
import VideoClippingDrawer from '../components/VideoClippingDrawer.vue';
import KnowledgeExportActions from '../components/KnowledgeExportActions.vue';
import AppTooltip from '../components/AppTooltip.vue';
import ConfirmActionModal from '../components/ConfirmActionModal.vue';
import ActionNoticeModal from '../components/ActionNoticeModal.vue';
import { useAuth } from '../services/auth';

const API_BASE = import.meta.env.VITE_API_URL;
const { checkLogin, waitForAuth, getAuthHeaders } = useAuth();

console.log('API_BASE====', API_BASE)
interface Takeaway {
  id: string;
  title: string;
  summary: string;
  timestamp: number;  // 秒（AI 返回的单位）
  duration: string;   // 如 "2:30"
}

interface KeywordGlossaryItem {
  english: string;
  phonetic?: string;
  chinese: string;
  type: 'word' | 'phrase';
}


interface TranscriptSegment {
  text: string;
  translatedText?: string;
  offset: number;   // 毫秒
  duration: number;  // 毫秒
  sortOrder?: number;
  sourceIndices?: number[]; // 用于追踪合并前的原始索引 / Used to track original indices before merging
  anchorOffset?: number;
}

const HARD_MAX_CUE_DURATION_MS = 12000;
const SOFT_MAX_CUE_DURATION_MS = 8000;
const INCOMPLETE_TAIL_MAX_DURATION_MS = 10000;
const CONTINUATION_MAX_DURATION_MS = 10000;
const STRONG_CONTINUATION_MAX_GAP_MS = 3200;
const STRONG_CONTINUATION_MAX_DURATION_MS = 12000;
const LONG_PAUSE_MS = 650;
const SAME_SECOND_MERGE_MAX_GAP_MS = 1000;
const SAME_SECOND_MERGE_MAX_DURATION_MS = 6000;
const SAME_SECOND_MERGE_MAX_CHARS = 80;
const MAX_CHINESE_CUE_CHARS = 56;
const MAX_LATIN_CUE_CHARS = 90;
const SOURCE_KEEP_MAX_DURATION_MS = 6500;
const SOURCE_FORCE_SPLIT_SENTENCE_COUNT = 4;
const TRANSCRIPT_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SUBTITLE_TOGGLE_STORAGE_KEY = 'video-view-bottom-subtitle-visible';


const route = useRoute();
const videoUrl = ref('');
const isLoading = ref(false);
const showResult = ref(false);
const takeaways = ref<Takeaway[]>([]);
const transcript = ref<TranscriptSegment[]>([]);
const transcriptSource = ref<'raw' | 'cue'>('raw');

const videoTitle = ref('');
const videoDescription = ref('');
const videoHashtags = ref('');
const keywordGlossary = ref<KeywordGlossaryItem[]>([]);
const showKeywordGlossaryForm = ref(false);
const isSavingKeywordGlossary = ref(false);
const keywordGlossaryForm = ref<KeywordGlossaryItem>({
  english: '',
  phonetic: '',
  chinese: '',
  type: 'word',
});
const speakingGlossaryKey = ref('');
const activeTakeawayIndex = ref<number | null>(null);
const activeTranscriptIndex = ref<number | null>(null);
const currentVideoTime = ref(0);
const videoDuration = ref(0); // 从播放器获取的真实时长
const isBilingual = ref(true); // 是否开启双语模式
const showBottomSubtitleDock = ref(true);
const mindmapRaw = ref(''); // 脑图 Markdown
const showMindMap = ref(false); // 是否显示脑图
const showSearchModal = ref(false); // 是否显示搜索弹窗
const showClippingDrawer = ref(false); // 是否显示剪辑抽屉
const editingSegment = ref<TranscriptSegment | null>(null); // 当前正在编辑的片段
const clippingRange = ref<{ start?: number, end?: number }>({});

const openClippingDrawer = (start?: number, end?: number) => {
  clippingRange.value = { start, end };
  showClippingDrawer.value = true;
};

// AI 助手相关状态
const activeSidebarTab = ref<'transcript' | 'chat'>('transcript');
const chatInput = ref('');
const chatMessages = ref<{ role: 'user' | 'assistant'; content: string }[]>([]);
const isChatLoading = ref(false);
const chatListRef = ref<HTMLElement | null>(null);
const isAutoScrollEnabled = ref(true);
const selectedLoop = ref<{ start: number, end: number, id: string } | null>(null);
const isClippingId = ref<string | null>(null); // 正在剪辑的 ID
const isRebuildingCues = ref(false);
const isRetranslatingCues = ref(false);
const pendingAction = ref<null | 'rebuild-cues' | 'retranslate-cues' | 'force-analyze'>(null);
const actionNotice = ref<{ title: string; message: string; type: 'success' | 'error' | 'info' } | null>(null);

// 字幕滚动自动归中行为控制变量
const isHoveringTranscript = ref(false);
const autoScrollPaused = ref(false);
const isTranslating = ref(false);
const expandedTranscriptKeys = ref<Record<string, boolean>>({});

// 手动修复相关状态 / Manual fix states
const editingSegIndex = ref<number | null>(null);
const editForm = ref({ text: '', translatedText: '' });
const isSavingEdit = ref(false);

const startEdit = (seg: TranscriptSegment, index: number) => {
  editingSegIndex.value = index;
  editingSegment.value = seg;
  editForm.value = {
    text: seg.text,
    translatedText: seg.translatedText || ''
  };

  // 编辑过程中暂停视频 / Pause video during editing
  if (playerRef.value?.pause) {
    playerRef.value.pause();
  }
};

const cancelEdit = () => {
  editingSegIndex.value = null;
  editingSegment.value = null;
};

const reloadTranscriptOnly = async () => {
  if (!videoId.value) return;
  const detailRes = await fetch(`${API_BASE}/api/videos/${videoId.value}`, {
    headers: getAuthHeaders()
  });
  const detail = await detailRes.json();
  if (detail.success && detail.data?.transcript) {
    normalizeTranscript(detail.data.transcript, detail.data.transcriptSource || 'raw');
  }
};

const saveEdit = async (seg: TranscriptSegment) => {
  if (!videoId.value || seg.sortOrder === undefined) return;
  isSavingEdit.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/videos/${videoId.value}/subtitles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        cueSortOrder: seg.sortOrder,
        text: editForm.value.text,
        translatedText: editForm.value.translatedText
      })
    });

    if (!res.ok) throw new Error('Failed to update subtitles');

    // 2. 重新拉取最新 transcript，避免 cue/raw 映射错位
    await reloadTranscriptOnly();

    editingSegIndex.value = null;
    editingSegment.value = null;
  } catch (err) {
    console.error('Save edit failed:', err);
    alert('保存失败，请重试');
  } finally {
    isSavingEdit.value = false;
  }
};

const handleRebuildCues = async () => {
  if (!videoId.value || isRebuildingCues.value) return;
  isRebuildingCues.value = true;

  try {
    const response = await fetch(`${API_BASE}/api/videos/${videoId.value}/rebuild-cues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || '重建字幕失败');
    }

    await reloadTranscriptOnly();
    showActionNotice({
      title: '重建成功',
      message: '字幕 cues 已按最新规则重建完成。',
      type: 'success',
    });
  } catch (err) {
    console.error('Rebuild cues failed:', err);
    showActionNotice({
      title: '重建失败',
      message: '重建字幕失败，请稍后重试。',
      type: 'error',
    });
  } finally {
    isRebuildingCues.value = false;
  }
};

const handleRetranslateCues = async () => {
  if (!videoId.value || isRetranslatingCues.value) return;
  isRetranslatingCues.value = true;

  try {
    const response = await fetch(`${API_BASE}/api/videos/${videoId.value}/retranslate-cues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || '重翻译字幕失败');
    }

    await reloadTranscriptOnly();
    isTranslating.value = shouldShowTranslatingState(transcript.value);
    showActionNotice({
      title: '重翻译完成',
      message: '展示字幕已按最新规则重新翻译。',
      type: 'success',
    });
  } catch (err) {
    console.error('Retranslate cues failed:', err);
    showActionNotice({
      title: '重翻译失败',
      message: '仅重翻译字幕失败，请稍后重试。',
      type: 'error',
    });
  } finally {
    isRetranslatingCues.value = false;
  }
};

const handleForceAnalyze = async () => {
  if (isLoading.value) return;
  await handleAnalyze(true);
};

const openConfirmModal = (action: 'rebuild-cues' | 'retranslate-cues' | 'force-analyze') => {
  pendingAction.value = action;
};

const closeConfirmModal = () => {
  if (isRebuildingCues.value || isRetranslatingCues.value || isLoading.value) return;
  pendingAction.value = null;
};

const closeActionNotice = () => {
  if (actionNoticeTimeout) {
    clearTimeout(actionNoticeTimeout);
    actionNoticeTimeout = null;
  }
  actionNotice.value = null;
};

const showActionNotice = (notice: { title: string; message: string; type: 'success' | 'error' | 'info' }) => {
  actionNotice.value = notice;
  if (actionNoticeTimeout) clearTimeout(actionNoticeTimeout);
  actionNoticeTimeout = window.setTimeout(() => {
    actionNotice.value = null;
    actionNoticeTimeout = null;
  }, 2200);
};

const normalizeKeywordGlossary = (items: any[]): KeywordGlossaryItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      english: decodeHtml(String(item?.english || '')).trim(),
      phonetic: decodeHtml(String(item?.phonetic || '')).trim(),
      chinese: decodeHtml(String(item?.chinese || '')).trim(),
      type: item?.type === 'word' ? 'word' as const : 'phrase' as const,
    }))
    .filter((item) => item.english && item.chinese);
};

const resetKeywordGlossaryForm = () => {
  keywordGlossaryForm.value = {
    english: '',
    phonetic: '',
    chinese: '',
    type: 'word',
  };
};

const keywordGlossaryCopyText = computed(() => {
  if (!keywordGlossary.value.length) return '';

  return keywordGlossary.value
    .map((item, index) => `${index + 1}. ${item.english}${item.phonetic ? ` ${item.phonetic}` : ''} - ${item.chinese}`)
    .join('\n');
});

const speakGlossaryItem = (item: KeywordGlossaryItem, index: number) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    showActionNotice({
      title: '当前设备不支持点读',
      message: '请在支持语音合成的浏览器中使用该功能。',
      type: 'error',
    });
    return;
  }

  const text = item.english.trim();
  if (!text) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.92;
  utterance.pitch = 1;

  const key = `${item.english}-${index}`;
  speakingGlossaryKey.value = key;
  utterance.onend = () => {
    if (speakingGlossaryKey.value === key) speakingGlossaryKey.value = '';
  };
  utterance.onerror = () => {
    if (speakingGlossaryKey.value === key) speakingGlossaryKey.value = '';
  };

  window.speechSynthesis.speak(utterance);
};

const openKeywordGlossaryForm = () => {
  showKeywordGlossaryForm.value = true;
};

const cancelKeywordGlossaryForm = () => {
  if (isSavingKeywordGlossary.value) return;
  showKeywordGlossaryForm.value = false;
  resetKeywordGlossaryForm();
};

const saveKeywordGlossaryItem = async () => {
  if (!videoId.value) return;

  const english = keywordGlossaryForm.value.english.trim();
  const phonetic = keywordGlossaryForm.value.phonetic?.trim() || '';
  const chinese = keywordGlossaryForm.value.chinese.trim();
  const type = keywordGlossaryForm.value.type === 'phrase' ? 'phrase' : 'word';

  if (!english || !chinese) {
    showActionNotice({
      title: '请补全词条',
      message: '请填写英文和中文释义后再保存。',
      type: 'error',
    });
    return;
  }

  isSavingKeywordGlossary.value = true;
  try {
    const response = await fetch(`${API_BASE}/api/videos/${videoId.value}/keyword-glossary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ english, phonetic, chinese, type }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || '保存关键词失败');
    }

    const result = await response.json();
    keywordGlossary.value = normalizeKeywordGlossary(result.data || []);
    showKeywordGlossaryForm.value = false;
    resetKeywordGlossaryForm();
    showActionNotice({
      title: '保存成功',
      message: '关键词词条已加入当前视频。',
      type: 'success',
    });
  } catch (error) {
    console.error('Save keyword glossary failed:', error);
    showActionNotice({
      title: '保存失败',
      message: '关键词词条保存失败，请稍后重试。',
      type: 'error',
    });
  } finally {
    isSavingKeywordGlossary.value = false;
  }
};

const confirmPendingAction = async () => {
  if (pendingAction.value === 'rebuild-cues') {
    await handleRebuildCues();
  } else if (pendingAction.value === 'retranslate-cues') {
    await handleRetranslateCues();
  } else if (pendingAction.value === 'force-analyze') {
    await handleForceAnalyze();
  }

  if (!isRebuildingCues.value && !isRetranslatingCues.value && !isLoading.value) {
    pendingAction.value = null;
  }
};


// 标题溢出检测
const titleRef = ref<HTMLElement | null>(null);
const isTitleTruncated = ref(false);
const checkTitleTruncation = () => {
  if (titleRef.value) {
    isTitleTruncated.value = titleRef.value.scrollWidth > titleRef.value.clientWidth;
  }
};
let pollingInterval: any = null;
let resumeScrollTimeout: any = null;
let programmaticScrollTimeout: any = null;
let actionNoticeTimeout: any = null;
let isProgrammaticScroll = false;

const startResumeTimeout = (duration: number) => {
  if (resumeScrollTimeout) clearTimeout(resumeScrollTimeout);
  resumeScrollTimeout = setTimeout(() => {
    autoScrollPaused.value = false;
  }, duration);
};

const handleTranscriptScroll = () => {
  if (isProgrammaticScroll) return; // ignore code-triggered scroll
  autoScrollPaused.value = true;
  if (isHoveringTranscript.value) {
    startResumeTimeout(10000); // Wait 10s if hovering
  } else {
    startResumeTimeout(3000); // Wait 3s if not hovering
  }
};

const handleTranscriptMouseEnter = () => {
  isHoveringTranscript.value = true;
  if (autoScrollPaused.value) {
    startResumeTimeout(10000);
  }
};

const handleTranscriptMouseLeave = () => {
  isHoveringTranscript.value = false;
  if (autoScrollPaused.value) {
    startResumeTimeout(3000);
  }
};

const countCjkChars = (text: string) => (text.match(/[\u3400-\u9fff]/g) || []).length;
const hasSentenceEnding = (text: string) => /[.?!。？！…]$/.test(text.trim());
const hasWeakContinuationEnding = (text: string) => /[,，、;；:]$/.test(text.trim());
const hasAnyPunctuation = (text: string) => /[.,?!，。？！、;；:：…]/.test(text.trim().slice(-1));
const shouldJoinWithSpace = (currentText: string, nextText: string) => {
  const trimmedCurrent = currentText.trim();
  const trimmedNext = nextText.trim();
  if (!trimmedCurrent || !trimmedNext) return false;
  if (hasAnyPunctuation(trimmedCurrent)) return true;

  const hasLatin = /[A-Za-z]/.test(trimmedCurrent) || /[A-Za-z]/.test(trimmedNext);
  return hasLatin;
};
const splitTextIntoSentences = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const protectedText = trimmed
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\./gi, '$1<prd>')
    .replace(/(\d)\.(\d)/g, '$1<prd>$2');
  return (protectedText.match(/[^.?!。？！…]+[.?!。？！…]?/g) || [protectedText])
    .map(part => part.replace(/<prd>/g, '.').trim())
    .filter(Boolean);
};
const endsWithCountLead = (text: string) => {
  const words = text
    .trim()
    .replace(/[.,?!;:，。？！；：…]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  const lastWord = words[words.length - 1] || '';
  return /^(one|two|three|four|five|six|seven|eight|nine|ten|once|twice|thrice|many|several|few|couple|\d+)$/.test(lastWord);
};
const distributeDuration = (totalDuration: number, parts: string[]) => {
  if (parts.length === 0) return [];
  if (totalDuration <= 0) return parts.map(() => 0);

  const weights = parts.map(part => Math.max(part.replace(/\s+/g, '').length, 1));
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
};
const endsWithAdjectivePhrase = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed || hasSentenceEnding(trimmed)) return false;

  const words = trimmed
    .replace(/[.,?!;:，。？！；：…]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.toLowerCase());

  if (words.length === 0) return false;

  const lastWord = words[words.length - 1] || '';
  const prevWord = words[words.length - 2] || '';
  const prevTwo = words.slice(-2).join(' ');
  const prevThree = words.slice(-3).join(' ');

  // Keep a broader adjective whitelist so common phrase splits like
  // "my bad" + "habits" still merge back into one readable cue.
  const adjectiveOrModifier = /^(perfect|good|great|nice|best|better|important|beautiful|lovely|little|big|small|right|wrong|same|next|first|last|special|fresh|clean|ready|safe|happy|sad|hungry|blue|red|green|young|old|bad|new|hard|easy|simple|different|strong|weak|real|main|full|short|long|early|late)$/.test(lastWord);
  const articlePlusAdjective = /^(the|a|an|this|that|these|those|my|your|his|her|our|their)$/.test(prevWord) && adjectiveOrModifier;
  const degreePlusAdjective = /^(very|so|too|quite|really)$/.test(prevWord) && adjectiveOrModifier;
  const fixedLeadPhrase = /^(the most|the best|such a|such an)$/.test(prevTwo) || /^(one of the)$/.test(prevThree);

  return articlePlusAdjective || degreePlusAdjective || fixedLeadPhrase;
};
const isShortNounCompletion = (text: string) => {
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
  const nounLike = /^(spot|place|home|house|tree|time|times|day|days|way|ways|idea|ideas|one|thing|things|door|doors|station|line|ticket|tickets|barrier|soil|sun|water|bottle|bottles|backpack|uniform|goggles|chicken|car|cars|weekend|weekends|habit|habits|choice|choices|example|examples|problem|problems|plan|plans|moment|moments|memory|memories|feeling|feelings)$/.test(lastWord);

  return nounLike || words.length <= 2;
};
const shouldSplitSourceSegment = (seg: TranscriptSegment, textParts: string[]) => {
  if (textParts.length <= 1) return false;

  const fullText = (seg.text || '').trim();
  const totalChars = fullText.replace(/\s+/g, '').length;
  const lastPart = textParts[textParts.length - 1] || '';
  const maxChars = getMaxCueChars(fullText);

  if (looksIncompleteTail(lastPart)) return true;
  if (textParts.length >= SOURCE_FORCE_SPLIT_SENTENCE_COUNT) return true;
  if (seg.duration > SOURCE_KEEP_MAX_DURATION_MS) return true;
  if (totalChars > maxChars) return true;

  return false;
};
const expandTranscriptSegments = (segments: TranscriptSegment[]) => {
  return segments.flatMap((seg) => {
    const textParts = splitTextIntoSentences(seg.text || '');
    if (!shouldSplitSourceSegment(seg, textParts)) return [seg];

    const translatedParts = splitTextIntoSentences(seg.translatedText || '');
    const partDurations = distributeDuration(seg.duration, textParts);
    let runningOffset = seg.offset;

    return textParts.map((textPart, index) => {
      const duration = partDurations[index] ?? 0;
      const expanded: TranscriptSegment = {
        ...seg,
        text: textPart,
        translatedText: translatedParts.length === textParts.length
          ? translatedParts[index]
          : (index === 0 ? seg.translatedText : undefined),
        offset: runningOffset,
        duration,
        sourceIndices: seg.sourceIndices,
        anchorOffset: seg.anchorOffset ?? seg.offset,
      };
      runningOffset += duration;
      return expanded;
    });
  });
};
const looksIncompleteTail = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasSentenceEnding(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.toLowerCase() || '';

  return /[\u4e00-\u9fa5]$/.test(trimmed)
    || /^(i|you|he|she|we|they|it|my|your|his|her|our|their|its|this|that|these|those|the|a|an|some|any|another|to|of|for|with|and|or|but|so|because|what|which|who|when|where|why|how|is|are|am|was|were|do|does|did|can|could|should|would|will|shall|have|has|had)$/.test(lastWord);
};
const startsWithContinuation = (text: string) => {
  const trimmed = text.trim().toLowerCase();
  return /^(and|or|but|so|because|then|also|too|with|to|for|of|in|on|at|as|if|when|while|that|which|who|where|how|what|和|与|及|以及|并且|而且|但是|不过|所以|因为|然后|还|也|并|再)/.test(trimmed);
};
const getMaxCueChars = (text: string) => {
  const cjkChars = countCjkChars(text);
  return cjkChars >= Math.max(6, text.length / 3) ? MAX_CHINESE_CUE_CHARS : MAX_LATIN_CUE_CHARS;
};
const joinCueText = (currentText: string, nextText: string) => {
  const trimmedCurrent = currentText.trim();
  const trimmedNext = nextText.trim();
  if (!trimmedCurrent) return trimmedNext;
  if (!trimmedNext) return trimmedCurrent;

  const sep = shouldJoinWithSpace(trimmedCurrent, trimmedNext) ? ' ' : '';
  return `${trimmedCurrent}${sep}${trimmedNext}`.trim();
};
const shouldMergeCue = (current: TranscriptSegment, seg: TranscriptSegment) => {
  const currentText = current.text.trim();
  const nextText = seg.text.trim();
  const combinedDuration = (seg.offset + seg.duration) - current.offset;
  const gapDuration = seg.offset - (current.offset + current.duration);
  const combinedText = `${currentText}${nextText}`;
  const maxChars = getMaxCueChars(combinedText);
  const combinedChars = combinedText.replace(/\s+/g, '').length;
  const currentLooksIncomplete = looksIncompleteTail(currentText);
  const hasContinuationSignal = hasWeakContinuationEnding(currentText) || startsWithContinuation(nextText);
  const hasCountLeadTail = endsWithCountLead(currentText);
  const hasAdjectivePhraseTail = endsWithAdjectivePhrase(currentText);
  const nextLooksLikeNounCompletion = isShortNounCompletion(nextText);
  const closeDisplayedTime = Math.abs((seg.anchorOffset ?? seg.offset) - current.offset) < 1000;

  if (combinedDuration > HARD_MAX_CUE_DURATION_MS) return false;
  if (combinedChars > maxChars) return false;

  const currentPrimarySource = current.sourceIndices?.[current.sourceIndices.length - 1];
  const nextPrimarySource = seg.sourceIndices?.[0] ?? seg.sortOrder;
  const isSameSource = currentPrimarySource !== undefined && nextPrimarySource !== undefined && currentPrimarySource === nextPrimarySource;
  if (isSameSource) {
    return true;
  }

  if (gapDuration > LONG_PAUSE_MS) return false;

  if (
    hasCountLeadTail
    && gapDuration <= STRONG_CONTINUATION_MAX_GAP_MS
    && combinedDuration <= STRONG_CONTINUATION_MAX_DURATION_MS
  ) {
    return true;
  }

  if (
    hasAdjectivePhraseTail
    && nextLooksLikeNounCompletion
    && gapDuration <= STRONG_CONTINUATION_MAX_GAP_MS
    && combinedDuration <= STRONG_CONTINUATION_MAX_DURATION_MS
  ) {
    return true;
  }

  if (
    closeDisplayedTime
    && gapDuration <= SAME_SECOND_MERGE_MAX_GAP_MS
    && combinedDuration <= SAME_SECOND_MERGE_MAX_DURATION_MS
    && combinedChars <= SAME_SECOND_MERGE_MAX_CHARS
  ) {
    return true;
  }

  if (hasContinuationSignal) {
    return combinedDuration <= CONTINUATION_MAX_DURATION_MS;
  }

  if (currentLooksIncomplete) {
    return combinedDuration <= INCOMPLETE_TAIL_MAX_DURATION_MS;
  }

  if (!hasSentenceEnding(currentText)) {
    return combinedDuration <= SOFT_MAX_CUE_DURATION_MS;
  }

  return false;
};
const getTranscriptExpandKey = (seg: TranscriptSegment, index: number) => {
  return `${seg.sortOrder ?? index}-${seg.offset}-${seg.duration}`;
};
const shouldCollapseTranscript = (seg: TranscriptSegment) => {
  const primaryText = (isBilingual.value && seg.translatedText ? seg.translatedText : seg.text) || '';
  return primaryText.replace(/\s+/g, '').length > TRANSCRIPT_COLLAPSE_THRESHOLD;
};
const isTranscriptExpanded = (seg: TranscriptSegment, index: number) => {
  return !!expandedTranscriptKeys.value[getTranscriptExpandKey(seg, index)];
};
const toggleTranscriptExpanded = (seg: TranscriptSegment, index: number) => {
  const key = getTranscriptExpandKey(seg, index);
  expandedTranscriptKeys.value = {
    ...expandedTranscriptKeys.value,
    [key]: !expandedTranscriptKeys.value[key],
  };
};

// 智能合并字幕：不再是死板的两两合并，而是根据标点、时长、行数判断，保持语义完整性
const mergedTranscript = computed(() => {
  if (transcript.value.length === 0) return [];
  const merged: TranscriptSegment[] = [];
  const baseTranscript = transcript.value.map((seg, i) => ({
    ...seg,
    sortOrder: seg.sortOrder ?? i,
    sourceIndices: seg.sourceIndices && seg.sourceIndices.length > 0 ? seg.sourceIndices : [i],
  }));
  const expandedTranscript = transcriptSource.value === 'cue'
    ? baseTranscript
    : expandTranscriptSegments(baseTranscript);
  let current: TranscriptSegment | null = null;

  for (let i = 0; i < expandedTranscript.length; i++) {
    const seg = expandedTranscript[i];
    // 给原始数据补上 sortOrder (如果后端没传，用 i 兜底)
    if (seg.sortOrder === undefined) seg.sortOrder = i;

    if (!current) {
      current = {
        ...seg,
        offset: seg.anchorOffset ?? seg.offset,
        sourceIndices: seg.sourceIndices && seg.sourceIndices.length > 0
          ? [...seg.sourceIndices]
          : [seg.sortOrder ?? i],
      };
      continue;
    }

    if (shouldMergeCue(current, seg)) {
      current.text = joinCueText(current.text, seg.text);
      if (seg.translatedText) {
        current.translatedText = joinCueText(current.translatedText || '', seg.translatedText);
      }

      const nextSourceIndices = seg.sourceIndices && seg.sourceIndices.length > 0
        ? seg.sourceIndices
        : [seg.sortOrder ?? i];
      current.sourceIndices = Array.from(new Set([...(current.sourceIndices || []), ...nextSourceIndices]));
      current.duration = (seg.offset + seg.duration) - current.offset;
    } else {
      // 达到断句条件，推入结果并开启新包
      merged.push(current);
      current = {
        ...seg,
        offset: seg.anchorOffset ?? seg.offset,
        sourceIndices: seg.sourceIndices && seg.sourceIndices.length > 0
          ? [...seg.sourceIndices]
          : [seg.sortOrder ?? i],
      };
    }
  }

  if (current) merged.push(current);
  return merged;
});

const currentTranscriptSegment = computed(() => {
  const activeIndex = activeTranscriptIndex.value;
  if (activeIndex === null || activeIndex < 0) return null;
  return mergedTranscript.value[activeIndex] || null;
});

// 是否存在双语数据
const hasBilingualData = computed(() => {
  return transcript.value.some(seg => !!seg.translatedText);
});

const isProbablyChineseText = (text: string) => /[\u4e00-\u9fa5]/.test(text);
const isTranslationNoise = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!/[a-zA-Z0-9]/.test(trimmed)) return true;
  return trimmed.length < 2;
};

const getTranslationProgress = (segments: TranscriptSegment[]) => {
  let translatableCount = 0;
  let missingCount = 0;

  segments.forEach((seg) => {
    if (seg.translatedText) return;
    if (isProbablyChineseText(seg.text) || isTranslationNoise(seg.text)) return;
    translatableCount += 1;
    missingCount += 1;
  });

  const translatedCount = segments.filter((seg) => {
    if (!seg.translatedText) return false;
    return !isProbablyChineseText(seg.text) && !isTranslationNoise(seg.text);
  }).length;

  return {
    translatableCount: translatableCount + translatedCount,
    translatedCount,
    missingCount,
  };
};

const shouldShowTranslatingState = (segments: TranscriptSegment[]) => {
  const { translatableCount, translatedCount, missingCount } = getTranslationProgress(segments);
  if (translatableCount === 0) return false;

  const completionRatio = translatedCount / translatableCount;
  const hasOnlyTinyTailLeft = missingCount <= 5 && completionRatio >= 0.97;
  return missingCount > 0 && !hasOnlyTinyTailLeft;
};

const normalizeTranscript = (rawTranscript: any[], source: 'raw' | 'cue') => {
  transcriptSource.value = source;
  expandedTranscriptKeys.value = {};
  transcript.value = rawTranscript.map((seg: any, index: number) => ({
    ...seg,
    sortOrder: seg.sortOrder ?? index,
    sourceIndices: Array.isArray(seg.sourceIndices) ? seg.sourceIndices : [seg.sortOrder ?? index],
    anchorOffset: seg.anchorOffset ?? seg.offset,
    text: decodeHtml(seg.text),
    translatedText: decodeHtml(seg.translatedText)
  }));
};


const errorMsg = ref('');

const playerRef = ref<any>(null);

// 检测视频平台
const platform = computed<'youtube' | 'bilibili' | ''>(() => {
  const url = videoUrl.value;
  if (!url) return '';
  if (/bilibili\.com\/video\/BV/.test(url) || /b23\.tv/.test(url)) return 'bilibili';
  if (/youtu\.?be/.test(url) || /youtube\.com/.test(url)) return 'youtube';
  return '';
});

// 提取 YouTube Video ID
const youtubeVideoId = computed(() => {
  if (platform.value !== 'youtube') return '';
  const match = videoUrl.value.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([^&?]+)/);
  return match ? match[1] : '';
});

// 提取 Bilibili BV 号
const bilibiliBvid = computed(() => {
  if (platform.value !== 'bilibili') return '';
  const match = videoUrl.value.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
  return match ? match[1] : '';
});

// 统一的 videoId（用于发给后端）
const videoId = computed(() => {
  if (platform.value === 'youtube') return youtubeVideoId.value;
  if (platform.value === 'bilibili') return bilibiliBvid.value;
  return '';
});

// 是否有有效的视频链接
const hasValidUrl = computed(() => !!videoId.value);

// 解码 HTML 实体（如 &#39; -> '）
const decodeHtml = (html: string | null) => {
  if (!html) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};

// 格式化秒数为 mm:ss（用于 takeaway 的 timestamp）
const formatTimeFromSeconds = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// 格式化毫秒为 mm:ss（用于字幕的 offset）
const formatTimeFromMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const formatPreciseTimeFromMs = (ms: number) => {
  const totalTenths = Math.floor(ms / 100);
  const totalSeconds = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}.${tenths}`;
};

const formatTranscriptTime = (segments: TranscriptSegment[], index: number) => {
  const current = segments[index];
  if (!current) return '0:00';

  const currentSecond = Math.floor(current.offset / 1000);
  const prevSecond = index > 0 ? Math.floor(segments[index - 1].offset / 1000) : null;
  const nextSecond = index < segments.length - 1 ? Math.floor(segments[index + 1].offset / 1000) : null;
  const hasCollision = currentSecond === prevSecond || currentSecond === nextSecond;

  return hasCollision ? formatPreciseTimeFromMs(current.offset) : formatTimeFromMs(current.offset);
};

// 获取历史记录






onMounted(() => {
  const persistedBottomSubtitlePreference = window.localStorage.getItem(BOTTOM_SUBTITLE_TOGGLE_STORAGE_KEY);
  if (persistedBottomSubtitlePreference !== null) {
    showBottomSubtitleDock.value = persistedBottomSubtitlePreference === 'true';
  }

  if (route.query.url) {
    videoUrl.value = route.query.url as string;
    handleAnalyze();
  }
  // 如果 URL 中有时间戳且播放器已准备好（虽然初始化时通常没好，但还是检查一下）
  if (route.query.t && playerRef.value) {
    const targetTime = parseInt(route.query.t as string);
    playerRef.value?.seekTo(targetTime);
  }
});

import { onUnmounted } from 'vue';
onUnmounted(() => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (actionNoticeTimeout) clearTimeout(actionNoticeTimeout);
});

// 监听 URL 中的参数变化，实现同一视频多次搜索跳转
watch(() => route.query, (newQuery) => {
  if (newQuery.t && playerRef.value) {
    const targetTime = parseInt(newQuery.t as string);
    playerRef.value?.seekTo(targetTime);
  }
}, { deep: true });

// 监听分析成功，如果是从搜索跳过来的，且是第一次加载的情况
window.addEventListener('video-analyzed', () => {
  if (route.query.t && playerRef.value) {
    const targetTime = parseInt(route.query.t as string);
    setTimeout(() => {
      playerRef.value?.seekTo(targetTime);
    }, 1000); // 稍微延迟确保播放器加载完成
  }
});

watch(() => route.query.url, (newUrl) => {
  if (newUrl) {
    videoUrl.value = newUrl as string;
    handleAnalyze();
  }
});

watch(showBottomSubtitleDock, (value) => {
  window.localStorage.setItem(BOTTOM_SUBTITLE_TOGGLE_STORAGE_KEY, String(value));
});

const isAnalyzingSummary = ref(false); // 是否正在分析摘要/脑图
const isGeneratingMindmap = ref(false);
const isGeneratingPublishAssist = ref(false);
const isIndexing = ref(false); // 是否正在进行向量化索引（用于语义搜索）

// 轮询更新摘要、脑图、翻译和索引
const pollAnalysisStatus = async () => {
  if (!videoId.value || (!isAnalyzingSummary.value && !isGeneratingMindmap.value && !isGeneratingPublishAssist.value && !isIndexing.value && !isTranslating.value)) {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/videos/${videoId.value}`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();

    if (result.success && result.data) {
      // 1. 更新标题
      if (result.data.videoTitle) {
        videoTitle.value = decodeHtml(result.data.videoTitle);
      }
      videoDescription.value = decodeHtml(result.data.videoDescription || '');
      videoHashtags.value = decodeHtml(result.data.videoHashtags || '');
      keywordGlossary.value = normalizeKeywordGlossary(result.data.keywordGlossary || []);

      // 2. 更新摘要
      if (result.data.takeaways && result.data.takeaways.length > 0) {
        takeaways.value = result.data.takeaways.map((ta: any) => ({
          ...ta,
          title: decodeHtml(ta.title),
          summary: decodeHtml(ta.summary)
        }));
      }

      if (result.data.summaryReady) {
        isAnalyzingSummary.value = false;
      }

      // 3. 更新脑图
      if (result.data.mindmap) {
        mindmapRaw.value = result.data.mindmap;
      }
      if (result.data.mindmapReady) {
        isGeneratingMindmap.value = false;
      }

      if (result.data.publishReady) {
        isGeneratingPublishAssist.value = false;
      }

      // 4. 更新索引状态 (只要后端返回 true，就释放前端按钮)
      if (result.data.isIndexed !== undefined) {
         if (result.data.isIndexed) {
           isIndexing.value = false;
         } else {
           isIndexing.value = true;
         }
      }

      if (result.data.transcript && result.data.transcript.length > 0) {
        normalizeTranscript(result.data.transcript, result.data.transcriptSource || 'raw');
        isTranslating.value = shouldShowTranslatingState(transcript.value);
      }

      // 如果全部完成，停止轮询
      if (!isAnalyzingSummary.value && !isGeneratingMindmap.value && !isGeneratingPublishAssist.value && !isIndexing.value && !isTranslating.value) {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
          console.log('✅ Polling stopped: All tasks finished.');
        }
      }
    }
  } catch (e) {
    console.error('Polling analysis status failed:', e);
  }
};

onBeforeUnmount(() => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
});


// 调用后端 AI 分析接口
const handleAnalyze = async (force: boolean = false) => {
  await waitForAuth(); // 等待认证初始化完成
  if (!checkLogin()) return; // 检查登录状态
  if (!videoId.value || !platform.value) return;
  isLoading.value = true;
  showResult.value = false;
  isTranslating.value = false;
  isAnalyzingSummary.value = false;
  isGeneratingMindmap.value = false;
  isGeneratingPublishAssist.value = false;
  isIndexing.value = false;

  if (pollingInterval) clearInterval(pollingInterval);
  errorMsg.value = '';
  // 重置视频状态防止上一个视频的进度导致当前页面错乱闪烁
  activeTakeawayIndex.value = null;
  activeTranscriptIndex.value = null;
  videoDescription.value = '';
  videoHashtags.value = '';
  keywordGlossary.value = [];
  currentVideoTime.value = 0;

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        videoId: videoId.value,
        url: videoUrl.value,
        platform: platform.value,
        forceRefresh: force,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      // 核心原则：即便 AI 摘要还没好，也要先把视频和字幕展示出来
      videoTitle.value = decodeHtml(result.data.videoTitle || '');
      videoDescription.value = decodeHtml(result.data.videoDescription || '');
      videoHashtags.value = decodeHtml(result.data.videoHashtags || '');
      keywordGlossary.value = normalizeKeywordGlossary(result.data.keywordGlossary || []);
      mindmapRaw.value = result.data.mindmap || '';

      const rawTranscript = result.data.transcript || [];
      normalizeTranscript(rawTranscript, result.data.transcriptSource || 'raw');

      // 处理摘要
      if (result.data.takeaways && result.data.takeaways.length > 0) {
        takeaways.value = result.data.takeaways.map((ta: any) => ({
          ...ta,
          title: decodeHtml(ta.title),
          summary: decodeHtml(ta.summary)
        }));
        isAnalyzingSummary.value = false;
      } else {
        // 如果摘要为空，开启异步分析状态
        takeaways.value = [];
        isAnalyzingSummary.value = !result.data.summaryReady;
      }

      isGeneratingMindmap.value = !result.data.mindmapReady;
      isGeneratingPublishAssist.value = !result.data.publishReady;

      // 索引状态
      if (!result.data.isIndexed) {
         isIndexing.value = true;
      }

      const isChineseVideo = transcript.value.slice(0, 10).every(s => isProbablyChineseText(s.text));
      const hasMissingTranslation = shouldShowTranslatingState(transcript.value);

      if (!isChineseVideo && hasMissingTranslation) {
        isTranslating.value = true;
        isBilingual.value = true;
      }

      showResult.value = true;
      window.dispatchEvent(new Event('video-analyzed')); // 刷新历史

      // 开启轮询 (如果任何一个异步状态处于 active)
      if (isAnalyzingSummary.value || isGeneratingMindmap.value || isGeneratingPublishAssist.value || isIndexing.value || isTranslating.value) {
        pollingInterval = setInterval(pollAnalysisStatus, 3000);
      }

    } else {
      throw new Error('Invalid response format');
    }
  } catch (error: any) {
    console.error('AI analysis failed:', error);
    errorMsg.value = error.message || 'AI analysis failed.';
  } finally {
    isLoading.value = false;
  }
};


// --- AI 聊天逻辑 ---

const fetchChatHistory = async () => {
  if (!videoId.value) return;
  try {
    const res = await fetch(`${API_BASE}/api/chat/history/${videoId.value}`, {
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (result.success) {
      chatMessages.value = result.data;
      nextTick(scrollToBottom);
    }
  } catch (e) {
    console.error('Failed to fetch chat history:', e);
  }
};

let isChatProgrammaticScroll = false;

const handleChatScroll = () => {
  if (!chatListRef.value || isChatProgrammaticScroll) {
    isChatProgrammaticScroll = false;
    return;
  }

  const { scrollTop, scrollHeight, clientHeight } = chatListRef.value;
  // If user scrolls up even a little bit, disable auto-scroll
  // 5px buffer for sub-pixel issues
  const atBottom = scrollHeight - scrollTop - clientHeight < 5;

  if (!atBottom) {
    isAutoScrollEnabled.value = false;
  } else {
    isAutoScrollEnabled.value = true;
  }
};

const scrollToBottom = (force = false) => {
  if (chatListRef.value && (force || isAutoScrollEnabled.value)) {
    isChatProgrammaticScroll = true;
    if (force) {
      chatListRef.value.scrollTo({
        top: chatListRef.value.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
    }
  }
};

const sendChatMessage = async () => {
  if (!chatInput.value.trim() || isChatLoading.value || !videoId.value) return;

  const userMsg = chatInput.value;
  chatInput.value = '';
  chatMessages.value.push({ role: 'user', content: userMsg });
  chatMessages.value.push({ role: 'assistant', content: '' });
  isChatLoading.value = true;
  isAutoScrollEnabled.value = true; // Reset auto-scroll on new message
  nextTick(() => scrollToBottom(true));

  try {
    const response = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        videoId: videoId.value,
        message: userMsg
      })
    });

    if (!response.ok) throw new Error('Chat failed');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let assistantMsg = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            if (data.content) {
              assistantMsg += data.content;
              chatMessages.value[chatMessages.value.length - 1].content = assistantMsg;
              nextTick(scrollToBottom);
            }
          } catch (e) {
            // ignore partial json
          }
        }
      }
    }
  } catch (error) {
    console.error('Chat error:', error);
    chatMessages.value[chatMessages.value.length - 1].content = '抱歉，对话出了一点问题，请重试。';
  } finally {
    isChatLoading.value = false;
  }
};

// 处理时间戳点击跳转
const handleTimestampClick = (ts: string) => {
  stopLoop();
  // 清理可能存在的方括号
  const cleanTs = ts.replace(/[\[\]]/g, '');
  const parts = cleanTs.split(':').map(p => parseInt(p));

  let targetSeconds = 0;
  if (parts.length === 3) {
    // HH:MM:SS
    targetSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    targetSeconds = parts[0] * 60 + parts[1];
  }

  if (playerRef.value && !isNaN(targetSeconds)) {
    playerRef.value.seekTo(targetSeconds);
    // 可选：如果是在移动端或较小屏幕，点击时间戳后可以自动滚动到视频位置
    // window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// 解析消息内容，提取时间戳 [mm:ss]
const parseMessageContent = (content: string) => {
  if (!content) return [];
  const parts: { type: 'text' | 'timestamp'; value: string }[] = [];

  // 匹配 [mm:ss], [hh:mm:ss], mm:ss, hh:mm:ss
  // 使用正则提取被括号包裹或独立存在的时间点
  const regex = /(?:\[)?((\d{1,2}:)?\d{1,2}:\d{2})(?:\])?/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.substring(lastIndex, match.index) });
    }
    // 保持原始显示的完整性（包含括号）
    parts.push({ type: 'timestamp', value: match[0] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.substring(lastIndex) });
  }

  return parts;
};

// 预热聊天记录
watch(showResult, (val) => {
  if (val) {
    fetchChatHistory();
  }
});

// 复制文本到剪贴板
const copyToClipboard = async (text: string, message: string = '内容已复制到剪贴板。') => {
  try {
    await navigator.clipboard.writeText(text);
    showActionNotice({
      title: '复制成功',
      message,
      type: 'success',
    });
  } catch (err) {
    console.error('Failed to copy: ', err);
    showActionNotice({
      title: '复制失败',
      message: '复制到剪贴板失败，请稍后重试。',
      type: 'error',
    });
  }
};

// 点击要点条目跳转到对应时间（timestamp 是秒）
const jumpToTakeaway = (item: Takeaway, index: number) => {
  stopLoop();
  activeTakeawayIndex.value = index;
  if (playerRef.value) {
    playerRef.value.seekTo(item.timestamp);
    // 点击摘要时自动置顶，方便观看视频
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 兼容某些布局下的 main-wrapper 滚动
    document.querySelector('.main-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// 字幕跳转
const jumpToTranscript = (seg: TranscriptSegment, index: number) => {
  activeTranscriptIndex.value = index;
  handleSeek(seg.offset);
};

// 通用跳转逻辑
const handleSeek = (offsetMs: number) => {
  stopLoop();
  if (playerRef.value) {
    playerRef.value.seekTo(offsetMs / 1000);
  }
};

const startLoop = (start: number, end: number, id: string) => {
  if (selectedLoop.value?.id === id) {
    stopLoop();
    return;
  }

  // 先停止之前的循环，确保状态清理干净
  stopLoop();

  selectedLoop.value = { start, end, id };
  if (playerRef.value?.setLoop) {
    playerRef.value.setLoop(start, end);
  }
};

const stopLoop = () => {
  selectedLoop.value = null;
  if (playerRef.value?.stopLoop) {
    playerRef.value.stopLoop();
  }
};

// --- 视频切片下载逻辑 ---
// 已移除遗留的 handleClip 函数


// 视频时间更新时，自动高亮当前要点和字幕
const handleDuration = (duration: number) => {
  if (duration > 0) {
    videoDuration.value = duration;
  }
};

const handleTimelineClick = (event: MouseEvent) => {
  const container = event.currentTarget as HTMLElement;
  if (!container || !totalVideoDuration.value) return;

  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percent = Math.max(0, Math.min(1, clickX / rect.width));
  const targetTime = percent * totalVideoDuration.value;

  stopLoop();
  if (playerRef.value) {
    playerRef.value.seekTo(targetTime);
  }
};

const handleTimeUpdate = (time: number) => {
  currentVideoTime.value = time;

  // 高亮 takeaway（timestamp 是秒）
    for (let i = takeaways.value.length - 1; i >= 0; i--) {
      if (time >= takeaways.value[i].timestamp - 0.5) {
        if (activeTakeawayIndex.value !== i) {
          activeTakeawayIndex.value = i;
        }
        break;
      }
    }

  // 高亮字幕（offset 是毫秒）
  const timeMs = time * 1000;
  for (let i = mergedTranscript.value.length - 1; i >= 0; i--) {
    if (timeMs >= mergedTranscript.value[i].offset - 500) {
      if (activeTranscriptIndex.value !== i) {
        activeTranscriptIndex.value = i;

        // 仅在未手动暂停滚动时，触发平滑滚动归中显示
        if (!autoScrollPaused.value) {
          const el = document.getElementById(`seg-${i}`);
          if (el) {
            const container = document.querySelector('.transcript-list');
            if (container) {
              isProgrammaticScroll = true;
              if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
              // 设置标记覆盖平滑滚动（行为大约持续 500-800ms）的时间
              programmaticScrollTimeout = setTimeout(() => {
                isProgrammaticScroll = false;
              }, 800);

              // Scroll right list only, keeping the element centered vertically
              const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
              container.scrollTo({ top: targetTop, behavior: 'smooth' });
            } else {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }
      break;
    }
  }
};

const takeawayColors = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316'  // orange-500
];

const totalVideoDuration = computed(() => {
  // 优先使用播放器上报的真实时长
  if (videoDuration.value > 0) {
    return videoDuration.value;
  }

  if (transcript.value.length > 0) {
    const lastSeg = transcript.value[transcript.value.length - 1];
    return (lastSeg.offset + lastSeg.duration) / 1000;
  }
  if (takeaways.value.length > 0) {
    return takeaways.value[takeaways.value.length - 1].timestamp + 120; // default buffer
  }
  return 100;
});

const takeawayMap = computed(() => {
  if (takeaways.value.length === 0) return [];
  const total = totalVideoDuration.value;

  return takeaways.value.map((ta, index) => {
    const start = ta.timestamp;

    // Default max distance to next takeaway or end of video
    const maxDistance = index < takeaways.value.length - 1
      ? takeaways.value[index + 1].timestamp - start
      : total - start;

    // Attempt to parse duration string (e.g. "2:30", "1:15") into seconds
    let pillDuration = 0;
    if (ta.duration) {
      const parts = ta.duration.split(':');
      if (parts.length === 2) {
        pillDuration = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
      } else if (parts.length === 3) {
        pillDuration = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);
      } else {
        pillDuration = parseInt(ta.duration) || 0;
      }
    }

    // Fallback if AI didn't provide valid duration or it's unreasonably large
    if (pillDuration <= 0 || pillDuration > total) {
      pillDuration = Math.max(10, maxDistance * 0.6); // default chunk
    }

    // Cap the pill width so it doesn't overlap the next span entirely
    const actualDuration = Math.min(pillDuration, Math.max(maxDistance * 0.9, 5));

    // Calculate percentages
    const leftPercent = Math.max(0, Math.min(100, (start / total) * 100));
    let widthPercent = Math.max(2, Math.min(100 - leftPercent, (actualDuration / total) * 100));

    const color = takeawayColors[index % takeawayColors.length];

    return {
      ...ta,
      index,
      color,
      leftPercent,
      widthPercent,
      actualDuration
    };
  });
});

// --- 知识外部化 (Knowledge Externalization) ---


</script>

<template>
<div class="container animate-fade-in">

        <!-- Empty State -->
        <div v-if="!hasValidUrl && !showResult && !errorMsg" class="empty-state glass-panel">
           <div class="empty-icon-wrap">
              <Sparkles :size="64" class="empty-icon" />
           </div>
           <h2>AI Video Highlights</h2>
           <p>在上方粘贴 YouTube 链接并点击“AI 分析转换”。我们的 AI 将提取核心摘要，方便您精准跳转到精彩片段。</p>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading && !showResult" class="empty-state glass-panel">
           <div class="empty-icon-wrap">
              <Loader2 :size="48" class="empty-icon spin" />
           </div>
           <h2>AI 正在分析中...</h2>
           <p>正在获取字幕并使用 AI 进行深度分析。根据视频长度，这可能需要 10-30 秒，请稍候。</p>
        </div>

        <!-- Error State -->
        <div v-if="errorMsg && !showResult && !isLoading" class="empty-state glass-panel error-state">
           <div class="empty-icon-wrap error-icon-wrap">
              <AlertCircle :size="48" class="empty-icon error-icon" />
           </div>
           <h2>分析失败</h2>
           <p>{{ errorMsg }}</p>
           <button class="btn-primary" style="margin-top: 20px;" @click="handleAnalyze()">
             <Sparkles :size="18" class="icon" />
             <span>重试</span>
           </button>
        </div>

        <!-- Video & Result Area -->
        <div v-if="hasValidUrl || showResult" v-show="!isLoading || showResult" class="content-grid" :class="{ 'has-sidebar': showResult }">

          <!-- Left: Video Player + Takeaways -->
          <div class="left-column">
            <div class="video-section glass-panel">
              <div v-if="showResult && mergedTranscript.length > 0" class="video-subtitle-toolbar">
                <div class="video-subtitle-toolbar-copy">
                  <span class="video-subtitle-toolbar-title">视频下方字幕对照</span>
                  <span class="video-subtitle-toolbar-hint">播放时同步显示当前句子，不用总看右侧</span>
                </div>
                <button
                  class="toggle-bilingual-btn subtitle-dock-toggle"
                  :class="{ active: showBottomSubtitleDock }"
                  @click="showBottomSubtitleDock = !showBottomSubtitleDock"
                  title="切换视频下方字幕对照"
                >
                  {{ showBottomSubtitleDock ? '已开启' : '已关闭' }}
                </button>
              </div>

              <YouTubePlayer
                v-if="platform === 'youtube' && youtubeVideoId"
                ref="playerRef"
                :key="'yt-' + youtubeVideoId"
                :video-id="youtubeVideoId"
                @timeupdate="handleTimeUpdate"
                @duration="handleDuration"
              />
              <BilibiliPlayer
                v-else-if="platform === 'bilibili' && bilibiliBvid"
                ref="playerRef"
                :key="'bili-' + bilibiliBvid"
                :bvid="bilibiliBvid"
                @timeupdate="handleTimeUpdate"
                @duration="handleDuration"
              />

              <div
                v-if="showResult && showBottomSubtitleDock && currentTranscriptSegment"
                class="video-subtitle-dock"
                @click="jumpToTranscript(currentTranscriptSegment, activeTranscriptIndex || 0)"
              >
                <div class="video-subtitle-dock-meta">
                  <div class="seg-time video-subtitle-time">
                    <Clock :size="12" class="seg-time-icon" />
                    <span>{{ formatTranscriptTime(mergedTranscript, activeTranscriptIndex || 0) }}</span>
                  </div>
                  <div class="video-subtitle-dock-actions">
                    <button
                      class="btn-loop-action subtitle-dock-action"
                      :class="{ active: selectedLoop?.id === 'dock-seg-' + (activeTranscriptIndex || 0) }"
                      @click.stop="startLoop(currentTranscriptSegment.offset / 1000, (currentTranscriptSegment.offset + currentTranscriptSegment.duration) / 1000, 'dock-seg-' + (activeTranscriptIndex || 0))"
                      title="循环播放当前句"
                    >
                      <RefreshCw :size="14" :class="{ 'spin': selectedLoop?.id === 'dock-seg-' + (activeTranscriptIndex || 0) }" />
                    </button>
                    <button
                      class="btn-loop-action subtitle-dock-action"
                      @click.stop="openClippingDrawer(currentTranscriptSegment.offset / 1000, (currentTranscriptSegment.offset + currentTranscriptSegment.duration) / 1000)"
                      title="基于当前句剪辑"
                    >
                      <Scissors :size="14" />
                    </button>
                  </div>
                </div>
                <div class="video-subtitle-dock-text">
                  <div v-if="isBilingual && currentTranscriptSegment.translatedText" class="video-subtitle-dock-translated">
                    {{ currentTranscriptSegment.translatedText }}
                  </div>
                  <div
                    class="video-subtitle-dock-original"
                    :class="{ 'has-translation': isBilingual && currentTranscriptSegment.translatedText }"
                  >
                    {{ currentTranscriptSegment.text }}
                  </div>
                </div>
              </div>
            </div>

            <!-- AI Takeaways (below video) -->
            <div v-if="showResult && (takeaways.length > 0 || isAnalyzingSummary)" class="takeaways-section glass-panel animate-slide-in">
              <div class="sidebar-header">
                <div class="sidebar-title-area">
                   <h3>
                     <Sparkles class="icon accent" :size="20"/>
                     <span>核心摘要</span>
                     <span v-if="takeaways.length > 0" class="title-badge">{{ takeaways.length }}</span>
                   </h3>
                   <AppTooltip
                     v-if="videoTitle"
                     :text="videoTitle"
                     :disabled="!isTitleTruncated"
                     align="left"
                   >
                     <div @mouseenter="checkTitleTruncation">
                       <p ref="titleRef" class="video-title-hint">{{ videoTitle }}</p>
                     </div>
                   </AppTooltip>
                 </div>
                   <div class="sidebar-actions">
                    <AppTooltip text="查看视频内容的 AI 脑图可视化">
                      <button
                        class="btn-mindmap"
                        :disabled="!mindmapRaw"
                        @click="showMindMap = true"
                      >
                        <Loader2 v-if="!mindmapRaw && isGeneratingMindmap" :size="14" class="spin" />
                        <Map v-else :size="14" />
                        <span>脑图</span>
                      </button>
                    </AppTooltip>

                    <AppTooltip text="基于语义在视频内搜索具体内容">
                      <button
                        v-if="showResult"
                        class="btn-search-in-video"
                        :disabled="isIndexing"
                        @click="showSearchModal = true"
                      >
                        <Loader2 v-if="isIndexing" :size="14" class="spin" />
                        <Search v-else :size="14" />
                        <span>检索</span>
                      </button>
                    </AppTooltip>

                    <AppTooltip text="手动选取视频范围进行精准剪辑">
                      <button
                        v-if="showResult"
                        class="btn-search-in-video"
                        @click="openClippingDrawer()"
                      >
                        <Scissors :size="14" />
                        <span>快速切片</span>
                      </button>
                    </AppTooltip>

                    <KnowledgeExportActions
                      :video-id="videoId"
                      :video-title="videoTitle"
                      :video-url="videoUrl"
                      :takeaways="takeaways"
                      :mindmap-raw="mindmapRaw"
                    />

                  </div>
               </div>

              <div class="takeaways-timeline-container">
                <div class="takeaways-timeline" @click="handleTimelineClick">
                  <div
                    v-for="item in takeawayMap"
                    :key="'map-' + item.index"
                    class="timeline-segment"
                    :style="{ left: item.leftPercent + '%', width: item.widthPercent + '%', backgroundColor: item.color }"
                    :class="{ active: activeTakeawayIndex === item.index }"
                    @click.stop="jumpToTakeaway(item, item.index)"
                  >
                    <div class="timeline-tooltip">{{ item.title }}</div>
                  </div>
                  <!-- Progress Indicator -->
                  <div class="timeline-progress" :style="{ left: Math.min(100, (currentVideoTime / totalVideoDuration) * 100) + '%' }"></div>
                </div>
              </div>

              <!-- Summary Loading State -->
              <div v-if="isAnalyzingSummary && takeaways.length === 0" class="takeaway-loading-placeholder animate-fade-in">
                <div class="loading-icon-pulse">
                  <Sparkles :size="32" class="spin" />
                </div>
                <div class="loading-text">
                  <h4>AI 正在提取核心摘要...</h4>
                  <p>我们正在深度分析视频文本并为您生成关键跳转点，请稍候。</p>
                </div>
              </div>

              <div v-else class="takeaways-list">
                <div
                  v-for="item in takeawayMap"
                  :key="item.id || item.index"
                  :id="`takeaway-${item.index}`"
                  class="transcript-item takeaway-item"
                  :class="{ 'active': activeTakeawayIndex === item.index }"
                  :style="activeTakeawayIndex === item.index ? { borderLeftColor: item.color, backgroundColor: item.color + '0a' } : {}"
                  @click="jumpToTakeaway(item, item.index)"
                >
                  <div class="seg-time" :style="{ color: item.color, backgroundColor: item.color + '1a' }">
                    <Clock :size="12" class="seg-time-icon" />
                    <span>{{ formatTimeFromSeconds(item.timestamp) }}</span>
                  </div>
                  <div class="takeaway-content">
                    <div class="takeaway-title">{{ item.title }}</div>
                    <div class="takeaway-summary">{{ item.summary }}</div>
                  </div>
                  <div class="seg-actions">
                    <button
                      class="btn-loop-action"
                      :class="{ 'active': selectedLoop?.id === (item.id || 'ta-' + item.index) }"
                      @click.stop="startLoop(item.timestamp, item.timestamp + item.actualDuration, item.id || 'ta-' + item.index)"
                      title="影子练习：循环播放此片段"
                    >
                      <RefreshCw :size="14" :class="{ 'spin': selectedLoop?.id === (item.id || 'ta-' + item.index) }" />
                    </button>
                    <button
                      class="btn-loop-action"
                      style="margin-left: 4px;"
                      :disabled="!!isClippingId"
                      @click.stop="openClippingDrawer(item.timestamp, item.timestamp + item.actualDuration)"
                      title="基于此片段手动微调剪辑"
                    >
                      <Scissors :size="14" />
                    </button>
                    <div class="seg-play-icon">
                      <Play :size="14" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- 新增：视频号发布提示区域 -->
              <div v-if="videoDescription || videoHashtags || keywordGlossary.length || showKeywordGlossaryForm || isGeneratingPublishAssist" class="channels-publish-section animate-fade-in">
                <div class="divider"></div>
                <div class="publish-header">
                  <div class="publish-badge">
                    <Sparkles :size="12" />
                    <span>视频号发布辅助</span>
                  </div>
                </div>

                <div v-if="isGeneratingPublishAssist && !videoDescription && !videoHashtags && !keywordGlossary.length && !showKeywordGlossaryForm" class="publish-item">
                  <div class="publish-content glossary-empty-state">
                    <Loader2 :size="16" class="spin" />
                    <span>正在生成发布文案、话题和词汇整理...</span>
                  </div>
                </div>

                <div v-if="videoDescription" class="publish-item">
                  <div class="publish-label">
                    <span>视频描述 / Description</span>
                    <button class="btn-copy-mini" @click="copyToClipboard(videoDescription)">
                      <span>点击复制</span>
                    </button>
                  </div>
                  <div class="publish-content">{{ videoDescription }}</div>
                </div>

                <div v-if="videoHashtags" class="publish-item">
                  <div class="publish-label">
                    <span>话题标签 / Hashtags</span>
                    <button class="btn-copy-mini" @click="copyToClipboard(videoHashtags)">
                      <span>点击复制</span>
                    </button>
                  </div>
                  <div class="publish-content hashtags">{{ videoHashtags }}</div>
                </div>

                <div v-if="keywordGlossary.length" class="publish-item">
                  <div class="publish-label">
                    <span>关键单词与短语 / Key Vocabulary</span>
                    <div class="publish-label-actions">
                      <button class="btn-copy-mini" @click="copyToClipboard(keywordGlossaryCopyText)">
                        <span>复制列表</span>
                      </button>
                      <button class="btn-copy-mini" @click="openKeywordGlossaryForm">
                        <span>手动增加</span>
                      </button>
                    </div>
                  </div>
                  <div class="glossary-grid">
                    <div
                      v-for="(item, index) in keywordGlossary"
                      :key="`${item.english}-${index}`"
                      class="glossary-card"
                    >
                      <div class="glossary-card-header">
                        <button
                          class="glossary-speak-btn"
                          :class="{ active: speakingGlossaryKey === `${item.english}-${index}` }"
                          @click="speakGlossaryItem(item, index)"
                          :title="`点读 ${item.english}`"
                        >
                          <Volume2 :size="14" />
                          <span>{{ speakingGlossaryKey === `${item.english}-${index}` ? '朗读中' : '点读' }}</span>
                        </button>
                        <span class="glossary-type">{{ item.type === 'word' ? '单词' : '短语' }}</span>
                      </div>
                      <div class="glossary-english">{{ item.english }}</div>
                      <div v-if="item.phonetic" class="glossary-phonetic">{{ item.phonetic }}</div>
                      <div class="glossary-chinese">{{ item.chinese }}</div>
                    </div>
                  </div>

                  <div class="glossary-list-panel">
                    <div class="glossary-list-header">
                      <span>可复制列表</span>
                      <span class="glossary-list-count">{{ keywordGlossary.length }} 条</span>
                    </div>
                    <pre class="glossary-list-text">{{ keywordGlossaryCopyText }}</pre>
                  </div>

                  <div v-if="showKeywordGlossaryForm" class="glossary-form">
                    <div class="glossary-form-row">
                      <input
                        v-model="keywordGlossaryForm.english"
                        type="text"
                        class="glossary-input"
                        placeholder="英文单词或短语"
                      />
                      <input
                        v-model="keywordGlossaryForm.phonetic"
                        type="text"
                        class="glossary-input"
                        placeholder="音标，可选，例如 /ˈwɔːtər/"
                      />
                    </div>
                    <div class="glossary-form-row single">
                      <input
                        v-model="keywordGlossaryForm.chinese"
                        type="text"
                        class="glossary-input"
                        placeholder="中文释义"
                      />
                    </div>
                    <div class="glossary-form-actions">
                      <select v-model="keywordGlossaryForm.type" class="glossary-select">
                        <option value="word">单词</option>
                        <option value="phrase">短语</option>
                      </select>
                      <button
                        class="btn-glossary-action secondary"
                        :disabled="isSavingKeywordGlossary"
                        @click="cancelKeywordGlossaryForm"
                      >
                        取消
                      </button>
                      <button
                        class="btn-glossary-action primary"
                        :disabled="isSavingKeywordGlossary"
                        @click="saveKeywordGlossaryItem"
                      >
                        {{ isSavingKeywordGlossary ? '保存中...' : '保存词条' }}
                      </button>
                    </div>
                  </div>
                </div>

                <div v-else class="publish-item">
                  <div class="publish-label">
                    <span>关键单词与短语 / Key Vocabulary</span>
                    <button class="btn-copy-mini" @click="openKeywordGlossaryForm">
                      <span>手动增加</span>
                    </button>
                  </div>
                  <div v-if="showKeywordGlossaryForm" class="glossary-form empty">
                    <div class="glossary-form-row">
                      <input
                        v-model="keywordGlossaryForm.english"
                        type="text"
                        class="glossary-input"
                        placeholder="英文单词或短语"
                      />
                      <input
                        v-model="keywordGlossaryForm.phonetic"
                        type="text"
                        class="glossary-input"
                        placeholder="音标，可选，例如 /ˈwɔːtər/"
                      />
                    </div>
                    <div class="glossary-form-row single">
                      <input
                        v-model="keywordGlossaryForm.chinese"
                        type="text"
                        class="glossary-input"
                        placeholder="中文释义"
                      />
                    </div>
                    <div class="glossary-form-actions">
                      <select v-model="keywordGlossaryForm.type" class="glossary-select">
                        <option value="word">单词</option>
                        <option value="phrase">短语</option>
                      </select>
                      <button
                        class="btn-glossary-action secondary"
                        :disabled="isSavingKeywordGlossary"
                        @click="cancelKeywordGlossaryForm"
                      >
                        取消
                      </button>
                      <button
                        class="btn-glossary-action primary"
                        :disabled="isSavingKeywordGlossary"
                        @click="saveKeywordGlossaryItem"
                      >
                        {{ isSavingKeywordGlossary ? '保存中...' : '保存词条' }}
                      </button>
                    </div>
                  </div>
                  <div v-else class="publish-content glossary-empty-state">
                    暂时还没有提炼出的关键词词条，你也可以先手动补充。
                  </div>
                </div>
              </div>

              <!-- 新增：嵌入式剪辑面板 / Embedded Clipping Panel -->
              <VideoClippingDrawer
                :show="showClippingDrawer"
                :video-id="videoId"
                :video-title="videoTitle"
                :current-time="currentVideoTime"
                :video-duration="totalVideoDuration"
                :initial-start="clippingRange.start"
                :initial-end="clippingRange.end"
                @close="showClippingDrawer = false"
                @seek="handleSeek"
                @start-loop="startLoop"
                @stop-loop="stopLoop"
              />
            </div>
          </div>


          <!-- Right Sidebar: Transcript & Chat -->
          <div v-if="showResult" class="outline-sidebar glass-panel animate-slide-in">
            <!-- Sidebar Tabs -->
            <div class="sidebar-tabs">
              <button
                class="sidebar-tab"
                :class="{ active: activeSidebarTab === 'transcript' }"
                @click="activeSidebarTab = 'transcript'"
              >
                <FileText :size="16" />
                <span>转录</span>
              </button>
              <button
                class="sidebar-tab"
                :class="{ active: activeSidebarTab === 'chat' }"
                @click="activeSidebarTab = 'chat'"
              >
                <MessageCircle :size="16" />
                <span>AI 助手</span>
                <span v-if="activeSidebarTab !== 'chat' && chatMessages.length > 0" class="tab-dot"></span>
              </button>
            </div>

            <!-- Tab Content: Transcript -->
            <div v-if="activeSidebarTab === 'transcript'" class="tab-pane">
              <div class="sidebar-header">
                <div class="sidebar-title-area">
                   <h3>视频转录</h3>
                 </div>
                  <div class="sidebar-actions">
                    <div v-if="isTranslating" class="translating-hint">
                      <Loader2 :size="12" class="spin" />
                      <span>正在翻译中文...</span>
                    </div>
                    <AppTooltip text="重建字幕分段：只刷新 cues，不重新分析" teleport>
                      <button
                        class="btn-search-in-video btn-rebuild-cues"
                        style="width: 32px; padding: 0;"
                        @click="openConfirmModal('rebuild-cues')"
                        :disabled="isRebuildingCues"
                      >
                        <FileText :size="14" :class="{ 'spin': isRebuildingCues }" />
                      </button>
                    </AppTooltip>
                    <AppTooltip text="仅重翻译展示字幕：不重抓字幕、不重跑摘要" teleport>
                      <button
                        class="btn-search-in-video btn-retranslate-cues"
                        style="width: 32px; padding: 0;"
                        @click="openConfirmModal('retranslate-cues')"
                        :disabled="isRetranslatingCues"
                      >
                        <RefreshCw :size="14" :class="{ 'spin': isRetranslatingCues }" />
                      </button>
                    </AppTooltip>
                    <AppTooltip text="重新分析视频：重新抓字幕、翻译并重跑 AI" teleport>
                      <button
                        class="btn-search-in-video btn-force-analyze"
                        style="width: 32px; padding: 0;"
                        @click="openConfirmModal('force-analyze')"
                        :disabled="isLoading"
                      >
                        <Sparkles :size="14" :class="{ 'spin': isLoading }" />
                      </button>
                    </AppTooltip>
                    <div class="sidebar-divider"></div>
                    <button
                      v-if="hasBilingualData"
                      class="toggle-bilingual-btn"
                      :class="{ active: isBilingual }"
                      @click="isBilingual = !isBilingual"
                      title="切换中英双语"
                    >
                      {{ isBilingual ? '双语' : '单语' }}
                    </button>
                    <span class="badge">{{ mergedTranscript.length }} 条记录</span>
                  </div>
               </div>

            <div
              class="transcript-list"
              @scroll="handleTranscriptScroll"
              @mouseenter="handleTranscriptMouseEnter"
              @mouseleave="handleTranscriptMouseLeave"
              ref="transcriptListRef"
            >
                <div
                  v-for="(seg, index) in mergedTranscript"
                  :key="index"
                  :id="`seg-${index}`"
                  class="transcript-item"
                  :class="{ 'active': activeTranscriptIndex === index, editing: editingSegIndex === index }"
                  @click="jumpToTranscript(seg, index)"
                >
                  <div class="seg-time">
                    <Clock :size="12" class="seg-time-icon" />
                    <span>{{ formatTranscriptTime(mergedTranscript, index) }}</span>
                  </div>
                  <div class="seg-text">
                    <div
                      v-if="isBilingual && seg.translatedText"
                      class="translated-text"
                      :class="{ collapsed: shouldCollapseTranscript(seg) && !isTranscriptExpanded(seg, index) }"
                    >
                      {{ seg.translatedText }}
                    </div>
                    <div
                      class="original-text"
                      :class="{
                        'has-translation': isBilingual && seg.translatedText,
                        collapsed: shouldCollapseTranscript(seg) && !isTranscriptExpanded(seg, index)
                      }"
                    >
                      {{ seg.text }}
                    </div>
                    <button
                      v-if="shouldCollapseTranscript(seg)"
                      class="seg-expand-btn"
                      @click.stop="toggleTranscriptExpanded(seg, index)"
                    >
                      {{ isTranscriptExpanded(seg, index) ? '收起' : '展开全文' }}
                    </button>
                  </div>
                  <div class="seg-actions">
                    <button class="btn-loop-action" @click.stop="startEdit(seg, index)" title="修正字幕或翻译">
                      <Edit2 :size="14" />
                    </button>
                    <button
                      class="btn-loop-action"
                      :class="{ 'active': selectedLoop?.id === 'seg-' + index }"
                      @click.stop="startLoop(seg.offset / 1000, (seg.offset + seg.duration) / 1000, 'seg-' + index)"
                      title="循环播放此句"
                    >
                      <RefreshCw :size="14" :class="{ 'spin': selectedLoop?.id === 'seg-' + index }" />
                    </button>
                    <button
                      class="btn-loop-action"
                      style="margin-left: 4px;"
                      @click.stop="openClippingDrawer(seg.offset / 1000, (seg.offset + seg.duration) / 1000)"
                      title="基于此句剪辑"
                    >
                      <Scissors :size="14" />
                    </button>
                    <div class="seg-play-icon">
                      <Play :size="14" />
                    </div>
                  </div>
                  <div
                    v-if="editingSegIndex === index"
                    class="inline-edit-panel"
                    @click.stop
                  >
                    <div class="inline-edit-header">
                      <span class="inline-edit-title">编辑当前字幕</span>
                      <span class="inline-edit-time">{{ formatTranscriptTime(mergedTranscript, index) }}</span>
                    </div>
                    <div class="inline-edit-grid">
                      <label class="inline-edit-group">
                        <span class="inline-edit-label">中文翻译</span>
                        <textarea
                          v-model="editForm.translatedText"
                          class="inline-edit-textarea"
                          rows="3"
                          placeholder="请输入中文翻译..."
                          :disabled="isSavingEdit"
                        ></textarea>
                      </label>
                      <label class="inline-edit-group">
                        <span class="inline-edit-label">原始内容</span>
                        <textarea
                          v-model="editForm.text"
                          class="inline-edit-textarea"
                          rows="3"
                          placeholder="Original content here..."
                          :disabled="isSavingEdit"
                        ></textarea>
                      </label>
                    </div>
                    <div class="inline-edit-actions">
                      <button
                        class="inline-edit-btn ghost"
                        @click.stop="cancelEdit"
                        :disabled="isSavingEdit"
                      >
                        取消
                      </button>
                      <button
                        class="inline-edit-btn primary"
                        @click.stop="editingSegment && saveEdit(editingSegment)"
                        :disabled="isSavingEdit"
                      >
                        <Loader2 v-if="isSavingEdit" :size="14" class="spin" />
                        <span>{{ isSavingEdit ? '保存中...' : '保存修改' }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tab Content: AI Chat -->
            <div v-else class="tab-pane chat-pane">
              <div ref="chatListRef" class="chat-messages" @scroll="handleChatScroll">
                <div v-if="chatMessages.length === 0" class="chat-empty">
                  <div class="empty-icon-wrapper">
                    <Bot :size="40" class="accent-glow-text" />
                  </div>
                  <h4>我是你的 AI 视频助手</h4>
                  <p>你可以问我关于视频内容的任何问题</p>
                  <div class="quick-prompts">
                    <button class="quick-prompt-btn" @click="chatInput = '总结一下这个视频的核心要点'; sendChatMessage()">总结核心要点</button>
                    <button class="quick-prompt-btn" @click="chatInput = '视频中提到了哪些具体的建议？'; sendChatMessage()">有哪些建议？</button>
                  </div>
                </div>

                <div
                  v-for="(msg, idx) in chatMessages"
                  :key="idx"
                  class="chat-message-wrapper"
                  :class="msg.role"
                >
                  <div class="message-avatar">
                    <Bot v-if="msg.role === 'assistant'" :size="16" />
                    <UserIcon v-else :size="16" />
                  </div>
                  <div class="message-bubble">
                    <div v-if="msg.content" class="message-content">
                      <template v-for="(part, pIdx) in parseMessageContent(msg.content)">
                        <span v-if="part.type === 'text'" :key="'text-' + idx + '-' + pIdx">{{ part.value }}</span>
                        <a
                          v-else-if="part.type === 'timestamp'"
                          :key="'ts-' + idx + '-' + pIdx"
                          href="javascript:void(0)"
                          class="timestamp-link"
                          @click="handleTimestampClick(part.value)"
                        >
                          {{ part.value }}
                        </a>
                      </template>
                    </div>
                    <div v-else-if="isChatLoading && idx === chatMessages.length - 1" class="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Chat Input -->
              <div class="chat-input-wrapper">
                <div class="input-container">
                  <textarea
                    v-model="chatInput"
                    placeholder="问点什么..."
                    @keydown.enter.prevent="sendChatMessage"
                    :disabled="isChatLoading"
                  ></textarea>
                  <button
                    class="send-btn"
                    :disabled="!chatInput.trim() || isChatLoading"
                    @click="sendChatMessage"
                  >
                    <Send :size="18" />
                  </button>
            </div>
          </div>
        </div>
      </div>

      <Teleport to="body">
        <!-- Mind Map Modal -->
        <MindMapModal
          :show="showMindMap"
          :markdown="mindmapRaw"
          :title="videoTitle"
          @close="showMindMap = false"
        />

        <VideoSearchModal
          :show="showSearchModal"
          :video-id="videoId"
          :video-title="videoTitle"
          @close="showSearchModal = false"
          @seek="handleSeek"
        />

        <ConfirmActionModal
          :show="pendingAction !== null"
          :title="pendingAction === 'rebuild-cues'
            ? '确认重建字幕分段'
            : pendingAction === 'retranslate-cues'
              ? '确认仅重翻译展示字幕'
              : '确认重新分析视频'"
          :message="pendingAction === 'rebuild-cues'
            ? '这会根据当前原始字幕重新生成 cues 分段，但不会重新抓取字幕，也不会重新跑 AI 分析。'
            : pendingAction === 'retranslate-cues'
              ? '这会仅重建并重翻译展示用的字幕 cues，不重新抓取字幕，也不重新生成摘要、脑图和发布辅助。'
              : '这会重新抓取字幕、翻译并重跑 AI 分析，适合在字幕错位或翻译异常时使用。'"
          :confirm-text="pendingAction === 'rebuild-cues'
            ? '开始重建'
            : pendingAction === 'retranslate-cues'
              ? '开始重翻译'
              : '重新分析'"
          :loading="pendingAction === 'rebuild-cues'
            ? isRebuildingCues
            : pendingAction === 'retranslate-cues'
              ? isRetranslatingCues
              : isLoading"
          @close="closeConfirmModal"
          @confirm="confirmPendingAction"
        />

        <ActionNoticeModal
          :show="actionNotice !== null"
          :title="actionNotice?.title || ''"
          :message="actionNotice?.message || ''"
          :type="actionNotice?.type || 'info'"
          @close="closeActionNotice"
        />

      </Teleport>
    </div>
  </div>
</template>

<style scoped>
/* App Layout */
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scroll-behavior: smooth;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-menu-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-menu-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  color: var(--accent-color);
}

.text-gradient {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(to right, #F0F0F0, var(--text-accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

/* Input Area */
.input-group {
  display: flex;
  align-items: center;
  padding: 6px 6px 6px 20px;
  width: 50%;
  max-width: 600px;
  border-radius: 100px;
  transition: all var(--transition-normal);
}

.input-group:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 1rem;
  font-family: inherit;
}

input::placeholder {
  color: var(--text-secondary);
}

/* Buttons */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-color);
  color: white;
  padding: 10px 24px;
  border-radius: 100px;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.btn-primary:hover:not(:disabled) {
  background: #4F46E5;
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: 100px;
  font-weight: 500;
  font-size: 0.95rem;
  border: 1px solid var(--border-color);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.btn-text {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s;
}

.btn-text:hover {
  color: var(--text-primary);
}

.btn-mindmap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-color);
  padding: 6px 12px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
  border: 1px solid rgba(99, 102, 241, 0.2);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.btn-mindmap:hover {
  background: var(--accent-color);
  color: white;
  /* transform: translateY(-1px); */
}

/* User Profile */
.user-action {
  display: flex;
  align-items: center;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color);
}

.avatar-fallback {
  color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 4px;
  border-radius: 50%;
}

.user-name {
  font-weight: 500;
  font-size: 0.95rem;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon { display: inline-block; }

.spin {
  animation: spinner 1s linear infinite;
}

@keyframes spinner {
  to { transform: rotate(360deg); }
}

/* Main Area */
.main-content {
  flex: 1;
  padding: 40px;
  display: flex;
  justify-content: center;
}

.container {
  width: 100%;
  max-width: 1900px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
  margin-top: 60px;
  border-style: dashed;
}

.empty-icon-wrap {
  background: rgba(99, 102, 241, 0.1);
  padding: 24px;
  border-radius: 50%;
  margin-bottom: 24px;
}

.empty-icon {
  color: var(--accent-color);
}

.empty-state h2 {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 16px;
}

.empty-state p {
  color: var(--text-secondary);
  max-width: 500px;
  font-size: 1.1rem;
  line-height: 1.6;
}

/* Grid Layout */
.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.content-grid.has-sidebar {
  grid-template-columns: 1fr 640px;
}

/* Left Column: Video + Takeaways */
.left-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.video-section {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: max-content;
  /* position: sticky;
  top: 100px;
  z-index: 10; */
}

.video-subtitle-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.video-subtitle-toolbar-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.video-subtitle-toolbar-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text-primary);
}

.video-subtitle-toolbar-hint {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.subtitle-dock-toggle {
  flex-shrink: 0;
}

.video-subtitle-dock {
  border: 1px solid rgba(99, 102, 241, 0.22);
  background:
    linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(15, 23, 42, 0.68)),
    rgba(255, 255, 255, 0.03);
  border-radius: 16px;
  padding: 14px 22px 18px;
  box-shadow: 0 16px 28px -20px rgba(99, 102, 241, 0.55);
  cursor: pointer;
  transition: all 0.2s ease;
}

.video-subtitle-dock:hover {
  border-color: rgba(99, 102, 241, 0.38);
  transform: translateY(-1px);
}

.video-subtitle-dock-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.video-subtitle-time {
  background: rgba(99, 102, 241, 0.14);
  color: var(--text-accent);
}

.video-subtitle-dock-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.subtitle-dock-action {
  opacity: 1;
}

.video-subtitle-dock-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  min-height: 104px;
  padding: 6px 12px 2px;
}

.video-subtitle-dock-translated {
  width: min(100%, 760px);
  font-size: clamp(1.6rem, 2.2vw, 2.2rem);
  line-height: 1.45;
  color: #ffffff;
  font-weight: 700;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.01em;
  text-shadow: 0 4px 18px rgba(15, 23, 42, 0.35);
}

.video-subtitle-dock-original {
  width: min(100%, 760px);
  font-size: 0.98rem;
  line-height: 1.6;
  color: rgba(226, 232, 240, 0.92);
  white-space: pre-wrap;
  word-break: break-word;
}

.video-subtitle-dock-original.has-translation {
  color: rgba(226, 232, 240, 0.58);
  font-size: 0.92rem;
}

/* Takeaways Section (below video) */
.takeaways-section {
  padding: 24px;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 11;
  overflow: hidden; /* 确保下拉面板在容器内滑动 / Ensure slidedown stays within container */
}

.takeaways-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}


/* Sidebar Tabs */
.sidebar-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s ease;
  position: relative;
}

.sidebar-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.sidebar-tab.active {
  background: rgba(0, 163, 255, 0.1);
  color: var(--accent-color);
}

.tab-dot {
  position: absolute;
  top: 8px;
  right: 12px;
  width: 6px;
  height: 6px;
  background: var(--accent-color);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--accent-shadow);
}

.tab-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Chat Pane */
.chat-pane {
  display: flex;
  flex-direction: column;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Removed scroll-behavior: smooth to prevent jitter during streaming */
  overflow-anchor: auto;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-secondary);
  padding: 20px;
}

.empty-icon-wrapper {
  margin-bottom: 16px;
  padding: 20px;
  background: rgba(0, 163, 255, 0.05);
  border-radius: 50%;
}

.chat-empty h4 {
  color: var(--text-primary);
  margin-bottom: 8px;
  font-size: 1.1rem;
}

.chat-empty p {
  font-size: 0.9rem;
  margin-bottom: 24px;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.quick-prompt-btn {
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.quick-prompt-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent-color);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.chat-message-wrapper {
  display: flex;
  gap: 12px;
  max-width: 90%;
}

.chat-message-wrapper.user {
  flex-direction: row-reverse;
  align-self: flex-end;
}

.chat-message-wrapper.assistant {
  align-self: flex-start;
}

.message-avatar {
  width: 30px;
  height: 30px;
  min-width: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
}

.user .message-avatar {
  background: var(--accent-color);
  color: white;
}

.assistant .message-avatar {
  background: rgba(0, 163, 255, 0.1);
  color: var(--accent-color);
  border-color: rgba(0, 163, 255, 0.2);
}

.message-bubble {
  padding: 12px 14px;
  border-radius: 16px;
  font-size: 0.95rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.user .message-bubble {
  background: var(--accent-color);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 12px var(--accent-shadow);
}

.assistant .message-bubble {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

.timestamp-link {
  color: var(--accent-color);
  text-decoration: none;
  font-weight: 600;
  padding: 0 2px;
  border-bottom: 1.5px dashed var(--accent-color);
  cursor: pointer;
}

.timestamp-link:hover {
  background: rgba(0, 163, 255, 0.1);
}

/* Typing Indicator */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) { animation-delay: 0s; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Chat Input */
.chat-input-wrapper {
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.input-container {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 8px 12px;
  transition: all 0.2s ease;
}

.input-container:focus-within {
  border-color: var(--accent-color);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 15px rgba(0, 163, 255, 0.1);
}

.input-container textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.95rem;
  padding: 6px 0;
  resize: none;
  max-height: 120px;
  min-height: 24px;
  line-height: 1.5;
}

.input-container textarea:focus {
  outline: none;
}

.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--accent-color);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.05);
  background: #0088cc;
}

.send-btn:disabled {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
}

/* Updated Sidebar Header for Tabs */
.outline-sidebar {
  padding: 0 !important;
  overflow: visible;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 140px);
  position: sticky;
  top: 100px;
  z-index: 20;
}

.accent { color: var(--accent-color); }
.accent-light { color: var(--text-accent); }

.sidebar-header {
  padding: 18px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
  z-index: 500; /* 高层级，确保下拉菜单不被下方内容遮挡 */
  overflow: visible !important; /* 允许内部下拉菜单溢出边界 */
}

.sidebar-title-area {
  display: flex;
  flex-direction: column;
}

.sidebar-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.title-badge {
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-color);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  margin-left: 4px;
  font-family: 'JetBrains Mono', monospace;
}


.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
  position: relative;
  overflow: visible !important; /* 核心：允许子组件菜单溢出 */
}

.translating-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--accent-color);
  opacity: 0.8;
  padding-right: 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}

/* Premium Badge Style */
.badge {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.badge:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
}

.btn-search-in-video, .btn-mindmap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  padding: 0 12px;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  height: 32px;
}

.btn-rebuild-cues {
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
}

.btn-rebuild-cues:hover:not(:disabled) {
  border-color: rgba(34, 197, 94, 0.35);
  color: #b6f4c6;
  background: rgba(34, 197, 94, 0.14);
}

.btn-force-analyze {
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
}

.btn-force-analyze:hover:not(:disabled) {
  border-color: rgba(99, 102, 241, 0.35);
  color: #d0d5ff;
  background: rgba(99, 102, 241, 0.14);
}

.btn-retranslate-cues {
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
}

.btn-retranslate-cues:hover:not(:disabled) {
  border-color: rgba(14, 165, 233, 0.35);
  color: #c8efff;
  background: rgba(14, 165, 233, 0.14);
}

.btn-search-in-video:hover:not(:disabled), .btn-mindmap:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn-mindmap {
  /* 移除特殊的紫色背景，保持统一 */
}

.sidebar-header-divider {
  flex: 1;
  min-width: 8px;
}

.sidebar-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}


/* Adjust timeline tooltip background to match */
.timeline-tooltip {
  background: #1e293b !important;
}
.timeline-tooltip::before {
  background: #1e293b !important;
}

/* Bilingual Toggle Button */
.toggle-bilingual-btn {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle-bilingual-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
}

.toggle-bilingual-btn.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-light);
  box-shadow: 0 4px 12px var(--accent-shadow);
}

.transcript-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px 16px;
}

.transcript-item {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
  position: relative;
  transform-origin: left center;
}

.transcript-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-hover);
}

.transcript-item.active {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.25);
  transform: translateX(6px);
}

.transcript-item.editing {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
}

.transcript-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--accent-color);
  border-radius: 3px;
  animation: indicator-grow 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

/* Time pill */
.seg-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 8px;
  border-radius: 6px;
  min-width: 58px;
  white-space: nowrap;
  transition: all var(--transition-fast);
  margin-top: 1px;
}

.seg-time-icon {
  opacity: 0.6;
}

.transcript-item.active .seg-time,
.transcript-item:hover .seg-time {
  color: var(--text-accent);
  background: rgba(99, 102, 241, 0.12);
}

/* Text content */
.seg-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.translated-text {
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-word;
  white-space: pre-line;
}

.original-text {
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--text-secondary);
  word-break: break-word;
  white-space: pre-line;
}

.original-text.has-translation {
  opacity: 0.7;
  font-size: 0.8rem;
}

.translated-text.collapsed,
.original-text.collapsed {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.translated-text.collapsed {
  -webkit-line-clamp: 4;
}

.original-text.collapsed {
  -webkit-line-clamp: 3;
}

.seg-expand-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent-color);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.seg-expand-btn:hover {
  color: var(--accent-light);
}

.transcript-item:not(.active) .seg-text {
  color: var(--text-secondary);
}

.transcript-item.active .seg-text {
  color: var(--text-primary);
  font-weight: 500;
}

/* Play icon */
.seg-play-icon {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  opacity: 0;
  transform: scale(0.8);
  transition: all var(--transition-fast);
  margin-top: 2px;
}

.transcript-item:hover .seg-play-icon {
  opacity: 0.6;
  transform: scale(1);
}

.transcript-item.active .seg-play-icon {
  opacity: 1;
  transform: scale(1);
  color: var(--accent-color);
}

/* Loop Action Button */
.seg-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-edit-panel {
  width: 100%;
  margin-left: 70px;
  margin-top: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inline-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.inline-edit-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
}

.inline-edit-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.inline-edit-grid {
  display: grid;
  gap: 10px;
}

.inline-edit-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inline-edit-label {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.inline-edit-textarea {
  width: 100%;
  resize: vertical;
  min-height: 74px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(12, 15, 24, 0.78);
  color: var(--text-primary);
  padding: 10px 12px;
  line-height: 1.5;
  font-size: 0.88rem;
}

.inline-edit-textarea:focus {
  outline: none;
  border-color: rgba(99, 102, 241, 0.55);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.inline-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.inline-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.inline-edit-btn.ghost {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border-color: rgba(255, 255, 255, 0.1);
}

.inline-edit-btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.inline-edit-btn.primary {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

.inline-edit-btn.primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.inline-edit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loop-action {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0;
}

.transcript-item:hover .btn-loop-action,
.transcript-item.active .btn-loop-action {
  opacity: 1;
}

.btn-loop-action:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.btn-loop-action.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
  box-shadow: 0 0 10px var(--accent-shadow);
  opacity: 1;
}

/* Animations */
/* Timeline Map */
.takeaways-timeline-container {
  padding: 0 24px 16px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.takeaways-timeline {
  width: 100%;
  height: 20px;
  background-color: var(--bg-hover);
  border-radius: 999px;
  position: relative;
  overflow: visible; /* to allow indicator dot to pop out */
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.timeline-segment {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 999px;
  opacity: 0.6;
  transition: all var(--transition-fast);
}

.timeline-segment:hover {
  opacity: 0.85;
}

.timeline-segment.active {
  opacity: 1;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.2) inset;
  z-index: 5;
}

.timeline-tooltip {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  border: 1px solid var(--border-color);
  z-index: 20;
}

.timeline-tooltip::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  z-index: -1;
}

.timeline-segment:hover .timeline-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(12px);
}

.timeline-progress {
  position: absolute;
  top: -8px;
  bottom: -8px;
  width: 2px;
  background: linear-gradient(to bottom,
    transparent,
    var(--accent-color) 20%,
    var(--accent-color) 80%,
    transparent
  );
  z-index: 10;
  pointer-events: none;
  transition: left 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.5); /* Glowing needle body */
}

.timeline-progress::before {
  content: '';
  position: absolute;
  top: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  background-color: var(--accent-color);
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 12px var(--accent-color), 0 2px 4px rgba(0,0,0,0.5);
}

/* Takeaway Item Styles */
.video-title-hint {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px; /* 缩短标题预览宽度，优先保证右侧按钮 */
}

.takeaway-content {
  flex: 1;
  min-width: 0;
}

.takeaway-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 4px;
}

.takeaway-summary {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.takeaway-item .takeaway-title,
.takeaway-item .takeaway-summary {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.takeaway-item:not(.active) .takeaway-title {
  color: var(--text-secondary);
}

.takeaway-item.active .takeaway-title {
  color: var(--text-primary);
}

.takeaway-item.active .takeaway-summary {
  color: var(--text-primary);
  opacity: 0.8;
}

@keyframes indicator-grow {
  from { transform: scaleY(0); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.animate-slide-in {
  animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Error State */
.error-state {
  border-color: rgba(239, 68, 68, 0.3);
}

.error-icon-wrap {
  background: rgba(239, 68, 68, 0.1) !important;
}

.error-icon {
  color: #ef4444 !important;
}

/* Responsive */
@media (max-width: 1024px) {
  .content-grid.has-sidebar {
    grid-template-columns: 1fr;
  }

  .outline-sidebar {
    height: 400px;
    position: static;
  }

  .video-subtitle-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .subtitle-dock-toggle {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .video-subtitle-dock {
    padding: 14px;
  }

  .video-subtitle-dock-meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .video-subtitle-dock-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .video-subtitle-dock-text {
    min-height: 88px;
    padding-inline: 4px;
  }

  .video-subtitle-dock-translated {
    font-size: clamp(1.3rem, 5.4vw, 1.7rem);
  }

  .video-subtitle-dock-original {
    font-size: 0.86rem;
  }
}


.btn-search-in-video:disabled, .btn-mindmap:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(0.6);
}

.takeaway-loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 20px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  margin: 20px 0;
  text-align: center;
}

.loading-icon-pulse {
  background: rgba(99, 102, 241, 0.1);
  padding: 20px;
  border-radius: 50%;
  color: var(--accent-color);
  animation: pulse-glow 2s infinite ease-in-out;
}

.loading-text h4 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: #fff;
}

.loading-text p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  max-width: 400px;
}

@keyframes pulse-glow {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  70% { box-shadow: 0 0 0 15px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

/* Channels Publish Section */
.channels-publish-section {
  padding: 16px 24px 24px;
  background: rgba(255, 255, 255, 0.02);
  margin-top: 12px;
}

.publish-header {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
}

.publish-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.publish-item {
  margin-bottom: 16px;
}

.publish-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.publish-label-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.publish-content {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.publish-content.hashtags {
  color: var(--accent-color);
  font-weight: 500;
}

.glossary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}

.glossary-card {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.glossary-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.glossary-type {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  color: var(--accent-color);
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.24);
}

.glossary-speak-btn {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 4px 9px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.18s ease;
}

.glossary-speak-btn:hover {
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
}

.glossary-speak-btn.active {
  color: #0ea5e9;
  border-color: rgba(14, 165, 233, 0.35);
  background: rgba(14, 165, 233, 0.12);
}

.glossary-english {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.35;
  word-break: break-word;
}

.glossary-phonetic {
  font-size: 0.82rem;
  color: #7dd3fc;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.4;
  word-break: break-word;
}

.glossary-chinese {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.glossary-list-panel {
  margin-top: 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.24);
  padding: 12px 14px;
}

.glossary-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.glossary-list-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.74rem;
  color: var(--accent-light);
}

.glossary-list-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
}

.glossary-form {
  margin-top: 14px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.glossary-form.empty {
  margin-top: 0;
}

.glossary-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.glossary-form-row.single {
  grid-template-columns: 1fr;
}

.glossary-input,
.glossary-select {
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: 0.9rem;
}

.glossary-input:focus,
.glossary-select:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.14);
}

.glossary-form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
}

.btn-glossary-action {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-glossary-action.secondary {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-secondary);
}

.btn-glossary-action.secondary:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.18);
}

.btn-glossary-action.primary {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

.btn-glossary-action.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.btn-glossary-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.glossary-empty-state {
  color: var(--text-secondary);
}

.btn-copy-mini {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-copy-mini:hover {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

.divider {
  height: 1px;
  background: linear-gradient(to right, transparent, var(--border-color), transparent);
  margin-bottom: 24px;
}
</style>
