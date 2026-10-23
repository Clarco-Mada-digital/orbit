import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Copy, FileText, LoaderCircle, Send, ShieldCheck, Sparkles, SpellCheck, WandSparkles, X } from 'lucide-react';
import { useT, resolveLang, translate } from '../lib/i18n';
import { useStore } from '../stores/useStore';
import { proposeOrbitAction } from '../lib/assistantActions';
import {
  createAssistantMessages,
  getAssistantOutputTokenLimit,
  getRemoteAssistantOutputTokenLimit,
} from '../lib/assistantPrompts';
import { assessAssistantModel } from '../lib/assistantRecommendations';
import { getAiProvider } from '../lib/aiProviders';

const MODE_KEYS = ['chat', 'correct', 'rewrite', 'summarize'];
const MODEL_LABEL_KEYS = {
  'smollm2-360m': 'assistant.model.smollm',
  'qwen3-0.6b': 'assistant.model.small',
  'qwen3-1.7b': 'assistant.model.large',
};
const EMPTY_DICTIONARY = [];
const ERROR_KEYS = {
  'model-not-installed': 'assistant.error.modelMissing',
  busy: 'assistant.error.busy',
  'invalid-text': 'assistant.error.invalid-text',
  'context-too-long': 'assistant.error.context-too-long',
  'no-editable-context': 'assistant.error.no-editable-context',
  'stale-page': 'assistant.error.stale-page',
  'context-read-failed': 'assistant.error.context-read-failed',
  'model-server-unavailable': 'assistant.error.modelServer',
  'model-load-failed': 'assistant.error.modelLoadFailed',
  'inference-failed': 'assistant.error.inferenceFailed',
  'api-key-required': 'assistant.providers.error.apiKey',
  'provider-timeout': 'assistant.providers.error.timeout',
  'provider-unreachable': 'assistant.providers.error.connection',
  'provider-empty-response': 'assistant.providers.error.empty',
  'provider-invalid-response': 'assistant.providers.error.invalidResponse',
  'provider-response-too-large': 'assistant.providers.error.invalidResponse',
  'invalid-provider-config': 'assistant.providers.error.config',
  'provider-consent-required': 'assistant.providers.error.consent',
  'provider-model-required': 'assistant.providers.error.model',
};
const MODE_ICONS = {
  chat: Bot,
  correct: SpellCheck,
  rewrite: WandSparkles,
  summarize: FileText,
};
const api = () => window.electronAPI?.assistant;
const providerApi = () => window.electronAPI?.aiProviders;

export default function OrbitAssistant() {
  const t = useT();
  const languageSetting = useStore((state) => state.settings?.language);
  const modelKey = useStore((state) => state.settings?.assistantModel || 'qwen3-0.6b');
  const providerId = useStore((state) => state.settings?.assistantProvider || 'local');
  const configuredProviderModel = useStore((state) => state.settings?.assistantProviderModels?.[providerId]);
  const providerModelId = typeof configuredProviderModel === 'string' ? configuredProviderModel : '';
  const cloudConsent = useStore((state) => state.settings?.assistantCloudConsent?.[providerId] === true);
  const assistantChatEnabled = useStore((state) => state.settings?.assistantChatEnabled !== false);
  const updateSettings = useStore((state) => state.updateSettings);
  const dictionary = useStore((state) => state.settings?.assistantDictionary || EMPTY_DICTIONARY);
  const apps = useStore((state) => state.apps);
  const [request, setRequest] = useState(null);
  const [chatOnly, setChatOnly] = useState(false);
  const [mode, setMode] = useState('chat');
  const [rewriteStyle, setRewriteStyle] = useState('natural');
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const questionInputRef = useRef(null);
  const [contextText, setContextText] = useState('');
  const [contextKind, setContextKind] = useState('selection');
  const [resultText, setResultText] = useState('');
  const [messages, setMessages] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [modelState, setModelState] = useState(null);
  const [providerState, setProviderState] = useState(null);
  const [modelProgress, setModelProgress] = useState(null);
  const [webGPUAvailable, setWebGPUAvailable] = useState(null);
  const [generationStage, setGenerationStage] = useState('');
  const [generationStartedAt, setGenerationStartedAt] = useState(null);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const generatorRef = useRef(null);
  const language = resolveLang(languageSetting);
  const isOpen = Boolean(request);
  const isChat = mode === 'chat';
  const selectedModel = modelState?.models?.[modelKey];
  const activeProvider = getAiProvider(providerId);
  const usesOrbitModel = providerId === 'local';
  const providerReady = usesOrbitModel || Boolean(
    providerModelId.trim() &&
    providerState?.providers?.[providerId]?.configured &&
    (activeProvider?.local || cloudConsent)
  );
  const modelFit = selectedModel
    ? assessAssistantModel(selectedModel, modelState?.hardware, webGPUAvailable)
    : 'unknown';
  const canReplaceSelection =
    request?.wcId != null &&
    contextKind === 'selection' &&
    !isChat;

  const cancelBookmark = useCallback((target) => {
    if (!target?.bookmarkToken || target.wcId == null) return;
    window.electronAPI?.contextMenu?.run?.(
      target.wcId,
      'proofread:cancel',
      target.bookmarkToken
    ).catch((err) => {
      console.error('[orbit] nettoyage de la sélection de l’assistant échoué:', err);
    });
  }, []);

  const issueError = useCallback((code) => {
    setError(translate(language, ERROR_KEYS[code] || 'assistant.error.generic'));
  }, [language]);

  const refreshModelState = useCallback(async () => {
    try {
      const state = await api()?.state();
      if (state?.success) setModelState(state);
      else if (state?.error) issueError(state.error);
      try {
        const providers = await providerApi()?.state();
        if (providers?.success) setProviderState(providers);
        else if (providers?.error) console.error('[orbit] configuration des fournisseurs IA indisponible:', providers.error);
      } catch (providerError) {
        console.error('[orbit] configuration des fournisseurs IA indisponible:', providerError);
      }
      try {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
        setWebGPUAvailable(Boolean(adapter));
      } catch (gpuError) {
        console.error('[orbit] détection WebGPU de l’assistant échouée:', gpuError);
        setWebGPUAvailable(false);
      }
    } catch (err) {
      console.error('[orbit] état du modèle assistant indisponible:', err);
      issueError('generic');
    }
  }, [issueError]);

  useEffect(() => {
    const openSelection = api()?.onSelection?.((payload) => {
      cancelBookmark(request);
      setRequest(payload);
      setChatOnly(false);
      setMode(payload?.editable ? 'correct' : 'chat');
      setText(payload?.text || '');
      setQuestion('');
      setContextText(payload?.text || '');
      setContextKind('selection');
      setResultText('');
      setMessages([]);
      setPendingAction(null);
      setError('');
      if (payload?.error) issueError(payload.error);
      refreshModelState();
    });
    const openAssistant = () => {
      cancelBookmark(request);
      setRequest({ wcId: null, text: '' });
      setChatOnly(false);
      setMode('chat');
      setText('');
      setQuestion('');
      setContextText('');
      setContextKind('selection');
      setResultText('');
      setMessages([]);
      setPendingAction(null);
      setError('');
      refreshModelState();
    };
    const openChatAssistant = () => {
      if (!assistantChatEnabled) return;
      cancelBookmark(request);
      setRequest({ wcId: null, text: '' });
      setChatOnly(true);
      setMode('chat');
      setText('');
      setQuestion('');
      setContextText('');
      setContextKind('selection');
      setResultText('');
      setMessages([]);
      setPendingAction(null);
      setError('');
      refreshModelState();
    };
    window.addEventListener('orbit:assistant-open', openAssistant);
    window.addEventListener('orbit:assistant-chat-open', openChatAssistant);
    return () => {
      if (typeof openSelection === 'function') openSelection();
      window.removeEventListener('orbit:assistant-open', openAssistant);
      window.removeEventListener('orbit:assistant-chat-open', openChatAssistant);
    };
  }, [assistantChatEnabled, cancelBookmark, issueError, refreshModelState, request]);

  useEffect(() => {
    if (isOpen && chatOnly) questionInputRef.current?.focus();
  }, [chatOnly, isOpen]);

  useEffect(() => {
    const closeChat = () => {
      if (!chatOnly) return;
      cancelBookmark(request);
      setRequest(null);
      setChatOnly(false);
    };
    window.addEventListener('orbit:assistant-chat-close', closeChat);
    return () => window.removeEventListener('orbit:assistant-chat-close', closeChat);
  }, [cancelBookmark, chatOnly, request]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !working) {
        cancelBookmark(request);
        setRequest(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelBookmark, isOpen, request, working]);

  useEffect(() => {
    if (!generationStartedAt) return undefined;
    const updateElapsed = () => setGenerationElapsed(Math.floor((Date.now() - generationStartedAt) / 1000));
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [generationStartedAt]);

  useEffect(() => {
    if (usesOrbitModel || working || !generatorRef.current) return;
    const loaded = generatorRef.current.generator;
    generatorRef.current = null;
    const releaseModel = async () => {
      try {
        await loaded.model?.dispose?.();
      } catch (err) {
        console.error('[orbit] libération du modèle local après changement de fournisseur échouée:', err);
      }
    };
    releaseModel();
  }, [usesOrbitModel, working]);

  const installed = Boolean(modelState?.models?.[modelKey]?.installed);
  const canRunAssistant = usesOrbitModel ? installed && modelFit !== 'unsupported' : providerReady;
  const smallerModelInstalled = Boolean(modelState?.models?.['qwen3-0.6b']?.installed);
  const canSuggestSmallerModel =
    modelKey === 'qwen3-1.7b' &&
    /bad_alloc|ERROR_CODE:\s*6|WebGPU|GPU adapter/i.test(error);
  const busy = working || Boolean(modelState?.downloading);
  const chatHistory = useMemo(
    () => messages.slice(-8).map(({ role, content }) => ({ role, content })),
    [messages]
  );

  const close = () => {
    if (!working) {
      cancelBookmark(request);
      setRequest(null);
    }
  };

  const loadDocumentContext = async () => {
    if (request?.wcId == null) return;
    setWorking(true);
    setError('');
    try {
      const response = await api()?.getDocument(request.wcId);
      if (!response?.success) {
        issueError(response?.error);
        return;
      }
      setContextText(response.text);
      setContextKind('document');
      if (!isChat) setText(response.text);
    } catch (err) {
      console.error('[orbit] lecture du texte de contexte échouée:', err);
      issueError('context-read-failed');
    } finally {
      setWorking(false);
    }
  };

  const requestAssistant = async (submittedText, submittedMode, actionProposal = null) => {
    if (usesOrbitModel && modelFit === 'unsupported') {
      setError(translate(language, 'assistant.error.modelNotSuitable'));
      return null;
    }
    if (usesOrbitModel && !installed) {
      issueError('model-not-installed');
      return null;
    }
    if (!usesOrbitModel && !providerModelId.trim()) {
      issueError('provider-model-required');
      return null;
    }
    if (!usesOrbitModel && !activeProvider?.local && !cloudConsent) {
      issueError('provider-consent-required');
      return null;
    }
    setWorking(true);
    setError('');
    setResultText('');
    setModelProgress(null);
    setGenerationStage(usesOrbitModel ? 'loading' : 'generating');
    setGenerationStartedAt(null);
    setGenerationElapsed(0);
    let failureStage = 'model-load-failed';
    try {
      const messagesForRequest = createAssistantMessages({
        mode: submittedMode,
        text: submittedText,
        language,
        dictionary,
        rewriteStyle,
        context: contextKind,
        contextText: submittedMode === 'chat' ? contextText : '',
        history: submittedMode === 'chat' ? chatHistory : [],
      });
      if (!usesOrbitModel) {
        failureStage = 'provider-unreachable';
        setGenerationStage('generating');
        setGenerationStartedAt(Date.now());
        const response = await providerApi()?.complete({
          providerId,
          model: providerModelId,
          messages: messagesForRequest,
          maxTokens: getRemoteAssistantOutputTokenLimit(submittedMode, submittedText),
        });
        if (!response?.success) {
          const code = response?.error || 'provider-unreachable';
          const status = /^provider-http-(\d{3})$/u.exec(code)?.[1];
          const errorKey = status === '401' || status === '403'
            ? 'assistant.providers.error.auth'
            : status === '429'
              ? 'assistant.providers.error.rateLimit'
              : status
                ? 'assistant.providers.error.http'
                : ERROR_KEYS[code] || 'assistant.providers.error';
          setError(translate(language, errorKey, status ? { status } : {}));
          return null;
        }
        const assistantText = response.text.trim();
        setResultText(assistantText);
        if (submittedMode === 'chat') {
          setMessages((current) => [
            ...current,
            { role: 'user', content: submittedText },
            { role: 'assistant', content: assistantText },
          ]);
          setPendingAction(actionProposal);
        }
        return assistantText;
      }
      let generator = generatorRef.current?.modelKey === modelKey
        ? generatorRef.current.generator
        : null;
      if (!generator) {
        if (generatorRef.current) {
          await generatorRef.current.generator.model?.dispose?.();
          generatorRef.current = null;
        }
        const modelUrl = await api()?.modelBaseUrl(modelKey);
        if (!modelUrl?.success) {
          issueError(modelUrl?.error);
          return null;
        }
        const { env, pipeline } = await import('@huggingface/transformers');
        env.localModelPath = modelUrl.url;
        env.allowLocalModels = true;
        // Transformers.js also checks file metadata through its remote-model
        // path; this URL is Orbit's loopback-only model server, not Hugging Face.
        env.allowRemoteModels = true;
        env.remoteHost = modelUrl.url;
        env.remotePathTemplate = '{model}/';
        let device = 'wasm';
        let dtype = 'q4';
        if (modelKey === 'qwen3-1.7b') {
          const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
          if (!adapter) {
            throw new Error('WebGPU adapter unavailable; the 1.7B model requires a compatible GPU. Use the 0.6B model.');
          }
          device = 'webgpu';
          dtype = 'q4f16';
        }
        if (env.backends.onnx?.wasm) {
          // Let ONNX Runtime select its WASM thread count and run CPU inference
          // in a worker without changing the WebGPU execution path.
          env.backends.onnx.wasm.proxy = device === 'wasm';
        }
        generator = await pipeline('text-generation', modelState.models[modelKey].id, {
          dtype,
          device,
          local_files_only: true,
          progress_callback: setModelProgress,
        });
        generatorRef.current = { modelKey, generator };
      }
      failureStage = 'inference-failed';
      setGenerationStage('generating');
      setGenerationStartedAt(Date.now());
      const { TextStreamer } = await import('@huggingface/transformers');
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk) => {
          if (chunk) setResultText((current) => current + chunk);
        },
      });
      const result = await generator(
        messagesForRequest,
        {
          max_new_tokens: getAssistantOutputTokenLimit(submittedMode, submittedText, modelKey),
          do_sample: false,
          chat_template_kwargs: { enable_thinking: false },
          streamer,
        }
      );
      const output = result?.[0]?.generated_text;
      const answer =
        typeof output === 'string'
          ? output
          : Array.isArray(output)
            ? output.at(-1)?.content
            : '';
      if (typeof answer !== 'string' || !answer.trim()) {
        issueError('inference-failed');
        return null;
      }
      const assistantText = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      setResultText(assistantText);
      if (submittedMode === 'chat') {
        setMessages((current) => [
          ...current,
          { role: 'user', content: submittedText },
          { role: 'assistant', content: assistantText },
        ]);
        setPendingAction(actionProposal);
      }
      return assistantText;
    } catch (err) {
      console.error('[orbit] requête de l’assistant échouée:', err);
      const details = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 240);
      setError(`${translate(language, ERROR_KEYS[failureStage])} ${details}`);
      if (usesOrbitModel && generatorRef.current?.modelKey === modelKey) {
        const failedGenerator = generatorRef.current.generator;
        generatorRef.current = null;
        try {
          await failedGenerator.model?.dispose?.();
        } catch (disposeError) {
          console.error('[orbit] libération du modèle après erreur échouée:', disposeError);
        }
      }
      return null;
    } finally {
      setModelProgress(null);
      setGenerationStage('');
      setGenerationStartedAt(null);
      setWorking(false);
    }
  };

  const sendChatMessage = async (event) => {
    event.preventDefault();
    const submitted = question.trim();
    if (!submitted) return;
    setQuestion('');
    await requestAssistant(submitted, 'chat', proposeOrbitAction(submitted, apps));
  };

  const generateText = async () => {
    const submitted = text.trim();
    if (!submitted) {
      issueError('invalid-text');
      return;
    }
    await requestAssistant(submitted, mode);
  };

  const copyResult = async () => {
    try {
      const copied = await api()?.copyText(resultText);
      if (!copied?.success) issueError(copied?.error);
    } catch (err) {
      console.error('[orbit] copie du résultat de l’assistant échouée:', err);
      issueError('generic');
    }
  };

  const applyResult = async () => {
    if (!canReplaceSelection || !resultText) return;
    setWorking(true);
    setError('');
    try {
      const applied = await window.electronAPI?.contextMenu?.run?.(
        request.wcId,
        'proofread:replace',
        { expected: request.text, replacement: resultText }
      );
      if (!applied?.success) {
        issueError(applied?.error);
        return;
      }
      setRequest(null);
    } catch (err) {
      console.error('[orbit] remplacement par l’assistant échoué:', err);
      issueError('generic');
    } finally {
      setWorking(false);
    }
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'settings') {
      window.dispatchEvent(new Event('orbit:assistant-open-settings'));
      setRequest(null);
      return;
    }
    if (pendingAction.type === 'app') {
      const app = apps.find((item) => item.id === pendingAction.appId);
      if (!app) {
        issueError('generic');
        setPendingAction(null);
        return;
      }
      const store = useStore.getState();
      store.setActiveProfile(app.profileId);
      store.setActiveApp(app.id);
      setPendingAction(null);
      setResultText('');
      return;
    }
    if (pendingAction.type === 'create-app') {
      let url;
      try {
        url = new URL(pendingAction.url);
      } catch {
        issueError('generic');
        setPendingAction(null);
        return;
      }
      const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) ||
        url.username ||
        url.password ||
        !pendingAction.name?.trim()
      ) {
        issueError('generic');
        setPendingAction(null);
        return;
      }
      const store = useStore.getState();
      store.addApp({
        profileId: store.activeProfile,
        recipeId: null,
        name: pendingAction.name.trim().slice(0, 60),
        url: url.href,
        homeUrl: url.href,
        icon: '🌐',
        color: '#6366f1',
        unread: 0,
        sleeping: false,
      });
      const created = useStore.getState().apps.at(-1);
      if (created) store.setActiveApp(created.id);
      setPendingAction(null);
      setResultText('');
      return;
    }
    if (
      pendingAction.type === 'setting' &&
      pendingAction.setting === 'theme' &&
      ['dark', 'light'].includes(pendingAction.value)
    ) {
      updateSettings({ theme: pendingAction.value });
      setPendingAction(null);
      setResultText('');
      return;
    }
  };

  const ModeIcon = MODE_ICONS[mode];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="orbit-assistant-title"
        aria-modal="true"
        className={`flex max-h-[min(90vh,900px)] w-full ${
          chatOnly ? 'max-w-4xl' : 'max-w-3xl'
        } flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl`}
        role="dialog"
      >
        <header className={`relative flex items-start gap-3 border-b border-border px-5 py-4 ${
          chatOnly ? 'bg-gradient-to-r from-accent-primary/10 via-bg-elevated to-violet-500/10' : ''
        }`}>
          <div className="mt-0.5 rounded-xl bg-accent-primary/10 p-2 text-accent-primary">
            {chatOnly ? <Sparkles size={20} /> : <ModeIcon size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="orbit-assistant-title" className="font-semibold text-text-primary">
              {chatOnly ? t('assistant.chat.title') : t('proofreader.title')}
            </h2>
            {chatOnly && (
              <p className="mt-1 text-xs text-text-muted">{t('assistant.chat.tagline')}</p>
            )}
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-500">
              <ShieldCheck size={12} />
              {usesOrbitModel
                ? t('assistant.local')
                : t('assistant.providers.active', {
                  provider: activeProvider?.label || providerId,
                })}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
            aria-label={t('assistant.stop')}
          >
            <X size={18} />
          </button>
        </header>

        {!chatOnly && <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
          {MODE_KEYS.map((key) => {
            const Icon = MODE_ICONS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setResultText('');
                  setError('');
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                  mode === key ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <Icon size={15} />
                {t(`assistant.mode.${key}`)}
              </button>
            );
          })}
          <label className="ml-auto flex shrink-0 items-center gap-2 self-center text-xs text-text-muted">
            <span>{t('assistant.settings.models')}</span>
            {usesOrbitModel ? (
              <select
                value={modelKey}
                onChange={(event) => {
                  updateSettings({ assistantModel: event.target.value });
                  setResultText('');
                  setError('');
                }}
                disabled={busy}
                className="max-w-44 rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-primary disabled:opacity-60"
                aria-label={t('assistant.settings.models')}
              >
                {Object.entries(MODEL_LABEL_KEYS).map(([key, labelKey]) => {
                  const candidate = modelState?.models?.[key];
                  const candidateFit = candidate
                    ? assessAssistantModel(candidate, modelState?.hardware, webGPUAvailable)
                    : 'unknown';
                  return (
                    <option
                      key={key}
                      value={key}
                      disabled={!candidate?.installed || candidateFit === 'unsupported'}
                    >
                      {modelState?.models?.[key]?.label || t(labelKey)}
                      {!candidate?.installed ? ` · ${t('assistant.settings.notInstalled')}` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <span className="max-w-52 truncate rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary">
                {providerModelId || t('assistant.providers.modelPlaceholder')}
              </span>
            )}
          </label>
        </nav>}

        <main className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-5 ${
          chatOnly ? 'bg-gradient-to-b from-bg-secondary/50 to-bg-primary/30 sm:px-8' : ''
        }`}>
          {!usesOrbitModel && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-text-secondary">
              {activeProvider?.local
                ? t('assistant.providers.localServerNote')
                : t('assistant.providers.cloudNote')}
            </p>
          )}
          {!providerReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm text-text-secondary">{t('assistant.providers.setupRequired')}</p>
              <button
                type="button"
                onClick={() => {
                  setRequest(null);
                  window.dispatchEvent(new Event('orbit:assistant-open-settings'));
                }}
                className="btn btn-primary btn-sm whitespace-nowrap"
              >
                {t('common.settings')}
              </button>
            </div>
          )}
          {usesOrbitModel && !installed && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm text-text-secondary">{t('assistant.error.modelMissing')}</p>
              <button
                type="button"
                onClick={() => {
                  setRequest(null);
                  window.dispatchEvent(new Event('orbit:assistant-open-settings'));
                }}
                className="btn btn-primary btn-sm whitespace-nowrap"
              >
                {t('common.settings')}
              </button>
            </div>
          )}

          {usesOrbitModel && installed && modelFit === 'unsupported' && (
            <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-text-secondary">
              {t('assistant.error.modelNotSuitable')}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <p>{error}</p>
              {canSuggestSmallerModel && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs">{t('assistant.error.memoryHint')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (smallerModelInstalled) {
                        updateSettings({ assistantModel: 'qwen3-0.6b' });
                        setError('');
                      } else {
                        cancelBookmark(request);
                        setRequest(null);
                        window.dispatchEvent(new Event('orbit:assistant-open-settings'));
                      }
                    }}
                    className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/25"
                  >
                    {t(smallerModelInstalled ? 'assistant.error.useSmallModel' : 'assistant.error.installSmallModel')}
                  </button>
                </div>
              )}
            </div>
          )}
          {working && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-primary/40 px-3 py-2 text-xs text-text-muted">
              <LoaderCircle size={14} className="animate-spin text-accent-primary" />
              <span className="min-w-0 flex-1 truncate">
                {usesOrbitModel && modelProgress?.file
                  ? modelProgress.file
                  : t(generationStage === 'loading'
                    ? 'assistant.loadingModel'
                    : 'assistant.generating')}
              </span>
              {usesOrbitModel && Number.isFinite(modelProgress?.progress) && (
                <span>{Math.round(modelProgress.progress)}%</span>
              )}
              {generationStage === 'generating' && (
                <span>{t('assistant.elapsed', { seconds: generationElapsed })}</span>
              )}
            </div>
          )}

          {isChat ? (
            <>
              {chatOnly && messages.length === 0 && (
                <div className="mx-auto flex min-h-[300px] max-w-2xl flex-col items-center justify-center py-8 text-center">
                  <div className="mb-5 rounded-2xl border border-accent-primary/20 bg-gradient-to-br from-accent-primary/15 to-violet-500/10 p-4 text-accent-primary shadow-lg shadow-accent-primary/5">
                    <Sparkles size={28} />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-text-primary">
                    {t('assistant.chat.welcome')}
                  </h3>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-text-muted">
                    {t('assistant.chat.welcomeDescription')}
                  </p>
                  <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                    {['write', 'organize', 'orbit'].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          const prompts = {
                            write: t('assistant.chat.suggestion.writePrompt'),
                            organize: t('assistant.chat.suggestion.organizePrompt'),
                            orbit: t('assistant.chat.suggestion.orbitPrompt'),
                          };
                          setQuestion(prompts[suggestion]);
                          questionInputRef.current?.focus();
                        }}
                        className="rounded-xl border border-border bg-bg-elevated/80 p-3 text-left text-sm text-text-secondary transition hover:border-accent-primary/40 hover:bg-accent-primary/5 hover:text-text-primary"
                      >
                        {t(`assistant.chat.suggestion.${suggestion}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {contextText && (
                <div className="rounded-xl border border-border bg-bg-primary/50 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-muted">
                    <span>
                      {t(contextKind === 'document' ? 'assistant.textContext.document' : 'assistant.textContext.selection')}
                      {' · '}{contextText.length.toLocaleString(language)}
                    </span>
                    <button type="button" onClick={() => { setContextText(''); setContextKind('selection'); }}>
                      <X size={14} />
                    </button>
                  </div>
                  <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm text-text-secondary">{contextText}</p>
                </div>
              )}
              {request.wcId != null && !contextText && (
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-xs text-text-muted">{t('assistant.textContext.note')}</p>
                  <button type="button" onClick={loadDocumentContext} disabled={busy || (usesOrbitModel && modelFit === 'unsupported')} className="btn btn-ghost btn-sm">
                    <FileText size={14} />
                    {t('assistant.textContext.load')}
                  </button>
                </div>
              )}
              <div className={chatOnly ? 'mx-auto w-full max-w-3xl space-y-4' : 'space-y-3'}>
                {messages.map((message, index) => (
                  <article
                    key={`${message.role}-${index}`}
                    className={chatOnly
                      ? `flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`
                      : ''}
                  >
                    {chatOnly && message.role === 'assistant' && (
                      <div className="mt-1 shrink-0 rounded-lg bg-accent-primary/10 p-2 text-accent-primary">
                        <Sparkles size={16} />
                      </div>
                    )}
                    <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${
                      chatOnly
                        ? message.role === 'user'
                          ? 'rounded-br-md bg-accent-primary text-white shadow-sm'
                          : 'rounded-bl-md border border-border bg-bg-elevated text-text-secondary shadow-sm'
                        : message.role === 'user'
                          ? 'ml-8 bg-accent-primary/10 text-text-primary'
                          : 'mr-8 border border-border bg-bg-primary/50 text-text-secondary'
                    }`}>
                      {!chatOnly && (
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                          {message.role === 'user' ? t('assistant.chat.you') : t('assistant.chat.title')}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words leading-6">{message.content}</p>
                    </div>
                  </article>
                ))}
              </div>
              {pendingAction && (
                <div className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 p-3">
                  <p className="mb-2 text-sm text-text-primary">
                    {pendingAction.type === 'settings'
                      ? t('assistant.action.openSettings')
                      : pendingAction.type === 'app'
                        ? t('assistant.action.openApp', { name: pendingAction.name })
                        : pendingAction.type === 'create-app'
                          ? t('assistant.action.createApp', {
                            name: pendingAction.name,
                            url: pendingAction.url,
                          })
                          : t('assistant.action.setTheme', {
                            theme: t(`assistant.action.theme.${pendingAction.value}`),
                          })}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={confirmAction} className="btn btn-primary btn-sm">
                      <Check size={14} /> {t('assistant.action.confirm')}
                    </button>
                    <button type="button" onClick={() => setPendingAction(null)} className="btn btn-ghost btn-sm">
                      {t('assistant.action.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {mode === 'rewrite' && (
                <label className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg-primary/40 px-4 py-3">
                  <span className="text-sm font-medium text-text-secondary">
                    {t('assistant.rewriteStyle.label')}
                  </span>
                  <select
                    value={rewriteStyle}
                    onChange={(event) => setRewriteStyle(event.target.value)}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-primary"
                  >
                    {['natural', 'professional', 'friendly', 'casual', 'concise'].map((style) => (
                      <option key={style} value={style}>{t(`assistant.rewriteStyle.${style}`)}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-text-muted">
                  {t(contextKind === 'document' ? 'assistant.textContext.document' : 'assistant.textContext.selection')}
                </span>
                {request.wcId != null && contextKind === 'selection' && (
                  <button type="button" onClick={loadDocumentContext} disabled={busy} className="btn btn-ghost btn-sm">
                    <FileText size={14} />
                    {t('assistant.textContext.load')}
                  </button>
                )}
                {contextKind === 'document' && (
                  <button
                    type="button"
                    onClick={() => {
                      setContextKind('selection');
                      setContextText(request.text || '');
                      setText(request.text || '');
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    {t('assistant.textContext.selection')}
                  </button>
                )}
              </div>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={12000}
                rows={8}
                className="input min-h-40 w-full resize-y"
                placeholder={t('assistant.input.placeholder')}
                onMouseDown={(event) => event.stopPropagation()}
              />
              <div className="flex justify-end text-xs text-text-muted">{text.length.toLocaleString(language)} / 12 000</div>
            </>
          )}

          {!isChat && (
            <section className="rounded-xl border border-border bg-bg-primary/50 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('assistant.result.title')}
              </h3>
              <p className="mb-2 text-xs text-text-muted">
                {t(usesOrbitModel ? 'assistant.performanceNote' : 'assistant.providers.performance')}
              </p>
              <textarea
                value={resultText}
                onChange={(event) => setResultText(event.target.value)}
                maxLength={12000}
                rows={6}
                disabled={working || !resultText}
                className="input min-h-32 w-full resize-y"
                placeholder={working ? t('assistant.result.generating') : t('assistant.result.empty')}
                aria-label={t('assistant.result.title')}
                onMouseDown={(event) => event.stopPropagation()}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {canReplaceSelection && (
                  <button type="button" onClick={applyResult} disabled={busy || !resultText.trim()} className="btn btn-primary btn-sm">
                    <Check size={14} /> {t('assistant.apply')}
                  </button>
                )}
                <button type="button" onClick={copyResult} disabled={!resultText.trim()} className="btn btn-ghost btn-sm">
                  <Copy size={14} /> {t('assistant.copy')}
                </button>
              </div>
            </section>
          )}
        </main>

        <footer className={`border-t border-border p-4 ${
          chatOnly ? 'bg-bg-elevated/95 sm:px-8 sm:py-5' : ''
        }`}>
          {isChat ? (
            <form onSubmit={sendChatMessage} className={`mx-auto flex w-full items-end gap-2 ${
              chatOnly ? 'max-w-3xl rounded-2xl border border-border bg-bg-primary/60 p-2 shadow-lg shadow-black/5 focus-within:border-accent-primary/50' : ''
            }`}>
              <textarea
                ref={questionInputRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={12000}
                rows={chatOnly ? 3 : 2}
                className={`input min-h-12 flex-1 resize-y ${
                  chatOnly ? 'border-0 bg-transparent shadow-none focus:border-0 focus:ring-0' : ''
                }`}
                placeholder={t(chatOnly ? 'assistant.chat.inputPlaceholder' : 'assistant.input.placeholder')}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (chatOnly && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button type="submit" disabled={busy || !question.trim() || !canRunAssistant} className={`btn btn-primary self-stretch ${
                chatOnly ? 'rounded-xl px-4' : ''
              }`}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
                {!chatOnly && t('assistant.send')}
              </button>
            </form>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={generateText}
                disabled={busy || !text.trim() || !canRunAssistant}
                className="btn btn-primary"
              >
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <WandSparkles size={16} />}
                {busy ? t('assistant.generating') : t('assistant.generate')}
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
