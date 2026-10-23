import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiProviderClient } from '../electron/ai-provider-client.js';
import { getAiProvider } from '../src/lib/aiProviders.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('OpenAI key test loads models from the configured OpenAI API endpoint', async () => {
  let request;
  const client = createAiProviderClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ data: [{ id: 'gpt-test' }] });
  });

  const models = await client.listModels(getAiProvider('openai'), 'https://api.openai.com/v1', 'test-key');
  assert.deepEqual(models, [{ id: 'gpt-test', label: 'gpt-test' }]);
  assert.equal(request.url, 'https://api.openai.com/v1/models');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
});

test('OpenAI-compatible model test sends a real chat completion request', async () => {
  let request;
  const client = createAiProviderClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
  });

  const text = await client.complete(
    getAiProvider('custom'),
    'https://llm.example/v1',
    'test-key',
    { model: 'custom-model', messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 16 }
  );
  assert.equal(text, 'OK');
  assert.equal(request.url, 'https://llm.example/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'custom-model',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    max_tokens: 16,
    temperature: 0.2,
    stream: false,
  });
});

test('Gemini uses its native key header for model discovery and hides non-generation models', async () => {
  let request;
  const client = createAiProviderClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({
      models: [
        { name: 'models/gemini-test', displayName: 'Gemini test', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-test', supportedGenerationMethods: ['embedContent'] },
      ],
    });
  });

  const models = await client.listModels(
    getAiProvider('gemini'),
    getAiProvider('gemini').baseUrl,
    'test-key'
  );
  assert.deepEqual(models, [{ id: 'gemini-test', label: 'Gemini test' }]);
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('compatible endpoints accept either OpenAI data or generic models response lists', async () => {
  const responses = [
    { models: [{ name: 'local-model' }] },
  ];
  const client = createAiProviderClient(async () => jsonResponse(responses.shift()));
  const models = await client.listModels(
    getAiProvider('custom'),
    'https://llm.example/v1/',
    ''
  );
  assert.deepEqual(models, [{ id: 'local-model', label: 'local-model' }]);
});

test('provider HTTP and malformed JSON errors remain explicit', async () => {
  const unauthorized = createAiProviderClient(async () => jsonResponse({}, 401));
  await assert.rejects(
    unauthorized.listModels(getAiProvider('openai'), 'https://api.openai.com/v1', 'invalid'),
    /provider-http-401/
  );

  const malformed = createAiProviderClient(async () => new Response('not json'));
  await assert.rejects(
    malformed.listModels(getAiProvider('openai'), 'https://api.openai.com/v1', 'test-key'),
    /provider-invalid-response/
  );
});
