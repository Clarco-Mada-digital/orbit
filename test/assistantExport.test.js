import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantSessionMarkdown,
  assistantSessionsMarkdown,
} from '../src/lib/assistantExport.js';

test('conversation export preserves roles, commands, and message text', () => {
  const markdown = assistantSessionMarkdown({
    title: 'Plan de travail',
    messages: [
      { role: 'user', content: 'Bonjour', command: 'email' },
      { role: 'assistant', content: 'Voici un brouillon.' },
    ],
  });
  assert.match(markdown, /^# Plan de travail/);
  assert.match(markdown, /Vous \(\/email\)/);
  assert.match(markdown, /Assistant\n\nVoici un brouillon\./);
});

test('bulk export separates conversations with a Markdown divider', () => {
  const markdown = assistantSessionsMarkdown([
    { title: 'A', messages: [{ role: 'user', content: 'Question A' }] },
    { title: 'B', messages: [{ role: 'user', content: 'Question B' }] },
  ]);
  assert.match(markdown, /# A[\s\S]*---[\s\S]*# B/);
});
