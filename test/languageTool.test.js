import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLanguageToolMatches, mergeProofreadingIssues } from '../src/lib/languageTool.js';

test('maps LanguageTool offsets and first replacement to Orbit proofreading issues', () => {
  const text = 'Ceci est un test.';
  const issues = mapLanguageToolMatches(text, [{
    offset: 9,
    length: 2,
    message: 'Possible agreement error.',
    rule: { id: 'AGREEMENT' },
    replacements: [{ value: 'une' }, { value: 'le' }],
  }], 'fr');

  assert.deepEqual(issues, [{
    id: 'languagetool:AGREEMENT:9',
    ruleId: 'AGREEMENT',
    source: 'languagetool',
    start: 9,
    end: 11,
    original: 'un',
    replacement: 'une',
    message: 'Possible agreement error.',
    language: 'fr',
  }]);
});

test('ignores invalid ranges, empty replacements and unchanged suggestions', () => {
  const matches = [
    { offset: -1, length: 1, replacements: [{ value: 'x' }] },
    { offset: 0, length: 0, replacements: [{ value: 'x' }] },
    { offset: 0, length: 20, replacements: [{ value: 'x' }] },
    { offset: 0, length: 1, replacements: [] },
    { offset: 0, length: 1, replacements: [{ value: 'a' }] },
  ];
  assert.deepEqual(mapLanguageToolMatches('abc', matches, 'en'), []);
});

test('prefers LanguageTool suggestions over overlapping local fallback rules', () => {
  const local = [
    { id: 'local-1', start: 0, end: 3 },
    { id: 'local-2', start: 5, end: 7 },
  ];
  const enhanced = [{ id: 'lt-1', start: 1, end: 4 }];

  assert.deepEqual(mergeProofreadingIssues(local, enhanced), [enhanced[0], local[1]]);
});

test('deduplicates overlapping issues while preserving source order', () => {
  const local = [{ id: 'local', start: 0, end: 2 }];
  const enhanced = [
    { id: 'lt-1', start: 1, end: 3 },
    { id: 'lt-2', start: 2, end: 4 },
  ];
  assert.deepEqual(mergeProofreadingIssues(local, enhanced), [enhanced[0]]);
});
