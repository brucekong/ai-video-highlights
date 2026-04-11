import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferKeywordGlossaryType,
  isValidKeywordGlossaryEnglish,
  normalizeKeywordGlossaryEnglish,
} from './ai.js';

test('normalizes selected glossary text by trimming quotes and spacing', () => {
  assert.equal(
    normalizeKeywordGlossaryEnglish('  “water   bottle,”  '),
    'water bottle',
  );
});

test('accepts short english words and phrases as glossary candidates', () => {
  assert.equal(isValidKeywordGlossaryEnglish('habits'), true);
  assert.equal(isValidKeywordGlossaryEnglish('look up to'), true);
});

test('rejects chinese text and full-sentence-like selections', () => {
  assert.equal(isValidKeywordGlossaryEnglish('中文词条'), false);
  assert.equal(
    isValidKeywordGlossaryEnglish('I am running late for school because the road is blocked'),
    false,
  );
});

test('infers glossary type from word count', () => {
  assert.equal(inferKeywordGlossaryType('confidence'), 'word');
  assert.equal(inferKeywordGlossaryType('take a chance'), 'phrase');
});
