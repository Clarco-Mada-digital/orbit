import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PROVIDERS,
  getAiProvider,
  normalizeAiProviderText,
  validateAiMessages,
  validateAiProviderUrl,
} from '../src/lib/aiProviders.js';

test('provider catalog covers local runtimes, major APIs and generic OpenAI-compatible servers', () => {
  const ids = AI_PROVIDERS.map(({ id }) => id);
  for (const id of [
    'local', 'ollama', 'lmstudio', 'openrouter', 'groq', 'gemini', 'xai',
    'openai', 'anthropic', 'mistral', 'deepseek', 'cerebras', 'together',
    'fireworks', 'huggingface', 'custom',
  ]) {
    assert.ok(ids.includes(id), `missing provider ${id}`);
  }
});

test('provider URL validation permits local HTTP only on loopback', () => {
  assert.equal(validateAiProviderUrl('ollama', 'http://localhost:11434/v1').success, true);
  assert.equal(validateAiProviderUrl('lmstudio', 'http://192.168.1.20:1234/v1').success, false);
  assert.equal(validateAiProviderUrl('custom', 'http://example.com/v1').success, false);
  assert.equal(validateAiProviderUrl('custom', 'https://llm.example/v1').success, true);
  assert.equal(validateAiProviderUrl('custom', 'https://user:pass@llm.example/v1').success, false);
  assert.equal(validateAiProviderUrl('groq', 'https://attacker.example/v1').success, false);
});

test('provider messages allow only bounded text chat roles', () => {
  assert.equal(validateAiMessages([
    { role: 'system', content: 'You are Orbit.' },
    { role: 'user', content: 'Bonjour.' },
  ]), true);
  assert.equal(validateAiMessages([{ role: 'tool', content: 'run this' }]), false);
  assert.equal(validateAiMessages([{ role: 'user', content: 'x'.repeat(30_001) }]), false);
  assert.equal(validateAiMessages('not a message array'), false);
});

test('normalizes OpenAI-compatible and Anthropic text responses', () => {
  assert.equal(normalizeAiProviderText({
    choices: [{ message: { content: ' Réponse ' } }],
  }, 'openai'), 'Réponse');
  assert.equal(normalizeAiProviderText({
    choices: [{ message: { content: [{ type: 'text', text: 'Bonjour' }, { type: 'image' }] } }],
  }, 'openai'), 'Bonjour');
  assert.equal(normalizeAiProviderText({
    content: [{ type: 'text', text: 'Salut' }],
  }, 'anthropic'), 'Salut');
  assert.equal(normalizeAiProviderText({}, 'openai'), '');
});

test('unknown provider identifiers do not resolve to a network endpoint', () => {
  assert.equal(getAiProvider('../custom'), null);
});
