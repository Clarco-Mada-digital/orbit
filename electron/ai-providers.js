import { app, net, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAiProvider,
  validateAiProviderUrl,
} from '../src/lib/aiProviders.js';
import { createAiProviderClient } from './ai-provider-client.js';

const MAX_KEY_LENGTH = 2000;
let configPath;
let providerConfig;
const providerClient = createAiProviderClient((url, options) => net.fetch(url, options));

function credentialPath() {
  if (!configPath) configPath = path.join(app.getPath('userData'), 'ai-providers.enc');
  return configPath;
}

function loadConfig() {
  if (providerConfig) return providerConfig;
  const file = credentialPath();
  try {
    const encrypted = fs.readFileSync(file);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is unavailable');
    }
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    if (!parsed || parsed.version !== 1 || typeof parsed.providers !== 'object') {
      throw new Error('Invalid AI provider credential file');
    }
    providerConfig = parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      providerConfig = { version: 1, providers: {} };
    } else {
      throw error;
    }
  }
  return providerConfig;
}

function saveConfig(next) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'secure-storage-unavailable' };
  }
  const file = credentialPath();
  const temporary = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
    fs.renameSync(temporary, file);
    providerConfig = next;
    return { success: true };
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error('[orbit] nettoyage des identifiants IA temporaires échoué:', cleanupError);
      }
    }
    console.error('[orbit] sauvegarde chiffrée des fournisseurs IA échouée:', error);
    return { success: false, error: 'credential-save-failed' };
  }
}

function providerSettings(providerId, draft = {}) {
  const provider = getAiProvider(providerId);
  if (!provider || provider.kind === 'local') return null;
  const stored = loadConfig().providers[providerId] || {};
  const baseUrl = draft.baseUrl?.trim() || stored.baseUrl || provider.baseUrl || '';
  const validation = validateAiProviderUrl(providerId, baseUrl);
  if (!validation.success) throw new Error('Stored AI provider endpoint is invalid');
  const apiKey = typeof draft.apiKey === 'string' && draft.apiKey.trim()
    ? draft.apiKey.trim()
    : stored.apiKey || '';
  return { provider, baseUrl: validation.baseUrl, apiKey };
}

export function getAiProvidersState() {
  const config = loadConfig();
  const secureStorageAvailable = safeStorage.isEncryptionAvailable();
  return {
    success: true,
    secureStorageAvailable,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, record]) => [
        id,
        {
          configured: Boolean(record.apiKey || !getAiProvider(id)?.keyRequired),
          hasApiKey: Boolean(record.apiKey),
          baseUrl: record.baseUrl || getAiProvider(id)?.baseUrl || '',
        },
      ])
    ),
  };
}

export function configureAiProvider(providerId, { apiKey = '', baseUrl = '' } = {}) {
  const provider = getAiProvider(providerId);
  if (!provider || provider.kind === 'local') return { success: false, error: 'unknown-provider' };
  if (typeof apiKey !== 'string' || apiKey.length > MAX_KEY_LENGTH) {
    return { success: false, error: 'invalid-api-key' };
  }
  const prior = loadConfig();
  const current = prior.providers[providerId] || {};
  const resolvedUrl = provider.custom || provider.local
    ? baseUrl || current.baseUrl || ''
    : provider.baseUrl;
  const endpoint = validateAiProviderUrl(providerId, resolvedUrl);
  if (!endpoint.success) return { success: false, error: endpoint.error };

  const nextKey = apiKey.trim() || current.apiKey || '';
  if (provider.keyRequired && !nextKey) return { success: false, error: 'api-key-required' };
  if (nextKey && !safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'secure-storage-unavailable' };
  }
  const next = {
    ...prior,
    providers: {
      ...prior.providers,
      [providerId]: { apiKey: nextKey, baseUrl: endpoint.baseUrl },
    },
  };
  return saveConfig(next);
}

export function clearAiProviderKey(providerId) {
  const provider = getAiProvider(providerId);
  if (!provider || provider.kind === 'local') return { success: false, error: 'unknown-provider' };
  const prior = loadConfig();
  const current = prior.providers[providerId] || {};
  if (!current.apiKey) return { success: true };
  const next = {
    ...prior,
    providers: {
      ...prior.providers,
      [providerId]: { ...current, apiKey: '' },
    },
  };
  return saveConfig(next);
}

export async function listAiProviderModels(providerId, draft) {
  let configured;
  try {
    configured = providerSettings(providerId, draft);
  } catch (error) {
    console.error('[orbit] configuration de fournisseur IA invalide:', error);
    return { success: false, error: 'invalid-provider-config' };
  }
  if (!configured) return { success: false, error: 'unknown-provider' };
  const { provider, baseUrl, apiKey } = configured;
  if (provider.keyRequired && !apiKey) return { success: false, error: 'api-key-required' };
  try {
    return { success: true, models: await providerClient.listModels(provider, baseUrl, apiKey) };
  } catch (error) {
    console.error(`[orbit] liste des modèles ${providerId} indisponible:`, error);
    return { success: false, error: String(error.message || 'provider-unreachable') };
  }
}

export async function testAiProviderKey(providerId, draft) {
  let configured;
  try {
    configured = providerSettings(providerId, draft);
  } catch (error) {
    console.error('[orbit] configuration de fournisseur IA invalide:', error);
    return { success: false, error: 'invalid-provider-config' };
  }
  if (!configured) return { success: false, error: 'unknown-provider' };
  const { provider, baseUrl, apiKey } = configured;
  if (provider.keyRequired && !apiKey) return { success: false, error: 'api-key-required' };
  try {
    const models = await providerClient.listModels(provider, baseUrl, apiKey);
    return { success: true, modelCount: models.length };
  } catch (error) {
    console.error(`[orbit] test de clé fournisseur ${providerId} échoué:`, error);
    return { success: false, error: String(error.message || 'provider-unreachable') };
  }
}

export async function testAiProviderModel(providerId, model, draft) {
  let configured;
  try {
    configured = providerSettings(providerId, draft);
  } catch (error) {
    console.error('[orbit] configuration de fournisseur IA invalide:', error);
    return { success: false, error: 'invalid-provider-config' };
  }
  if (!configured) return { success: false, error: 'unknown-provider' };
  const { provider, baseUrl, apiKey } = configured;
  if (provider.keyRequired && !apiKey) return { success: false, error: 'api-key-required' };
  try {
    const text = await providerClient.complete(provider, baseUrl, apiKey, {
      model,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      maxTokens: 16,
    });
    return { success: true, text };
  } catch (error) {
    console.error(`[orbit] test du modèle ${providerId}/${model} échoué:`, error);
    return { success: false, error: String(error.message || 'provider-unreachable') };
  }
}

export async function completeWithAiProvider({
  providerId,
  model,
  messages,
  maxTokens = 128,
} = {}) {
  let configured;
  try {
    configured = providerSettings(providerId);
  } catch (error) {
    console.error('[orbit] configuration de fournisseur IA invalide:', error);
    return { success: false, error: 'invalid-provider-config' };
  }
  if (!configured) return { success: false, error: 'unknown-provider' };
  const { provider, baseUrl, apiKey } = configured;
  if (provider.keyRequired && !apiKey) return { success: false, error: 'api-key-required' };
  try {
    const text = await providerClient.complete(provider, baseUrl, apiKey, { model, messages, maxTokens });
    return { success: true, text };
  } catch (error) {
    console.error(`[orbit] génération via ${providerId} échouée:`, error.message || error);
    return { success: false, error: error.message === 'invalid-request'
      ? 'invalid-request'
      : String(error.message || 'provider-unreachable') };
  }
}
