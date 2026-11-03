import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectTextLanguage } from '../src/lib/detectTextLanguage.js';

test('text language detection follows the text instead of the interface locale', () => {
  assert.equal(detectTextLanguage('Bonjour, je voudrais corriger ce texte.', 'en'), 'fr');
  assert.equal(detectTextLanguage('Please check this sentence for spelling.', 'fr'), 'en');
  assert.equal(detectTextLanguage('I am here and need help.', 'fr'), 'en');
});

test('text language detection uses the configured language when evidence is weak', () => {
  assert.equal(detectTextLanguage('OK, merci.', 'en'), 'en');
  assert.equal(detectTextLanguage('', 'fr'), 'fr');
});
