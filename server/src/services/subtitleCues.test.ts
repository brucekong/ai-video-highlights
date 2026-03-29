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
