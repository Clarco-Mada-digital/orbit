import {
  normalizeAiProviderText,
  validateAiMessages,
} from '../src/lib/aiProviders.js';

const MAX_RESPONSE_BYTES = 8_000_000;
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_TOKENS = 4096;

function requestHeaders(provider, apiKey, { geminiNative = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.kind === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
  } else if (apiKey) {
    if (provider.id === 'gemini' && geminiNative) {
      headers['x-goog-api-key'] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://orbit.app';
    headers['X-OpenRouter-Title'] = 'Orbit';
  }
  return headers;
}

function modelUrl(provider, baseUrl) {
  if (provider.id === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/models';
  if (provider.id === 'ollama') return `${baseUrl.replace(/\/v1\/?$/, '')}/api/tags`;
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

function parseModels(data, provider) {
  const entries = provider.id === 'gemini'
    ? data.models
      ?.filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => ({
        id: String(model.name || '').replace(/^models\//, ''),
        label: model.displayName || model.name,
      }))
    : provider.id === 'ollama'
      ? data.models?.map((model) => ({ id: model.name, label: model.name }))
      : (data.data || data.models)?.map((model) => ({
        id: model.id || model.name,
        label: model.name || model.id,
      }));
  if (!Array.isArray(entries)) throw new Error('provider-invalid-model-list');
  return entries
    .filter((model) => typeof model.id === 'string' && model.id.length > 0 && model.id.length <= 200)
    .slice(0, 500);
}

export function createAiProviderClient(fetch) {
  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(error?.name === 'TimeoutError' ? 'provider-timeout' : 'provider-unreachable');
    }
    if (!response.ok) throw new Error(`provider-http-${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) return {};
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('provider-response-too-large');
      }
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('provider-invalid-response');
    }
  }

  async function listModels(provider, baseUrl, apiKey) {
    const headers = requestHeaders(provider, apiKey, { geminiNative: provider.id === 'gemini' });
    const data = await requestJson(modelUrl(provider, baseUrl), { headers });
    return parseModels(data, provider);
  }

  async function complete(provider, baseUrl, apiKey, { model, messages, maxTokens = 128 } = {}) {
    if (
      typeof model !== 'string' ||
      !model.trim() ||
      model.length > 200 ||
      [...model].some((character) => character.codePointAt(0) < 0x20 || character.codePointAt(0) === 0x7f) ||
      !validateAiMessages(messages) ||
      !Number.isInteger(maxTokens) ||
      maxTokens < 16 ||
      maxTokens > MAX_OUTPUT_TOKENS
    ) {
      throw new Error('invalid-request');
    }
    const endpoint = provider.kind === 'anthropic'
      ? `${baseUrl.replace(/\/+$/, '')}/messages`
      : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let body;
    if (provider.kind === 'anthropic') {
      const system = messages.filter((message) => message.role === 'system')
        .map((message) => message.content).join('\n\n');
      body = {
        model: model.trim(),
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: messages
          .filter((message) => message.role !== 'system')
          .map(({ role, content }) => ({ role, content })),
      };
    } else {
      body = {
        model: model.trim(),
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false,
      };
    }

    const data = await requestJson(endpoint, {
      method: 'POST',
      headers: requestHeaders(provider, apiKey),
      body: JSON.stringify(body),
    });
    const text = normalizeAiProviderText(data, provider.kind);
    if (!text) throw new Error('provider-empty-response');
    return text;
  }

  return { listModels, complete };
}
