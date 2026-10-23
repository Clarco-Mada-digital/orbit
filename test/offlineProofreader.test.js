import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, applyIssues } from '../src/lib/offlineProofreader.js';

test('analyzeText detects targeted French spelling and typography issues', () => {
  const text = 'Sa va  bien? J’ai était parmis vous.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      ['Sa va', 'Ça va'],
      ['  ', ' '],
      ['?', '\u00a0?'],
      ['J’ai était', 'J’ai été'],
      ['parmis', 'parmi'],
    ]
  );
});

test('analyzeText catches common French subject-verb conjugation errors', () => {
  const text = 'Tu parle, il parles, ils parle, nous somme, vous est, elles a raison.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      ['Tu parle', 'Tu parles'],
      ['il parles', 'il parle'],
      ['ils parle', 'ils parlent'],
      ['nous somme', 'nous sommes'],
      ['vous est', 'vous êtes'],
      ['elles a', 'elles ont'],
    ]
  );
});

test('analyzeText catches infinitives used instead of common French past participles', () => {
  const text = 'J’ai manger, nous avons prendre, elle a faire et tu as choisir.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      ['ai manger', 'ai mangé'],
      ['avons prendre', 'avons pris'],
      ['a faire', 'a fait'],
      ['as choisir', 'as choisi'],
    ]
  );
});

test('analyzeText avoids guessing participle agreement with être or changing aller with avoir', () => {
  const text = 'Je suis aller, elles sont parler et ils ont aller.';
  assert.deepEqual(analyzeText(text, 'fr'), []);
});

test('analyzeText catches clear French homophone and auxiliary mistakes', () => {
  const text = 'Il à raison et ils on fini, elles son venues.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      ['Il à', 'Il a'],
      ['ils on', 'ils ont'],
      ['elles son', 'elles sont'],
    ]
  );
});

test('analyzeText leaves common correctly conjugated forms unchanged', () => {
  const text = 'Tu parles, il parle, ils parlent, nous sommes, vous êtes et elles ont raison.';
  assert.deepEqual(analyzeText(text, 'fr'), []);
});

test('analyzeText detects common English mistakes without network dependencies', () => {
  const issues = analyzeText('Your welcome, their is alot of work we could of done.', 'en');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      ['Your welcome', "You're welcome"],
      ['their is', 'there is'],
      ['alot', 'a lot'],
      ['could of', 'could have'],
    ]
  );
});

test('analyzeText reports repeated words and spacing once', () => {
  const issues = analyzeText('This is is  useful.', 'en');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [
      [' is', ''],
      ['  ', ' '],
    ]
  );
});

test('analyzeText recognizes repeated words containing accented letters', () => {
  const text = 'C’est déjà déjà mieux.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [[' déjà', '']]
  );
});

test('analyzeText combines repeated spaces before punctuation into one valid correction', () => {
  const text = 'Bonjour  , monde.';
  const issues = analyzeText(text, 'fr');

  assert.deepEqual(
    issues.map(({ original, replacement }) => [original, replacement]),
    [['  ,', ',']]
  );
  assert.equal(applyIssues(text, issues, new Set(issues.map((issue) => issue.id))), 'Bonjour, monde.');
});

test('applyIssues applies selected replacements from right to left', () => {
  const text = 'sa va  bien?';
  const issues = analyzeText(text, 'fr');
  const selected = new Set([issues[0].id, issues[2].id]);

  assert.equal(applyIssues(text, issues, selected), 'ça va  bien\u00a0?');
});

test('applyIssues rejects stale or malformed issue offsets', () => {
  assert.throws(
    () => applyIssues('changed text', [{ id: 'stale', start: 0, end: 4, original: 'old', replacement: 'new' }], new Set(['stale'])),
    /does not match/
  );
});

test('analyzeText rejects unsupported languages instead of silently defaulting', () => {
  assert.throws(() => analyzeText('text', 'es'), /Unsupported proofreading language/);
});
