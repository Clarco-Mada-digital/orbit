import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Compass, Copy, Download, FileText, History, Languages, Lightbulb, ListChecks, LoaderCircle, Mail, MessageCircle, Reply, Send, ShieldCheck, Sparkles, SpellCheck, Trash2, WandSparkles, X } from 'lucide-react';
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
import {
  filterAssistantCommands,
  parseAssistantCommand,
} from '../lib/assistantCommands';
import { getAssistantAgent } from '../lib/assistantAgents';
import { appendSessionMessages, createAssistantSession } from '../lib/assistantSessions';
import { downloadAssistantMarkdown } from '../lib/assistantExport';
import AssistantWorkspaceSidebar from './AssistantWorkspaceSidebar';

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown'));

const MODE_KEYS = ['chat', 'correct', 'rewrite', 'summarize'];
const MODEL_LABEL_KEYS = {
  'smollm2-135m': 'assistant.model.smollm135',
  'smollm2-360m': 'assistant.model.smollm',
  'qwen2.5-0.5b': 'assistant.model.qwen25',
  'qwen3-0.6b': 'assistant.model.small',
};
const EMPTY_DICTIONARY = [];
const EMPTY_SESSIONS = [];
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
const COMMAND_ICONS = {
  chat: MessageCircle,
  fix: SpellCheck,
  rewrite: WandSparkles,
  summarize: FileText,
  email: Mail,
  reply: Reply,
  ideas: ListChecks,
  explain: Lightbulb,
  translate: Languages,
  orbit: Compass,
};
const api = () => window.electronAPI?.assistant;
const providerApi = () => window.electronAPI?.aiProviders;

export default function OrbitAssistant({ onReady }) {
  const t = useT();
  const languageSetting = useStore((state) => state.settings?.language);
  const configuredModelKey = useStore((state) => state.settings?.assistantModel || 'qwen3-0.6b');
  const modelKey = configuredModelKey === 'llama-1b' ? 'qwen3-0.6b' : configuredModelKey;
  const providerId = useStore((state) => state.settings?.assistantProvider || 'local');
  const configuredProviderModel = useStore((state) => state.settings?.assistantProviderModels?.[providerId]);
  const providerModelId = typeof configuredProviderModel === 'string' ? configuredProviderModel : '';
  const cloudConsent = useStore((state) => state.settings?.assistantCloudConsent?.[providerId] === true);
  const assistantChatEnabled = useStore((state) => state.settings?.assistantChatEnabled !== false);
  const agentId = useStore((state) => state.settings?.assistantAgentId || 'writer');
  const activeAgent = getAssistantAgent(agentId);
  const savedAgentFavorites = useStore((state) => state.settings?.assistantAgentFavorites);
  const agentFavorites = Array.isArray(savedAgentFavorites) ? savedAgentFavorites : [];
  const updateSettings = useStore((state) => state.updateSettings);
  const dictionary = useStore((state) => state.settings?.assistantDictionary || EMPTY_DICTIONARY);
  const apps = useStore((state) => state.apps);
  const assistantSessions = useStore((state) => state.assistantSessions) ?? EMPTY_SESSIONS;
  const saveAssistantSession = useStore((state) => state.saveAssistantSession);
  const renameAssistantSession = useStore((state) => state.renameAssistantSession);
  const deleteAssistantSession = useStore((state) => state.deleteAssistantSession);
  const clearAssistantSessions = useStore((state) => state.clearAssistantSessions);
  const [request, setRequest] = useState(null);
  const [chatOnly, setChatOnly] = useState(false);
  const [mode, setMode] = useState('chat');
  const [rewriteStyle, setRewriteStyle] = useState('natural');
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('conversations');
  const [activeSessionId, setActiveSessionId] = useState('');
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
    onReady?.();
    const openSelection = (event) => {
      const payload = event.detail;
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
      setActiveSessionId('');
      setSidebarTab('conversations');
      setPendingAction(null);
      setError('');
      setCommandsDismissed(false);
      setCommandIndex(0);
      if (payload?.error) issueError(payload.error);
      refreshModelState();
    };
    const openConversation = (event) => {
      const session = assistantSessions.find(
        (item) => item.id === event.detail?.sessionId
      );
      if (!session) return;
      cancelBookmark(request);
      setRequest({ wcId: null, text: '' });
      setChatOnly(true);
      setMode('chat');
      setContextText('');
      setContextKind('selection');
      setResultText('');
      setActiveSessionId(session.id);
      if (session.agentId) updateSettings({ assistantAgentId: session.agentId });
      setMessages(Array.isArray(session.messages) ? session.messages : []);
      setQuestion('');
      setSidebarTab('conversations');
      setPendingAction(null);
      setError('');
      setCommandsDismissed(false);
      setCommandIndex(0);
      refreshModelState();
    };
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
      setActiveSessionId('');
      setSidebarTab('conversations');
      setPendingAction(null);
      setError('');
      setCommandsDismissed(false);
      setCommandIndex(0);
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
      // On rouvre la dernière DISCUSSION (pas la dernière correction
      // rapide) : c’est tout l’intérêt de l’historique, on reprend là où on
      // s’était arrêté, sans tomber sur un texte corrigé.
      const latest = (useStore.getState().assistantSessions || [])
        .find((session) => session.mode === 'chat') || null;
      setActiveSessionId(latest?.id || '');
      if (latest?.agentId) updateSettings({ assistantAgentId: latest.agentId });
      setMessages(Array.isArray(latest?.messages) ? latest.messages : []);
      setSidebarTab('conversations');
      setPendingAction(null);
      setError('');
      setCommandsDismissed(false);
      setCommandIndex(0);
      refreshModelState();
    };
    window.addEventListener('orbit:assistant-selection', openSelection);
    window.addEventListener('orbit:assistant-load-conversation', openConversation);
    window.addEventListener('orbit:assistant-open', openAssistant);
    window.addEventListener('orbit:assistant-chat-open', openChatAssistant);
    return () => {
      window.removeEventListener('orbit:assistant-selection', openSelection);
      window.removeEventListener('orbit:assistant-load-conversation', openConversation);
      window.removeEventListener('orbit:assistant-open', openAssistant);
      window.removeEventListener('orbit:assistant-chat-open', openChatAssistant);
    };
  }, [
    assistantChatEnabled,
    assistantSessions,
    cancelBookmark,
    issueError,
    onReady,
    refreshModelState,
    request,
    updateSettings,
  ]);

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
    () => messages.slice(-12).map(({ role, content }) => ({ role, content })),
    [messages]
  );
  const availableCommands = useMemo(
    () => (chatOnly
      ? activeAgent.commands.map((command) => ({
        ...command,
        category: activeAgent.categoryKey,
      }))
      : []),
    [activeAgent, chatOnly]
  );
  const commandDraft = useMemo(
    () => parseAssistantCommand(question, availableCommands),
    [availableCommands, question]
  );
  const commandQuery = useMemo(() => {
    if (commandsDismissed || availableCommands.length === 0) return null;
    const match = /^\/([a-z0-9-]*)$/i.exec(question);
    return match ? match[1].toLocaleLowerCase() : null;
  }, [availableCommands.length, commandsDismissed, question]);
  const matchingCommands = useMemo(
    () => (commandQuery === null ? [] : filterAssistantCommands(commandQuery, availableCommands)),
    [availableCommands, commandQuery]
  );
  const commandGroups = useMemo(
    () => (commandQuery === null || availableCommands.length === 0
      ? []
      : [{
        id: activeAgent.categoryKey,
        labelKey: activeAgent.categoryKey,
        commands: matchingCommands,
      }].filter((category) => category.commands.length > 0)),
    [activeAgent.categoryKey, availableCommands.length, commandQuery, matchingCommands]
  );
  const commandMenuOpen = commandQuery !== null;
  const chatDraftText = commandDraft.command ? commandDraft.text : question.trim();
  const activeSession = useMemo(
    () => assistantSessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, assistantSessions]
  );

  // Trace un échange de la discussion : l’historique garde le fil pour la
  // prochaine ouverture, même si la fenêtre est fermée entre deux messages.
  const storeChatTurn = (submittedText, commandId, assistantText) => {
    const now = Date.now();
    const turn = [
      { role: 'user', content: submittedText, command: commandId || undefined },
      { role: 'assistant', content: assistantText },
    ];
    setMessages([...messages, ...turn]);
    // Reprendre une session d’action rapide la transforme en discussion :
    // elle doit alors se rouvrir comme telle la prochaine fois.
    const sessionAgentId = chatOnly ? agentId : '';
    const base = activeSession
      ? { ...activeSession, mode: 'chat', agentId: sessionAgentId }
      : createAssistantSession({
        mode: 'chat',
        command: commandId,
        agentId: sessionAgentId,
        text: submittedText,
        now,
      });
    const saved = appendSessionMessages(base, turn, { now, command: commandId });
    if (!saved) return;
    saveAssistantSession(saved);
    setActiveSessionId(saved.id);
  };

  // Une action rapide (corriger, reformuler, résumer) entre aussi dans
  // l’historique : toutes les utilisations y figurent, classées par thème.
  const storeQuickAction = (submittedText, submittedMode, assistantText) => {
    const now = Date.now();
    const session = createAssistantSession({ mode: submittedMode, text: submittedText, now });
    const saved = appendSessionMessages(
      session,
      [
        { role: 'user', content: submittedText },
        { role: 'assistant', content: assistantText },
      ],
      { now }
    );
    if (saved) saveAssistantSession(saved);
  };

  const startNewConversation = () => {
    if (working) return;
    setSidebarTab('conversations');
    setMessages([]);
    setActiveSessionId('');
    setResultText('');
    setQuestion('');
    setPendingAction(null);
    setError('');
    setCommandsDismissed(false);
    setCommandIndex(0);
    questionInputRef.current?.focus();
  };

  const openAssistantSettings = () => {
    window.dispatchEvent(new Event('orbit:assistant-chat-close'));
    window.dispatchEvent(new Event('orbit:assistant-open-settings'));
  };

  const selectSession = (session) => {
    if (!session) return;
    setActiveSessionId(session.id);
    if (session.agentId) updateSettings({ assistantAgentId: session.agentId });
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setResultText('');
    setQuestion('');
    setPendingAction(null);
    setError('');
    questionInputRef.current?.focus();
  };

  const deleteHistorySession = (id) => {
    // Pendant une génération, le prochain échange réécrirait la session
    // supprimée : on laisse la réponse se terminer d’abord.
    if (working) return;
    deleteAssistantSession(id);
    if (id === activeSessionId) {
      setActiveSessionId('');
      setMessages([]);
    }
  };

  const clearHistory = () => {
    if (working) return;
    if (!window.confirm(t('assistant.history.clearConfirm'))) return;
    clearAssistantSessions();
    setActiveSessionId('');
    setMessages([]);
  };

  const deleteHistorySessions = (ids) => {
    if (working || !ids.length) return;
    const selected = new Set(ids);
    const count = ids.length;
    if (!window.confirm(t('assistant.history.deleteManyConfirm', { count }))) return;
    ids.forEach((id) => deleteAssistantSession(id));
    if (selected.has(activeSessionId)) {
      setActiveSessionId('');
      setMessages([]);
    }
  };

  const exportHistorySessions = (ids) => {
    const selected = assistantSessions.filter((session) => ids.includes(session.id));
    try {
      downloadAssistantMarkdown(selected, 'orbit-conversations.md');
    } catch (exportError) {
      console.error('[orbit] export des conversations échoué:', exportError);
      setError(t('assistant.history.exportError'));
    }
  };

  const exportHistorySession = (session) => exportHistorySessions([session.id]);
  const exportAllHistory = () => exportHistorySessions(assistantSessions.map((session) => session.id));

  const selectAgent = (nextAgentId) => {
    if (working || nextAgentId === agentId) return;
    updateSettings({ assistantAgentId: nextAgentId });
    setActiveSessionId('');
    setMessages([]);
    setQuestion('');
    setResultText('');
    setPendingAction(null);
    setError('');
    setCommandsDismissed(false);
    setCommandIndex(0);
  };

  const toggleAgentFavorite = (favoriteId) => {
    const next = agentFavorites.includes(favoriteId)
      ? agentFavorites.filter((id) => id !== favoriteId)
      : [...agentFavorites, favoriteId];
    updateSettings({ assistantAgentFavorites: next });
  };

  const exportCurrentConversation = () => {
    if (!messages.length) return;
    try {
      downloadAssistantMarkdown(
        [{ title: activeSession?.title || t('assistant.history.untitled'), messages }],
        'orbit-conversation.md'
      );
    } catch (exportError) {
      console.error('[orbit] export de la conversation active échoué:', exportError);
      setError(t('assistant.history.exportError'));
    }
  };

  const deleteCurrentConversation = () => {
    if (!activeSessionId || working) return;
    if (!window.confirm(t('assistant.history.deleteConfirm'))) return;
    deleteAssistantSession(activeSessionId);
    setActiveSessionId('');
    setMessages([]);
    setQuestion('');
    setError('');
  };

  const copyChatMessage = async (content) => {
    try {
      const copied = await api()?.copyText(content);
      if (!copied?.success) {
        issueError(copied?.error || 'generic');
        return false;
      }
      return true;
    } catch (copyError) {
      console.error('[orbit] copie du message de discussion échouée:', copyError);
      issueError('generic');
      return false;
    }
  };

  const deleteChatTurn = (messageIndex) => {
    if (working) return;
    const start = messages[messageIndex - 1]?.role === 'user' ? messageIndex - 1 : messageIndex;
    const nextMessages = messages.filter((_, index) => index < start || index > messageIndex);
    setMessages(nextMessages);
    if (activeSession) {
      saveAssistantSession({
        ...activeSession,
        messages: nextMessages,
      });
    }
  };

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

  const requestAssistant = async (submittedText, submittedMode, actionProposal = null, chatCommandId = '') => {
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
        chatCommandId: submittedMode === 'chat' ? chatCommandId : '',
        agentId: submittedMode === 'chat' && chatOnly ? agentId : '',
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
          storeChatTurn(submittedText, chatCommandId, assistantText);
          setPendingAction(actionProposal);
        } else {
          storeQuickAction(submittedText, submittedMode, assistantText);
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
        storeChatTurn(submittedText, chatCommandId, assistantText);
        setPendingAction(actionProposal);
      } else {
        storeQuickAction(submittedText, submittedMode, assistantText);
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

  const chooseCommand = (command) => {
    if (!command) return;
    setQuestion(`/${command.id} `);
    setCommandsDismissed(true);
    setCommandIndex(0);
    questionInputRef.current?.focus();
  };

  const sendChatMessage = async (event) => {
    event.preventDefault();
    const raw = question.trim();
    if (!raw) return;
    const { command, text: commandText } = parseAssistantCommand(raw, availableCommands);
    const submitted = command ? commandText : raw;
    if (!submitted) return;
    setQuestion('');
    setCommandsDismissed(false);
    setCommandIndex(0);
    await requestAssistant(
      submitted,
      'chat',
      proposeOrbitAction(submitted, apps),
      command?.id || ''
    );
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
  const SelectedCommandIcon = commandDraft.command
    ? COMMAND_ICONS[commandDraft.command.id] || Bot
    : null;
  const selectedCommandCategory = commandDraft.command
    ? { labelKey: commandDraft.command.category }
    : null;
  const welcomeCommands = activeAgent.commands.slice(0, 3);

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
        className={`flex w-full ${
          chatOnly
            ? 'h-[min(92vh,900px)] max-w-[min(94vw,1080px)] flex-row'
            : 'max-h-[min(90vh,900px)] max-w-3xl flex-col'
        } overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl`}
        role="dialog"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className={`relative flex items-start gap-3 border-b border-border px-5 py-4 ${
          chatOnly ? 'bg-gradient-to-r from-accent-primary/10 via-bg-elevated to-violet-500/10' : ''
        }`}>
          <div className="mt-0.5 rounded-xl bg-accent-primary/10 p-2 text-accent-primary">
            {chatOnly ? <span className="text-lg leading-5">{activeAgent.icon}</span> : <ModeIcon size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="orbit-assistant-title" className="font-semibold text-text-primary">
              {chatOnly ? t(activeAgent.nameKey) : t('proofreader.title')}
            </h2>
            {chatOnly && (
              <p className="mt-1 flex items-center gap-1 truncate text-xs text-text-muted">
                {activeSession?.title ? (
                  <>
                    <History size={11} className="shrink-0" />
                    <span className="truncate">{activeSession.title}</span>
                  </>
                ) : t(activeAgent.descriptionKey)}
              </p>
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
          {chatOnly && (
            <div className="flex shrink-0 items-center gap-2">
              {usesOrbitModel ? (
                <select
                  value={modelKey}
                  onChange={(event) => {
                    updateSettings({ assistantModel: event.target.value });
                    setResultText('');
                    setError('');
                  }}
                  disabled={busy}
                  className="max-w-44 rounded-full border border-border bg-bg-primary/60 px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-primary disabled:opacity-60"
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
                <button
                  type="button"
                  onClick={openAssistantSettings}
                  title={t('assistant.providers.active', {
                    provider: activeProvider?.label || providerId,
                  })}
                  className="max-w-48 truncate rounded-full border border-border bg-bg-primary/60 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-bg-hover"
                >
                  {providerModelId || activeProvider?.label || providerId}
                </button>
              )}
              {messages.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={exportCurrentConversation}
                    aria-label={t('assistant.history.export')}
                    title={t('assistant.history.export')}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                  >
                    <Download size={16} />
                  </button>
                  {activeSessionId && (
                    <button
                      type="button"
                      onClick={deleteCurrentConversation}
                      aria-label={t('assistant.history.delete')}
                      title={t('assistant.history.delete')}
                      className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
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

        <div className="flex min-h-0 min-w-0 flex-1">
          {chatOnly && (
            <AssistantWorkspaceSidebar
              sessions={assistantSessions}
              activeSessionId={activeSessionId}
              activeAgentId={agentId}
              activeTab={sidebarTab}
              expanded={sidebarExpanded}
              favorites={agentFavorites}
              onTabChange={setSidebarTab}
              onExpandedChange={setSidebarExpanded}
              onSelect={selectSession}
              onNew={startNewConversation}
              onSelectAgent={selectAgent}
              onToggleFavorite={toggleAgentFavorite}
              onRename={renameAssistantSession}
              onDelete={deleteHistorySession}
              onExport={exportHistorySession}
              onExportMany={exportHistorySessions}
              onExportAll={exportAllHistory}
              onDeleteMany={deleteHistorySessions}
              onClear={clearHistory}
              busy={busy}
            />
          )}
          <main className={`min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-5 ${
            chatOnly ? 'flex flex-col' : ''
          } ${
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
                <div className="mx-auto flex min-h-[300px] max-w-2xl flex-1 flex-col items-center justify-center py-8 text-center">
                  <div className="mb-5 rounded-2xl border border-accent-primary/20 bg-gradient-to-br from-accent-primary/15 to-violet-500/10 p-4 text-accent-primary shadow-lg shadow-accent-primary/5">
                    <Sparkles size={28} />
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-text-primary">
                    {t(activeAgent.nameKey)}
                  </h3>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-text-muted">
                    {t(activeAgent.descriptionKey)}
                  </p>
                  <div className="mt-6 grid w-full max-w-md gap-2">
                    {welcomeCommands.map((command) => {
                      const Icon = COMMAND_ICONS[command.id] || Bot;
                      return (
                        <button
                          key={command.id}
                          type="button"
                          onClick={() => {
                            setQuestion(`/${command.id} `);
                            setCommandsDismissed(true);
                            questionInputRef.current?.focus();
                          }}
                          className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated/80 px-4 py-3 text-left transition hover:border-accent-primary/40 hover:bg-accent-primary/5 hover:text-text-primary"
                        >
                          <Icon size={15} className="shrink-0 text-accent-primary" />
                          <span className="font-mono text-xs font-semibold text-accent-primary">
                            /{command.id}
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-text-secondary">
                            {t(command.descriptionKey)}
                          </span>
                        </button>
                      );
                    })}
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
              <div className={chatOnly ? 'mx-auto w-full max-w-5xl space-y-4' : 'space-y-3'}>
                {messages.map((message, index) => (
                  <article
                    key={`${message.role}-${index}`}
                    className={chatOnly
                      ? `group flex w-full gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`
                      : ''}
                  >
                    {chatOnly && message.role === 'assistant' && (
                      <div className="mt-1 shrink-0 rounded-lg bg-accent-primary/10 p-2 text-accent-primary">
                        <Sparkles size={16} />
                      </div>
                    )}
                    <div className={chatOnly ? 'flex min-w-0 max-w-[92%] flex-col items-start gap-1' : ''}>
                    <div className={`max-w-full rounded-2xl px-4 py-3 text-sm ${
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
                      {message.command && (
                        <span className="mb-1 inline-flex items-center rounded-full bg-black/10 px-2 py-0.5 font-mono text-[10px] font-medium opacity-75">
                          /{message.command}
                        </span>
                      )}
                      <Suspense fallback={<p className="whitespace-pre-wrap break-words leading-6">{message.content}</p>}>
                        <AssistantMarkdown content={message.content} />
                      </Suspense>
                    </div>
                    {chatOnly && message.role === 'assistant' && (
                      <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => copyChatMessage(message.content)}
                          aria-label={t('assistant.copy')}
                          title={t('assistant.copy')}
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              downloadAssistantMarkdown(
                                [{ title: t(activeAgent.nameKey), messages: [message] }],
                                'orbit-resultat.md'
                              );
                            } catch (exportError) {
                              console.error('[orbit] export du résultat IA échoué:', exportError);
                              setError(t('assistant.history.exportError'));
                            }
                          }}
                          aria-label={t('assistant.history.export')}
                          title={t('assistant.history.export')}
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteChatTurn(index)}
                          aria-label={t('assistant.history.deleteMessage')}
                          title={t('assistant.history.deleteMessage')}
                          disabled={busy}
                          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
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
        </div>

        <footer className={`border-t border-border p-4 ${
          chatOnly ? 'bg-bg-elevated/95 sm:px-8 sm:py-5' : ''
        }`}>
          {isChat ? (
            <div className={`relative mx-auto w-full ${chatOnly ? 'max-w-5xl' : ''}`}>
              {commandDraft.command && (
                <div
                  aria-live="polite"
                  className="mb-2 flex items-center gap-2 rounded-xl border border-accent-primary/25 bg-accent-primary/5 px-3 py-2"
                >
                  {SelectedCommandIcon && (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary/10 px-2 py-1 text-[11px] font-medium text-accent-primary">
                      <SelectedCommandIcon size={13} />
                      {selectedCommandCategory ? t(selectedCommandCategory.labelKey) : ''}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs font-semibold text-accent-primary">
                    /{commandDraft.command.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {t(commandDraft.command.descriptionKey)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(commandDraft.text);
                      setCommandsDismissed(false);
                      setCommandIndex(0);
                      questionInputRef.current?.focus();
                    }}
                    aria-label={t('assistant.commands.remove')}
                    title={t('assistant.commands.remove')}
                    className="shrink-0 rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {commandMenuOpen && (
                <div
                  id="orbit-assistant-command-menu"
                  role="listbox"
                  aria-label={t('assistant.commands.title')}
                  className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-bg-elevated p-2 shadow-2xl"
                >
                  {matchingCommands.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-text-muted">{t('assistant.commands.empty')}</p>
                  ) : commandGroups.map((group) => (
                    <div key={group.id} className="mb-1 last:mb-0">
                      <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        {t(group.labelKey)}
                      </p>
                      {group.commands.map((command) => {
                        const Icon = COMMAND_ICONS[command.id] || Bot;
                        const index = matchingCommands.indexOf(command);
                        const active = index === commandIndex;
                        return (
                          <button
                            key={command.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setCommandIndex(index)}
                            onClick={() => {
                              setQuestion(`/${command.id} `);
                              setCommandsDismissed(true);
                              setCommandIndex(0);
                              questionInputRef.current?.focus();
                            }}
                            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                              active ? 'bg-accent-primary/10 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                            }`}
                          >
                            <Icon size={16} className={`mt-0.5 shrink-0 ${active ? 'text-accent-primary' : 'text-text-muted'}`} />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-xs font-semibold text-accent-primary">
                                  /{command.id}
                                </span>
                                <span className="text-sm">{t(command.labelKey)}</span>
                              </span>
                              <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                                {t(command.descriptionKey)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  <p className="px-3 pb-1 pt-2 text-[10px] text-text-muted">
                    {t('assistant.commands.keyboardHint')}
                  </p>
                </div>
              )}
              <form onSubmit={sendChatMessage} className={`flex w-full items-end gap-2 ${
                chatOnly ? 'rounded-2xl border border-border bg-bg-primary/60 p-2 shadow-lg shadow-black/5 focus-within:border-accent-primary/50' : ''
              }`}>
                <textarea
                  ref={questionInputRef}
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    setCommandsDismissed(false);
                    setCommandIndex(0);
                  }}
                  maxLength={12000}
                  rows={chatOnly ? 3 : 2}
                  className={`input min-h-12 flex-1 resize-y ${
                    chatOnly ? 'border-0 bg-transparent shadow-none focus:border-0 focus:ring-0' : ''
                  }`}
                  placeholder={t(chatOnly ? 'assistant.chat.inputPlaceholder' : 'assistant.input.placeholder')}
                  aria-controls={commandMenuOpen ? 'orbit-assistant-command-menu' : undefined}
                  aria-expanded={commandMenuOpen}
                  aria-autocomplete="list"
                  onMouseDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (commandMenuOpen) {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        if (matchingCommands.length > 0) {
                          setCommandIndex((current) => (current + 1) % matchingCommands.length);
                        }
                        return;
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (matchingCommands.length > 0) {
                          setCommandIndex((current) => (
                            current - 1 + matchingCommands.length
                          ) % matchingCommands.length);
                        }
                        return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setCommandsDismissed(true);
                        return;
                      }
                      if ((event.key === 'Enter' || event.key === 'Tab') && matchingCommands.length > 0) {
                        event.preventDefault();
                        chooseCommand(matchingCommands[Math.min(commandIndex, matchingCommands.length - 1)]);
                        return;
                      }
                    }
                    if (chatOnly && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button type="submit" disabled={busy || !chatDraftText || !canRunAssistant} className={`btn btn-primary self-stretch ${
                  chatOnly ? 'rounded-xl px-4' : ''
                }`}>
                  {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
                  {!chatOnly && t('assistant.send')}
                </button>
              </form>
              {chatOnly && (
                <p className="mt-2 px-1 text-[11px] text-text-muted">
                  {commandDraft.command && !commandDraft.text
                    ? t('assistant.commands.needText')
                    : t('assistant.commands.hint')}
                </p>
              )}
            </div>
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
        </div>
      </section>
    </div>
  );
}
