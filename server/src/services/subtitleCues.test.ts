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
