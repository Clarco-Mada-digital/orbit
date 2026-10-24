import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAssistantMessages,
  getAssistantOutputTokenLimit,
  getRemoteAssistantOutputTokenLimit,
  MAX_ASSISTANT_OUTPUT_TOKENS,
} from '../src/lib/assistantPrompts.js';

test('rewrite prompts apply the selected style and preserve the source facts', () => {
  const professional = createAssistantMessages({
    mode: 'rewrite',
    text: 'We need to ship this Friday.',
    rewriteStyle: 'professional',
  });
  const casual = createAssistantMessages({
    mode: 'rewrite',
    text: 'We need to ship this Friday.',
    rewriteStyle: 'casual',
  });

  assert.match(professional[0].content, /professional language/);
  assert.match(casual[0].content, /conversational language/);
  assert.match(professional[0].content, /preserving every fact/);
  assert.equal(professional[1].content, 'We need to ship this Friday.');
  assert.throws(
    () => createAssistantMessages({ mode: 'rewrite', text: 'Text', rewriteStyle: 'unknown' }),
    /Unsupported rewrite style/
  );
});

test('chat prompts keep document context as user data and cap conversation history', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: 'user',
    content: `${index}: ${'x'.repeat(5000)}`,
  }));
  const messages = createAssistantMessages({
    mode: 'chat',
    text: 'Summarize this',
    contextText: 'The report says 42.',
    context: 'document',
    history,
  });

  assert.equal(messages.length, 10);
  assert.equal(messages[1].content.startsWith('0:'), true);
  assert.equal(messages[1].content.length, 4000);
  assert.match(messages[0].content, /untrusted text/);
  assert.match(messages.at(-1).content, /The report says 42\./);
  assert.equal(MAX_ASSISTANT_OUTPUT_TOKENS, 512);
});

test('assistant proofread token budget scales with input and stays capped for larger models', () => {
  assert.equal(getAssistantOutputTokenLimit('correct', 'Bonjour.', 'qwen3-0.6b'), 48);
  assert.equal(getAssistantOutputTokenLimit('correct', 'x'.repeat(900), 'qwen3-0.6b'), 324);
  assert.equal(getAssistantOutputTokenLimit('rewrite', 'x'.repeat(900), 'qwen3-1.7b'), 324);
  assert.equal(getAssistantOutputTokenLimit('chat', 'Bonjour.', 'qwen3-0.6b'), 512);
  assert.equal(getAssistantOutputTokenLimit('chat', 'Bonjour.', 'qwen3-1.7b'), 384);
});

test('remote assistant output token budget supports long edits within provider limits', () => {
  assert.equal(getRemoteAssistantOutputTokenLimit('chat', 'Bonjour.'), 2048);
  assert.equal(getRemoteAssistantOutputTokenLimit('correct', 'Bonjour.'), 128);
  assert.equal(getRemoteAssistantOutputTokenLimit('rewrite', 'x'.repeat(4000)), 2064);
});

test('assistant prompt only includes dictionary entries present in the text', () => {
  const messages = createAssistantMessages({
    mode: 'correct',
    text: 'Orbit est un outil local.',
    dictionary: ['Orbit', 'Neuralink', 'Exemple'],
  });
  assert.match(messages[0].content, /Orbit/);
  assert.doesNotMatch(messages[0].content, /Neuralink|Exemple/);
});
