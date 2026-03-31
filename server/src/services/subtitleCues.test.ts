import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSubtitleCues } from './subtitleCues.js';

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

  assert.equal(
    cues[0]?.text,
    "Dad, I wish you would look at me sometimes. Sometimes I feel like I'm growing up alone.",
  );
  assert.equal(cues[0]?.translatedText, '独自长大。');
  assert.equal(cues.length, 1);
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
