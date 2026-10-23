import { useCallback, useEffect, useState } from 'react';
import { Bot, Cpu, Download, HardDrive, KeyRound, Keyboard, MessageSquareText, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { resolveLang, translate, useT } from '../lib/i18n';
import { assessAssistantModel, getBestAssistantModel } from '../lib/assistantRecommendations';
import { AI_PROVIDERS, getAiProvider } from '../lib/aiProviders';
import { normalizeAssistantChatShortcutKey } from '../lib/shortcuts';

const MODEL_ORDER = ['smollm2-360m', 'qwen3-0.6b', 'qwen3-1.7b'];
const MODEL_LABELS = {
  'smollm2-360m': 'assistant.model.smollm',
  'qwen3-0.6b': 'assistant.model.small',
  'qwen3-1.7b': 'assistant.model.large',
};
const GB = 1024 ** 3;
const bytes = (count) => `${(count / (1024 ** 3)).toFixed(count >= 1024 ** 3 ? 1 : 2)} Go`;

const api = () => window.electronAPI?.assistant;
const providerApi = () => window.electronAPI?.aiProviders;

async function supportsWebGPU() {
  if (!navigator.gpu) return false;
  try {
    return Boolean(await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
  } catch (err) {
    console.error('[orbit] détection WebGPU impossible:', err);
    return false;
  }
}

export default function AssistantSettings() {
  const t = useT();
  const { settings, updateSettings } = useStore();
  const language = resolveLang(settings.language);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [newWord, setNewWord] = useState('');
  const [webGPUAvailable, setWebGPUAvailable] = useState(null);
  const [providerId, setProviderId] = useState(settings.assistantProvider || 'local');
  const [providerState, setProviderState] = useState(null);
  const [providerDrafts, setProviderDrafts] = useState({});
  const [providerModels, setProviderModels] = useState([]);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [providerMessage, setProviderMessage] = useState('');
  const [providerTestReply, setProviderTestReply] = useState('');
  const selectedModel = settings.assistantModel || 'qwen3-0.6b';
  const dictionary = Array.isArray(settings.assistantDictionary) ? settings.assistantDictionary : [];
  const selectedProvider = getAiProvider(providerId);
  const savedProvider = providerState?.providers?.[providerId];
  const providerDraft = providerDrafts[providerId] || {
    apiKey: '',
    baseUrl: savedProvider?.baseUrl || selectedProvider?.baseUrl || '',
  };
  const providerModelId = typeof settings.assistantProviderModels?.[providerId] === 'string'
    ? settings.assistantProviderModels[providerId]
    : '';
  const cloudConsent = settings.assistantCloudConsent?.[providerId] === true;

  const refresh = useCallback(async () => {
    try {
      const result = await api()?.state();
      if (result?.success) setState(result);
      else setError(translate(language, 'assistant.settings.error'));
    } catch (err) {
      console.error('[orbit] état des modèles assistant indisponible:', err);
      setError(translate(language, 'assistant.settings.error'));
    }
    try {
      const providerResult = await providerApi()?.state();
      if (providerResult?.success) setProviderState(providerResult);
      else setProviderError(translate(language, 'assistant.providers.error'));
    } catch (err) {
      console.error('[orbit] état des fournisseurs IA indisponible:', err);
      setProviderError(translate(language, 'assistant.providers.error'));
    }
  }, [language]);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => api()?.state())
      .then((result) => {
        if (!active) return;
        if (result?.success) setState(result);
        else setError(translate(language, 'assistant.settings.error'));
        return supportsWebGPU();
      })
      .then((available) => {
        if (active && typeof available === 'boolean') setWebGPUAvailable(available);
      })
      .catch((err) => {
        if (!active) return;
        console.error('[orbit] état des modèles assistant indisponible:', err);
        setError(translate(language, 'assistant.settings.error'));
      });
    Promise.resolve(providerApi()?.state())
      .then((result) => {
        if (active && result?.success) setProviderState(result);
        else if (active) setProviderError(translate(language, 'assistant.providers.error'));
      })
      .catch((err) => {
        if (!active) return;
        console.error('[orbit] état des fournisseurs IA indisponible:', err);
        setProviderError(translate(language, 'assistant.providers.error'));
      });
    const off = api()?.onProgress?.(setProgress);
    return () => {
      active = false;
      if (typeof off === 'function') off();
    };
  }, [language]);

  const withBusy = async (modelKey, operation) => {
    setBusy(modelKey);
    setError('');
    try {
      const result = await operation();
      if (result?.success === false) setError(result.error || t('assistant.settings.error'));
      await refresh();
    } catch (err) {
      console.error('[orbit] gestion du modèle assistant échouée:', err);
      setError(String(err.message || err));
    } finally {
      setBusy('');
      setProgress(null);
    }
  };
  const testProviderKey = async () => {
    setProviderBusy(true);
    setProviderError('');
    setProviderMessage('');
    setProviderTestReply('');
    try {
      const result = await providerApi()?.testKey(providerId, providerDraft);
      if (!result?.success) {
        setProviderError(result?.error || 'unknown');
        return;
      }
      setProviderMessage('key-tested');
    } catch (err) {
      console.error('[orbit] test de clé du fournisseur IA échoué:', err);
      setProviderError('unknown');
    } finally {
      setProviderBusy(false);
    }
  };
  const testProviderModel = async () => {
    if (!providerModelId.trim()) {
      setProviderError('model-required');
      return;
    }
    if (!selectedProvider?.local && !cloudConsent) {
      setProviderError('consent-required');
      return;
    }
    setProviderBusy(true);
    setProviderError('');
    setProviderMessage('');
    setProviderTestReply('');
    try {
      const result = await providerApi()?.testModel(providerId, providerModelId, providerDraft);
      if (!result?.success) {
        setProviderError(result?.error || 'unknown');
        return;
      }
      setProviderMessage('model-tested');
      setProviderTestReply(typeof result.text === 'string' ? result.text.slice(0, 160) : '');
    } catch (err) {
      console.error('[orbit] test du modèle fournisseur IA échoué:', err);
      setProviderError('unknown');
    } finally {
      setProviderBusy(false);
    }
  };

  const addWord = (event) => {
    event.preventDefault();
    const word = newWord.trim().slice(0, 80);
    if (!word || dictionary.some((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase())) {
      return;
    }
    updateSettings({ assistantDictionary: [...dictionary, word].slice(0, 500) });
    setNewWord('');
  };

  const removeWord = (word) => {
    updateSettings({ assistantDictionary: dictionary.filter((item) => item !== word) });
  };

  const progressPercent = progress?.total
    ? Math.round((progress.received / progress.total) * 100)
    : null;
  const hardware = state?.hardware;
  const recommendation = getBestAssistantModel(state?.models || {}, hardware, webGPUAvailable);
  const refreshDeviceInfo = async () => {
    await refresh();
    setWebGPUAvailable(await supportsWebGPU());
  };
  const saveProvider = async () => {
    setProviderBusy(true);
    setProviderError('');
    setProviderMessage('');
    try {
      const result = await providerApi()?.configure(providerId, providerDraft);
      if (!result?.success) {
        setProviderError(result?.error || 'unknown');
        return;
      }
      const refreshed = await providerApi()?.state();
      if (!refreshed?.success) {
        setProviderError('unknown');
        return;
      }
      setProviderState(refreshed);
      setProviderDrafts((current) => ({
        ...current,
        [providerId]: { ...providerDraft, apiKey: '' },
      }));
      setProviderMessage('saved');
    } catch (err) {
      console.error('[orbit] configuration du fournisseur IA échouée:', err);
      setProviderError('unknown');
    } finally {
      setProviderBusy(false);
    }
  };
  const discoverProviderModels = async () => {
    setProviderBusy(true);
    setProviderError('');
    setProviderMessage('');
    try {
      const result = await providerApi()?.listModels(providerId, providerDraft);
      if (!result?.success) {
        setProviderError(result?.error || 'unknown');
        return;
      }
      setProviderModels(result.models || []);
      if (!result.models?.length) setProviderMessage('no-models');
      if (!providerModelId && result.models?.[0]?.id) {
        updateSettings({
          assistantProviderModels: {
            ...settings.assistantProviderModels,
            [providerId]: result.models[0].id,
          },
        });
      }
    } catch (err) {
      console.error('[orbit] découverte des modèles IA échouée:', err);
      setProviderError('unknown');
    } finally {
      setProviderBusy(false);
    }
  };
  const clearProviderKey = async () => {
    setProviderBusy(true);
    setProviderError('');
    setProviderMessage('');
    try {
      const result = await providerApi()?.clearKey(providerId);
      if (!result?.success) {
        setProviderError(result?.error || 'unknown');
        return;
      }
      const refreshed = await providerApi()?.state();
      if (refreshed?.success) setProviderState(refreshed);
      setProviderMessage('key-cleared');
    } catch (err) {
      console.error('[orbit] suppression de la clé du fournisseur IA échouée:', err);
      setProviderError('unknown');
    } finally {
      setProviderBusy(false);
    }
  };
  const activateProvider = () => {
    if (providerId === 'local') {
      updateSettings({ assistantProvider: 'local' });
      return;
    }
    if (!savedProvider?.configured) {
      setProviderError('not-configured');
      return;
    }
    if (!selectedProvider?.local && !cloudConsent) {
      setProviderError('consent-required');
      return;
    }
    if (!providerModelId.trim()) {
      setProviderError('model-required');
      return;
    }
    updateSettings({ assistantProvider: providerId });
  };
  const providerErrorText = (code) => {
    const httpStatus = /^provider-http-(\d{3})$/u.exec(code)?.[1];
    if (httpStatus === '401' || httpStatus === '403') return t('assistant.providers.error.auth');
    if (httpStatus === '429') return t('assistant.providers.error.rateLimit');
    if (httpStatus) return t('assistant.providers.error.http', { status: httpStatus });
    const errorKeys = {
      'api-key-required': 'assistant.providers.error.apiKey',
      'secure-storage-unavailable': 'assistant.providers.error.secureStorage',
      'credential-save-failed': 'assistant.providers.error.save',
      'invalid-provider-url': 'assistant.providers.error.url',
      'invalid-provider-config': 'assistant.providers.error.config',
      'provider-timeout': 'assistant.providers.error.timeout',
      'provider-unreachable': 'assistant.providers.error.connection',
      'provider-empty-response': 'assistant.providers.error.empty',
      'provider-invalid-model-list': 'assistant.providers.error.modelList',
      'provider-invalid-response': 'assistant.providers.error.invalidResponse',
      'provider-response-too-large': 'assistant.providers.error.invalidResponse',
      'invalid-api-key': 'assistant.providers.error.apiKey',
      'not-configured': 'assistant.providers.error.notConfigured',
      'consent-required': 'assistant.providers.error.consent',
      'model-required': 'assistant.providers.error.model',
      unknown: 'assistant.providers.error',
    };
    return t(errorKeys[code] || 'assistant.providers.error');
  };

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="mb-2 flex items-center gap-2">
          <Bot size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('assistant.settings.title')}</h4>
        </div>
        <p className="mb-3 text-sm text-text-muted">{t('assistant.settings.description')}</p>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
          <ShieldCheck size={14} />
          {settings.assistantProvider === 'local'
            ? t('assistant.local')
            : t('assistant.providers.active', {
              provider: getAiProvider(settings.assistantProvider)?.label || settings.assistantProvider,
            })}
        </div>
        <p className="mt-3 text-xs text-text-muted">{t('assistant.settings.downloadNote')}</p>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-accent-primary/25 bg-gradient-to-br from-accent-primary/10 via-bg-secondary to-violet-500/10 p-5 shadow-sm">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-accent-primary/10 blur-2xl" />
        <div className="relative">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl bg-accent-primary/15 p-2.5 text-accent-primary">
              <MessageSquareText size={20} />
            </div>
            <div>
              <h4 className="font-semibold">{t('assistant.chat.settingsTitle')}</h4>
              <p className="mt-1 text-sm text-text-muted">{t('assistant.chat.settingsDescription')}</p>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border/70 bg-bg-primary/40 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings.assistantChatEnabled !== false}
                onChange={(event) => {
                  updateSettings({ assistantChatEnabled: event.target.checked });
                  if (!event.target.checked) {
                    window.dispatchEvent(new Event('orbit:assistant-chat-close'));
                  }
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{t('assistant.chat.enable')}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{t('assistant.chat.enableHint')}</span>
              </span>
            </label>
            <div className={`flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between ${
              settings.assistantChatEnabled === false ? 'opacity-50' : ''
            }`}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={settings.assistantChatShortcutEnabled !== false}
                  onChange={(event) => updateSettings({ assistantChatShortcutEnabled: event.target.checked })}
                  disabled={settings.assistantChatEnabled === false}
                  className="mt-1"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Keyboard size={14} />
                    {t('assistant.chat.shortcutEnable')}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">{t('assistant.chat.shortcutHint')}</span>
                </span>
              </label>
              <select
                value={normalizeAssistantChatShortcutKey(settings.assistantChatShortcutKey) || 'a'}
                onChange={(event) => updateSettings({ assistantChatShortcutKey: event.target.value })}
                disabled={settings.assistantChatEnabled === false || settings.assistantChatShortcutEnabled === false}
                className="input w-full sm:w-auto"
                aria-label={t('assistant.chat.shortcutKey')}
              >
                {['a', 'j', 'u', 'y'].map((key) => (
                  <option key={key} value={key}>
                    {window.electronAPI?.platform === 'darwin' ? '⌘ + ⇧ +' : 'Alt + ⇧ +'} {key.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-3 text-xs text-text-muted">{t('assistant.chat.separationNote')}</p>
        </div>
      </section>

      <section className="card space-y-4" aria-labelledby="assistant-provider-title">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <KeyRound size={17} className="text-accent-primary" />
            <h4 id="assistant-provider-title" className="font-semibold">
              {t('assistant.providers.title')}
            </h4>
          </div>
          <p className="text-sm text-text-muted">{t('assistant.providers.description')}</p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>{t('assistant.providers.provider')}</span>
          <select
            value={providerId}
            onChange={(event) => {
              const nextProviderId = event.target.value;
              setProviderId(nextProviderId);
              setProviderDrafts({
                [nextProviderId]: {
                  apiKey: '',
                  baseUrl: providerState?.providers?.[nextProviderId]?.baseUrl
                    || getAiProvider(nextProviderId)?.baseUrl
                    || '',
                },
              });
              setProviderModels([]);
              setProviderError('');
              setProviderMessage('');
              setProviderTestReply('');
            }}
            className="input w-full"
            disabled={providerBusy}
          >
            {AI_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
        {providerId === 'local' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-text-secondary">{t('assistant.providers.localDescription')}</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={activateProvider}
              disabled={settings.assistantProvider === 'local'}
            >
              {t(settings.assistantProvider === 'local'
                ? 'assistant.providers.activeButton'
                : 'assistant.providers.useProvider')}
            </button>
          </div>
        ) : (
          <>
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-text-secondary">
              {selectedProvider?.local
                ? t('assistant.providers.localServerNote')
                : t('assistant.providers.cloudNote')}
            </p>
            {providerState && !providerState.secureStorageAvailable && (
              <p role="alert" className="text-sm text-error">
                {t('assistant.providers.error.secureStorage')}
              </p>
            )}
            {(selectedProvider?.custom || selectedProvider?.local) && (
              <label className="block space-y-1.5 text-sm">
                <span>{t('assistant.providers.endpoint')}</span>
                <input
                  type="url"
                  value={providerDraft.baseUrl}
                  onChange={(event) => setProviderDrafts((current) => ({
                    ...current,
                    [providerId]: { ...providerDraft, baseUrl: event.target.value },
                  }))}
                  maxLength={500}
                  className="input w-full"
                  placeholder="http://127.0.0.1:11434/v1"
                  autoComplete="url"
                />
              </label>
            )}
            {(selectedProvider?.keyRequired || selectedProvider?.custom) && (
              <label className="block space-y-1.5 text-sm">
                <span>{t('assistant.providers.apiKey')}</span>
                <input
                  type="password"
                  value={providerDraft.apiKey}
                  onChange={(event) => setProviderDrafts((current) => ({
                    ...current,
                    [providerId]: { ...providerDraft, apiKey: event.target.value },
                  }))}
                  maxLength={2000}
                  className="input w-full"
                  placeholder={savedProvider?.hasApiKey
                    ? t('assistant.providers.keyStored')
                    : t('assistant.providers.keyPlaceholder')}
                  autoComplete="new-password"
                  spellCheck="false"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={saveProvider}
                disabled={providerBusy}
              >
                {providerBusy ? t('assistant.providers.saving') : t('common.save')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={discoverProviderModels}
                disabled={providerBusy}
              >
                <RefreshCw size={14} />
                {providerBusy ? t('assistant.providers.loadingModels') : t('assistant.providers.discover')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={testProviderKey}
                disabled={providerBusy}
              >
                {providerBusy
                  ? t('assistant.providers.testing')
                  : t(selectedProvider?.keyRequired
                    ? 'assistant.providers.testKey'
                    : 'assistant.providers.testConnection')}
              </button>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span>{t('assistant.providers.model')}</span>
              <input
                type="text"
                list="orbit-ai-provider-models"
                value={providerModelId}
                onChange={(event) => updateSettings({
                  assistantProviderModels: {
                    ...settings.assistantProviderModels,
                    [providerId]: event.target.value.slice(0, 200),
                  },
                })}
                maxLength={200}
                className="input w-full"
                placeholder={t('assistant.providers.modelPlaceholder')}
                autoComplete="off"
              />
              <datalist id="orbit-ai-provider-models">
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </datalist>
            </label>
            {!selectedProvider?.local && (
              <label className="flex items-start gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={cloudConsent}
                  onChange={(event) => {
                    updateSettings({
                      assistantCloudConsent: {
                        ...settings.assistantCloudConsent,
                        [providerId]: event.target.checked,
                      },
                    });
                    setProviderError('');
                  }}
                  className="mt-0.5"
                />
                <span>{t('assistant.providers.consent')}</span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={testProviderModel}
                disabled={providerBusy || !providerModelId.trim()}
              >
                {providerBusy ? t('assistant.providers.testing') : t('assistant.providers.testModel')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={activateProvider}
                disabled={providerBusy || settings.assistantProvider === providerId}
              >
                {settings.assistantProvider === providerId
                  ? t('assistant.providers.activeButton')
                  : t('assistant.providers.useProvider')}
              </button>
              {savedProvider?.hasApiKey && (
                <span className="text-xs text-emerald-500">{t('assistant.providers.keySaved')}</span>
              )}
            </div>
          </>
        )}
        {providerError && <p role="alert" className="text-sm text-error">{providerErrorText(providerError)}</p>}
        {providerMessage === 'saved' && (
          <p role="status" className="text-sm text-emerald-500">{t('assistant.providers.saved')}</p>
        )}
        {providerMessage === 'key-cleared' && (
          <p role="status" className="text-sm text-emerald-500">{t('assistant.providers.keyCleared')}</p>
        )}
        {providerMessage === 'key-tested' && (
          <p role="status" className="text-sm text-emerald-500">{t('assistant.providers.keyTestPassed')}</p>
        )}
        {providerMessage === 'model-tested' && (
          <p role="status" className="text-sm text-emerald-500">
            {t('assistant.providers.modelTestPassed', { reply: providerTestReply })}
          </p>
        )}
        {providerMessage === 'no-models' && (
          <p role="status" className="text-sm text-text-muted">{t('assistant.providers.noModels')}</p>
        )}
        {savedProvider?.hasApiKey && (
          <button
            type="button"
            className="btn btn-ghost btn-sm text-error"
            onClick={clearProviderKey}
            disabled={providerBusy}
          >
            {t('assistant.providers.clearKey')}
          </button>
        )}
      </section>

      <div className="card space-y-4">
        <div>
          <h4 className="mb-1 font-semibold">{t('assistant.settings.models')}</h4>
          <p className="text-sm text-text-muted">{t('assistant.settings.modelHint')}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-hover/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Cpu size={17} className="text-accent-primary" />
              <h5 className="font-medium">{t('assistant.settings.deviceTitle')}</h5>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={refreshDeviceInfo}
              disabled={Boolean(busy)}
              aria-label={t('assistant.settings.refreshDevice')}
              title={t('assistant.settings.refreshDevice')}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {hardware ? (
            <p className="mt-2 text-xs text-text-muted">
              {t('assistant.settings.deviceInfo', {
                total: (hardware.totalMemory / GB).toFixed(1),
                free: (hardware.freeMemory / GB).toFixed(1),
                cores: hardware.cpuCores,
                cpu: hardware.cpuModel || hardware.arch,
              })}
              {' · '}
              {webGPUAvailable === null
                ? t('assistant.settings.gpuChecking')
                : t(webGPUAvailable ? 'assistant.settings.gpuAvailable' : 'assistant.settings.gpuUnavailable')}
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-muted">{t('assistant.settings.deviceChecking')}</p>
          )}
          <p className="mt-2 text-xs text-text-muted">{t('assistant.settings.deviceEstimate')}</p>
          {recommendation && (
            <p className="mt-2 text-sm font-medium text-accent-primary">
              {t('assistant.settings.bestMatch', {
                model: t(MODEL_LABELS[recommendation]),
              })}
            </p>
          )}
        </div>
        {MODEL_ORDER.map((modelKey) => {
          const model = state?.models?.[modelKey];
          const selected = selectedModel === modelKey;
          const downloading = busy === modelKey;
          const label = t(MODEL_LABELS[modelKey]);
          const fit = model
            ? assessAssistantModel(model, hardware, webGPUAvailable)
            : 'unknown';
          const unavailable = fit === 'unsupported';
          const assessmentPending = fit === 'unknown';
          return (
            <div key={modelKey} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="orbit-assistant-model"
                  checked={selected}
                  onChange={() => updateSettings({ assistantModel: modelKey })}
                  disabled={unavailable || assessmentPending}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label}</span>
                    {model?.installed && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-500">
                        {t('assistant.settings.installed')}
                      </span>
                    )}
                    {modelKey === recommendation && (
                      <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[11px] text-accent-primary">
                        {t('assistant.settings.recommended')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {t('assistant.settings.modelSize', { size: bytes(model?.size || (
                      modelKey === 'smollm2-360m' ? 386495938 :
                        modelKey === 'qwen3-0.6b' ? 919096585 : 1426069098
                    )) })}
                  </p>
                  {model && (
                    <p className={`mt-2 text-xs ${fit === 'unsupported' ? 'text-error' : 'text-text-muted'}`}>
                      {t(`assistant.settings.fit.${fit}`)}
                    </p>
                  )}
                </div>
                <HardDrive size={16} className="mt-1 text-text-muted" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 pl-7">
                {!model?.installed ? (
                  <button
                    type="button"
                    onClick={() => withBusy(modelKey, () => api()?.installModel(modelKey))}
                    disabled={Boolean(busy) || unavailable || assessmentPending}
                    className="btn btn-primary btn-sm"
                  >
                    <Download size={14} />
                    {downloading ? t('assistant.settings.downloading') : t('assistant.settings.download')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => withBusy(modelKey, () => api()?.removeModel(modelKey))}
                    disabled={Boolean(busy)}
                    className="btn btn-ghost btn-sm text-error"
                  >
                    <Trash2 size={14} />
                    {t('assistant.settings.remove')}
                  </button>
                )}
              </div>
              {downloading && progress && (
                <div className="mt-3 pl-7">
                  <p className="mb-1 text-xs text-text-muted">
                    {progress.fileIndex}/{progress.fileCount} · {progress.file}
                    {progressPercent !== null ? ` · ${progressPercent}%` : ''}
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                    <div
                      className="h-full bg-accent-primary transition-all"
                      style={{ width: `${progressPercent ?? 5}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
      </div>

      <div className="card">
        <h4 className="mb-1 font-semibold">{t('assistant.dictionary.title')}</h4>
        <p className="mb-3 text-sm text-text-muted">{t('assistant.dictionary.description')}</p>
        <form onSubmit={addWord} className="mb-3 flex gap-2">
          <input
            value={newWord}
            onChange={(event) => setNewWord(event.target.value)}
            maxLength={80}
            className="input min-w-0 flex-1"
            placeholder={t('assistant.dictionary.placeholder')}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!newWord.trim() || dictionary.length >= 500}>
            <Plus size={15} />
            {t('assistant.dictionary.add')}
          </button>
        </form>
        {dictionary.length ? (
          <ul className="flex flex-wrap gap-2">
            {dictionary.map((word) => (
              <li key={word} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
                <span>{word}</span>
                <button
                  type="button"
                  onClick={() => removeWord(word)}
                  className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-error"
                  aria-label={t('assistant.dictionary.remove', { word })}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-muted">{t('assistant.dictionary.empty')}</p>
        )}
      </div>
    </div>
  );
}
