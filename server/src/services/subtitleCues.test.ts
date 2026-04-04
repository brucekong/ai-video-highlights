import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubtitleCues, carryOverTranslationsFromExistingCues } from './subtitleCues.js';

test('keeps short lead sentence pairs intact to avoid orphaned recovery cues', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 35,
      text: 'Oh no, I am late for my interview. Oh',
      translatedText: '哦不，我面试要迟到了。',
      offset: 110240,
      duration: 6960,
    },
    {
      sortOrder: 36,
      text: 'no. Why are there so many cars?',
      translatedText: undefined,
      offset: 113439,
      duration: 6720,
    },
    {
      sortOrder: 37,
      text: 'Sorry sir, the road is under',
      translatedText: undefined,
      offset: 117200,
      duration: 5959,
    },
    {
      sortOrder: 38,
      text: 'construction.',
      translatedText: undefined,
      offset: 120159,
      duration: 3000,
    },
  ]);

  assert.equal(cues[0]?.text, 'Oh no, I am late for my interview.');
  assert.equal(cues[1]?.text, 'Oh no. Why are there so many cars?');
  assert.equal(cues[2]?.text, 'Sorry sir, the road is under construction.');
  assert.equal(cues.length, 3);
});

test('merges short overlapping completion tails back into the previous cue', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 33,
      text: 'Dad,',
      translatedText: undefined,
      offset: 67680,
      duration: 4000,
    },
    {
      sortOrder: 34,
      text: 'I wish you would look at me sometimes.',
      translatedText: undefined,
      offset: 68799,
      duration: 5441,
    },
    {
      sortOrder: 35,
      text: "Sometimes I feel like I'm growing up",
      translatedText: undefined,
      offset: 71680,
      duration: 5560,
    },
    {
      sortOrder: 36,
      text: 'alone.',
      translatedText: '独自长大。',
      offset: 74240,
      duration: 3000,
    },
  ]);

  assert.equal(cues[0]?.text, 'Dad, I wish you would look at me sometimes.');
  assert.equal(cues[1]?.text, "Sometimes I feel like I'm growing up alone.");
  assert.equal(cues[1]?.translatedText, '独自长大。');
  assert.equal(cues.length, 2);
});

test('merges adjective tails like new with the following noun completion', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 11,
      text: 'Look at Leo in his beautiful new',
      translatedText: '看看利奥穿着他漂亮的新',
      offset: 32320,
      duration: 5280,
    },
    {
      sortOrder: 12,
      text: 'uniform.',
      translatedText: '制服。',
      offset: 35280,
      duration: 6640,
    },
  ]);

  assert.equal(cues[0]?.text, 'Look at Leo in his beautiful new uniform.');
  assert.equal(cues[0]?.translatedText, '看看利奥穿着他漂亮的新制服。');
  assert.equal(cues.length, 1);
});

test('keeps the previous sentence separate while merging question plus very hard together', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 55,
      text: 'Come on, Leo. You can do it today.',
      translatedText: undefined,
      offset: 197760,
      duration: 7280,
    },
    {
      sortOrder: 56,
      text: 'How can I hit this ball? Very',
      translatedText: undefined,
      offset: 202720,
      duration: 4080,
    },
    {
      sortOrder: 57,
      text: 'hard.',
      translatedText: '用力。',
      offset: 205040,
      duration: 6839,
    },
  ]);

  assert.equal(cues[0]?.text, 'Come on, Leo. You can do it today.');
  assert.equal(cues[1]?.text, 'How can I hit this ball? Very hard.');
  assert.equal(cues.length, 2);
});

test('keeps question plus very fragment together before merging with the next subtitle', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 56,
      text: 'How can I hit this ball? Very',
      translatedText: '我怎么能击中这个球？',
      offset: 202720,
      duration: 4080,
    },
    {
      sortOrder: 57,
      text: 'hard.',
      translatedText: '用力。',
      offset: 205040,
      duration: 6839,
    },
  ]);

  assert.equal(cues[0]?.text, 'How can I hit this ball? Very hard.');
  assert.equal(cues[0]?.translatedText, '我怎么能击中这个球？ 用力。');
  assert.equal(cues.length, 1);
});

test('keeps because-clauses after a question as a new cue while still finishing the clause', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 72,
      text: 'Why must we never give up in life?',
      translatedText: undefined,
      offset: 262479,
      duration: 6401,
    },
    {
      sortOrder: 73,
      text: 'Because trying your best makes you very',
      translatedText: undefined,
      offset: 266080,
      duration: 5800,
    },
    {
      sortOrder: 74,
      text: 'proud.',
      translatedText: undefined,
      offset: 268880,
      duration: 3000,
    },
  ]);

  assert.equal(cues[0]?.text, 'Why must we never give up in life?');
  assert.equal(cues[1]?.text, 'Because trying your best makes you very proud.');
  assert.equal(cues.length, 2);
});

test('merges copular adjective tails like perfect with following for-phrases', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 78,
      text: 'This birthday  cake is perfect',
      translatedText: '这个生日蛋糕很完美',
      offset: 263759,
      duration: 4880,
    },
    {
      sortOrder: 79,
      text: 'for her.',
      translatedText: '为她。',
      offset: 266000,
      duration: 7800,
    },
    {
      sortOrder: 80,
      text: 'Are we ready for the big surprise now?',
      translatedText: '我们现在准备好迎接大惊喜了吗？',
      offset: 268639,
      duration: 5161,
    },
  ]);

  assert.equal(cues[0]?.text, 'This birthday  cake is perfect for her.');
  assert.equal(cues[0]?.translatedText, '这个生日蛋糕很完美为她。');
  assert.equal(cues[1]?.text, 'Are we ready for the big surprise now?');
  assert.equal(cues.length, 2);
});

test('allows continuation merges that barely exceed the old 10 second limit', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 1,
      text: 'We should go',
      translatedText: undefined,
      offset: 0,
      duration: 4200,
    },
    {
      sortOrder: 2,
      text: 'to the park today.',
      translatedText: undefined,
      offset: 2500,
      duration: 8000,
    },
  ]);

  assert.equal(cues[0]?.text, 'We should go to the park today.');
  assert.equal(cues.length, 1);
});

test('merges interesting with the following noun completion', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 246,
      text: 'Phew. The trip was very busy and tiring,',
      translatedText: undefined,
      offset: 788800,
      duration: 6719,
    },
    {
      sortOrder: 247,
      text: 'but it was also an interesting',
      translatedText: undefined,
      offset: 793440,
      duration: 3440,
    },
    {
      sortOrder: 248,
      text: 'experience.',
      translatedText: '经历。',
      offset: 795519,
      duration: 4161,
    },
  ]);

  assert.equal(
    cues[0]?.text,
    'Phew. The trip was very busy and tiring, but it was also an interesting experience.',
  );
  assert.equal(cues[0]?.translatedText, '经历。');
  assert.equal(cues.length, 1);
});

test('merges not with the following correction name', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 293,
      text: "Oh, no. Close. But my name's Emma, not",
      translatedText: '但我的名字是艾玛，不是',
      offset: 962399,
      duration: 5921,
    },
    {
      sortOrder: 294,
      text: 'Emmy.',
      translatedText: '艾米。',
      offset: 966880,
      duration: 6160,
    },
  ]);

  assert.equal(cues[0]?.text, 'Oh, no. Close.');
  assert.equal(cues[1]?.text, 'But my name\'s Emma, not Emmy.');
  assert.equal(cues[1]?.translatedText, '艾米。');
  assert.equal(cues.length, 2);
});

test('merges comma-led vocative names like Peter back into the sentence', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 284,
      text: "We did it. We didn't crash.",
      translatedText: undefined,
      offset: 930639,
      duration: 6721,
    },
    {
      sortOrder: 285,
      text: "That's not something you say out loud,",
      translatedText: undefined,
      offset: 934880,
      duration: 3759,
    },
    {
      sortOrder: 286,
      text: 'Peter.',
      translatedText: '彼得。',
      offset: 937360,
      duration: 5960,
    },
  ]);

  assert.equal(cues[0]?.text, "We did it. We didn't crash.");
  assert.equal(cues[1]?.text, "That's not something you say out loud, Peter.");
  assert.equal(cues[1]?.translatedText, '彼得。');
  assert.equal(cues.length, 2);
});

test('merges contraction tails like don\'t with the following verb phrase', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 336,
      text: "If you enjoyed today&#39;s story, don&#39;t",
      translatedText: '如果你喜欢今天的故事，不要',
      offset: 1106880,
      duration: 9120,
    },
    {
      sortOrder: 337,
      text: 'forget to like this video and subscribe',
      translatedText: '忘记点赞这个视频并订阅',
      offset: 1111440,
      duration: 8640,
    },
  ]);

  assert.equal(cues[0]?.text, "If you enjoyed today&#39;s story, don&#39;t forget to like this video and subscribe");
  assert.equal(cues[0]?.translatedText, '如果你喜欢今天的故事，不要忘记点赞这个视频并订阅');
  assert.equal(cues.length, 1);
});

test('carries over old cue chinese text onto rebuilt cue layouts without retranslation', () => {
  const generatedCues = [
    {
      text: "We did it. We didn't crash. That's not something you say out loud, Peter.",
      translatedText: '彼得。',
      offset: 930639,
      duration: 12681,
      sortOrder: 0,
      sourceStartSortOrder: 284,
      sourceEndSortOrder: 286,
      layoutVersion: 35,
    },
  ];

  const existingCues = [
    {
      id: 'a',
      videoId: 'video',
      text: "We did it. We didn't crash. That's not something you say out loud,",
      translatedText: '我们做到了。我们没有坠机。这不是你该大声说出来的话，',
      overrideText: null,
      overrideTranslatedText: null,
      offset: 930639,
      duration: 8000,
      sortOrder: 0,
      sourceStartSortOrder: 284,
      sourceEndSortOrder: 285,
      layoutVersion: 34,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'b',
      videoId: 'video',
      text: 'Peter.',
      translatedText: '彼得。',
      overrideText: null,
      overrideTranslatedText: null,
      offset: 937360,
      duration: 5960,
      sortOrder: 1,
      sourceStartSortOrder: 286,
      sourceEndSortOrder: 286,
      layoutVersion: 34,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as any;

  const subtitles = [
    {
      sortOrder: 284,
      text: "We did it. We didn't crash.",
      translatedText: null,
      offset: 930639,
      duration: 6721,
    },
    {
      sortOrder: 285,
      text: "That's not something you say out loud,",
      translatedText: null,
      offset: 934880,
      duration: 3759,
    },
    {
      sortOrder: 286,
      text: 'Peter.',
      translatedText: '彼得。',
      offset: 937360,
      duration: 5960,
    },
  ];

  const carried = carryOverTranslationsFromExistingCues(generatedCues as any, existingCues, subtitles);

  assert.equal(
    carried[0]?.translatedText,
    '我们做到了。我们没有坠机。这不是你该大声说出来的话， 彼得。',
  );
});

test('merges lowercase continuation chunks like airport chaos and there are still', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 328,
      text: 'From the morning rush to the airport',
      translatedText: '从早上的机场匆忙',
      offset: 1071280,
      duration: 7920,
    },
    {
      sortOrder: 329,
      text: 'chaos, somehow we made it here. What',
      translatedText: undefined,
      offset: 1074480,
      duration: 9680,
    },
    {
      sortOrder: 330,
      text: "happens next? Well, let&#39;s just say there",
      translatedText: '好吧，我们只能说那里',
      offset: 1079200,
      duration: 9120,
    },
    {
      sortOrder: 331,
      text: 'are still a few surprises waiting for us',
      translatedText: undefined,
      offset: 1084160,
      duration: 8800,
    },
    {
      sortOrder: 332,
      text: 'in Costa Rica.',
      translatedText: undefined,
      offset: 1088320,
      duration: 4000,
    },
  ]);

  assert.equal(cues[0]?.text, 'From the morning rush to the airport chaos, somehow we made it here.');
  assert.equal(cues[1]?.text, 'What happens next?');
  assert.equal(cues[2]?.text, "Well, let&#39;s just say there are still a few surprises waiting for us in Costa Rica.");
  assert.equal(cues.length, 3);
});

test('keeps a completed sentence separate while still merging the unfinished tail that follows', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 3,
      text: 'Thank you for watching this video.',
      translatedText: undefined,
      offset: 10240,
      duration: 4600,
    },
    {
      sortOrder: 4,
      text: 'On this channel, you can learn English',
      translatedText: undefined,
      offset: 14880,
      duration: 5360,
    },
    {
      sortOrder: 5,
      text: 'through simple stories and',
      translatedText: undefined,
      offset: 18000,
      duration: 4320,
    },
    {
      sortOrder: 6,
      text: 'conversations.',
      translatedText: '对话学习英语。',
      offset: 20240,
      duration: 4240,
    },
  ]);

  assert.equal(cues[0]?.text, 'Thank you for watching this video.');
  assert.equal(cues[1]?.text, 'On this channel, you can learn English through simple stories and conversations.');
  assert.equal(cues.length, 2);
});

test('ignores music markers while preserving the natural tail connection', () => {
  const cues = buildSubtitleCues([
    {
      sortOrder: 0,
      text: 'Before I go, please remember to',
      translatedText: undefined,
      offset: 663519,
      duration: 3841,
    },
    {
      sortOrder: 1,
      text: 'subscribe [music]',
      translatedText: undefined,
      offset: 666720,
      duration: 4000,
    },
    {
      sortOrder: 2,
      text: 'to this channel, like this video, and',
      translatedText: undefined,
      offset: 667360,
      duration: 7360,
    },
    {
      sortOrder: 3,
      text: 'share it with your friends and family.',
      translatedText: undefined,
      offset: 670720,
      duration: 6880,
    },
  ]);

  assert.equal(
    cues[0]?.text,
    'Before I go, please remember to subscribe [music] to this channel, like this video, and share it with your friends and family.',
  );
  assert.equal(cues.length, 1);
});
