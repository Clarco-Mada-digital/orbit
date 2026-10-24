export const AI_PROVIDERS = [
  { id: 'local', label: 'Orbit local', kind: 'local', local: true },
  { id: 'ollama', label: 'Ollama', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', local: true },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', local: true },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true },
  { id: 'xai', label: 'xAI · Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1', keyRequired: true },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyRequired: true },
  { id: 'anthropic', label: 'Anthropic · Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyRequired: true },
  { id: 'mistral', label: 'Mistral AI', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyRequired: true },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', keyRequired: true },
  { id: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', keyRequired: true },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.ai/v1', keyRequired: true },
  { id: 'fireworks', label: 'Fireworks AI', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', keyRequired: true },
  { id: 'huggingface', label: 'Hugging Face Inference', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1', keyRequired: true },
  { id: 'custom', label: 'Serveur compatible OpenAI', kind: 'openai', keyRequired: false, custom: true },
];

export function getAiProvider(providerId) {
  return AI_PROVIDERS.find((provider) => provider.id === providerId) || null;
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function validateAiProviderUrl(providerId, value) {
  const provider = getAiProvider(providerId);
  if (!provider || provider.kind === 'local' || typeof value !== 'string' || value.length > 500) {
    return { success: false, error: 'invalid-provider-url' };
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { success: false, error: 'invalid-provider-url' };
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) ||
    (provider.local && !isLoopback(parsed.hostname)) ||
    (!provider.local && provider.id !== 'custom' && parsed.origin !== new URL(provider.baseUrl).origin)
  ) {
    return { success: false, error: 'invalid-provider-url' };
  }
  const baseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return { success: true, baseUrl };
}

export function validateAiMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) return false;
  let totalLength = 0;
  for (const message of messages) {
    if (
      !message ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length > 30_000
    ) {
      return false;
    }
    totalLength += message.content.length;
  }
  return totalLength <= 100_000;
}

export function normalizeAiProviderText(data, kind) {
  const content = kind === 'anthropic'
    ? data?.content?.filter((part) => part?.type === 'text').map((part) => part.text).join('')
    : data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
  }
  return '';
}
