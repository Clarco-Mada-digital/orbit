import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, CircleCheck, Copy, Download, LoaderCircle, ShieldCheck, SpellCheck, X } from 'lucide-react';
import { analyzeText, applyIssues } from '../lib/offlineProofreader';
import {
  languageToolIssuesForSource,
  mapLanguageToolMatches,
  mergeProofreadingIssues,
} from '../lib/languageTool';
import { resolveLang, translate, useT } from '../lib/i18n';
import { useStore } from '../stores/useStore';

const errorKeys = {
  'stale-selection': 'proofreader.error.stale-selection',
  'stale-page': 'proofreader.error.stale-page',
  'focus-failed': 'proofreader.error.focus-failed',
  'selection-capture-failed': 'proofreader.error.selection-capture-failed',
  'selection-too-long': 'proofreader.error.selection-too-long',
  'replace-failed': 'proofreader.error.replace-failed',
};
const grammarApi = () => window.electronAPI?.grammar;

export default function OfflineProofreader() {
  const t = useT();
  const setting = useStore((state) => state.settings?.language);
  const proofreaderEngine = useStore((state) => state.settings?.proofreaderEngine || 'local');
  const updateSettings = useStore((state) => state.updateSettings);
  const [request, setRequest] = useState(null);
  const [language, setLanguage] = useState(() => resolveLang(setting));
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [enhancedIssues, setEnhancedIssues] = useState(null);
  const [grammarState, setGrammarState] = useState(null);
  const [grammarProgress, setGrammarProgress] = useState(null);
  const [installingGrammar, setInstallingGrammar] = useState(false);
  const [checkingGrammar, setCheckingGrammar] = useState(false);
  const [copiedJavaCommand, setCopiedJavaCommand] = useState(false);
  const selectionEdited = useRef(false);
  const text = request?.text || '';
  const localIssues = useMemo(() => analyzeText(text, language), [text, language]);
  const currentEnhancedIssues = languageToolIssuesForSource(enhancedIssues, text, language);
  const issues = useMemo(
    () => proofreaderEngine === 'languagetool' && grammarState?.installed && currentEnhancedIssues
      ? mergeProofreadingIssues(localIssues, currentEnhancedIssues)
      : localIssues,
    [currentEnhancedIssues, grammarState?.installed, localIssues, proofreaderEngine]
  );
  const correctedText = useMemo(
    () => applyIssues(text, issues, selected),
    [text, issues, selected]
  );
  const closeRequest = useCallback(() => {
    if (!request || applying) return;
    setRequest(null);
    window.electronAPI?.contextMenu?.run?.(
      request.wcId,
      'proofread:cancel',
      request.bookmarkToken
    ).catch((err) => {
      console.error('[orbit] nettoyage de la sélection de relecture échoué:', err);
    });
  }, [applying, request]);

  useEffect(() => {
    const off = window.electronAPI?.contextMenu?.onProofread?.((payload) => {
      const nextLanguage = resolveLang(setting);
      const nextText = payload?.text || '';
      setRequest(payload);
      const initialIssues = analyzeText(nextText, nextLanguage);
      setEnhancedIssues(null);
      setSelected(new Set(initialIssues.map((issue) => issue.id)));
      selectionEdited.current = false;
      setCheckingGrammar(false);
      setGrammarProgress(null);
      setError(
        payload?.error
          ? translate(resolveLang(setting), errorKeys[payload.error] || 'proofreader.error.generic')
          : ''
      );
      setLanguage(nextLanguage);
      setApplying(false);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [setting]);

  useEffect(() => {
    if (!request) return undefined;
    let active = true;
    const offProgress = grammarApi()?.onProgress?.(setGrammarProgress);
    Promise.resolve(grammarApi()?.state())
      .then((state) => {
        if (active && state?.success) setGrammarState(state);
      })
      .catch((err) => {
        if (!active) return;
        console.error('[orbit] état de LanguageTool indisponible:', err);
      });
    return () => {
      active = false;
      if (typeof offProgress === 'function') offProgress();
    };
  }, [request]);

  useEffect(() => {
    if (!request) return undefined;
    let active = true;
    if (proofreaderEngine !== 'languagetool' || !grammarState?.installed) {
      return undefined;
    }

    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setCheckingGrammar(true);
        return grammarApi()?.check(text, language);
      })
      .then((result) => {
        if (!active || !result) return;
        if (!result?.success) {
          console.error('[orbit] vérification LanguageTool indisponible:', result?.error || 'unknown error');
          setError(translate(language, 'proofreader.enhancedUnavailable'));
          return;
        }
        const nextEnhancedIssues = mapLanguageToolMatches(text, result.matches, language);
        const combinedIssues = mergeProofreadingIssues(localIssues, nextEnhancedIssues);
        setEnhancedIssues({ text, language, issues: nextEnhancedIssues });
        setSelected((current) => {
          if (!selectionEdited.current) return new Set(combinedIssues.map((issue) => issue.id));
          const selectedLocal = localIssues.filter((issue) => current.has(issue.id));
          const next = new Set(
            [...current].filter((id) => combinedIssues.some((issue) => issue.id === id))
          );
          for (const issue of nextEnhancedIssues) {
            if (selectedLocal.some((local) => local.start < issue.end && issue.start < local.end)) {
              next.add(issue.id);
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!active) return;
        console.error('[orbit] vérification LanguageTool échouée:', err);
        setError(translate(language, 'proofreader.enhancedUnavailable'));
      })
      .finally(() => {
        if (active) {
          setCheckingGrammar(false);
          setGrammarProgress(null);
        }
      });

    return () => {
      active = false;
    };
  }, [grammarState?.installed, language, localIssues, proofreaderEngine, request, text]);

  useEffect(() => {
    if (!request) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeRequest();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, closeRequest]);

  if (!request) return null;

  const toggleIssue = (id) => {
    selectionEdited.current = true;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllIssues = () => {
    selectionEdited.current = true;
    setSelected(
      selected.size === issues.length
        ? new Set()
        : new Set(issues.map((issue) => issue.id))
    );
  };

  const applySelected = async () => {
    if (selected.size === 0) {
      setError(t('proofreader.nothingSelected'));
      return;
    }
    setApplying(true);
    setError('');
    try {
      const result = await window.electronAPI?.contextMenu?.run?.(request.wcId, 'proofread:replace', {
        expected: text,
        replacement: correctedText,
      });
      if (!result?.success) {
        setError(t(errorKeys[result?.error] || 'proofreader.error.generic'));
        return;
      }
      setRequest(null);
    } catch (err) {
      console.error('[orbit] application des corrections locales échouée:', err);
      setError(t('proofreader.error.generic'));
    } finally {
      setApplying(false);
    }
  };

  const installGrammar = async () => {
    setInstallingGrammar(true);
    setError('');
    setGrammarProgress(null);
    try {
      const result = await grammarApi()?.install();
      if (!result?.success) {
        const messageKey = result?.error === 'java-missing'
          ? 'proofreader.javaMissing'
          : result?.error === 'java-version'
            ? 'proofreader.javaVersion'
            : 'proofreader.installFailed';
        setError(t(messageKey));
        return;
      }
      const state = await grammarApi()?.state();
      if (!state?.success) {
        setError(t('proofreader.installFailed'));
        return;
      }
      setGrammarState(state);
      updateSettings({ proofreaderEngine: 'languagetool' });
    } catch (err) {
      console.error('[orbit] installation de LanguageTool échouée:', err);
      setError(t('proofreader.installFailed'));
    } finally {
      setInstallingGrammar(false);
      setGrammarProgress(null);
    }
  };

  const removeGrammar = async () => {
    setInstallingGrammar(true);
    setError('');
    try {
      const result = await grammarApi()?.remove();
      if (!result?.success) {
        console.error('[orbit] suppression de LanguageTool impossible:', result?.error || 'unknown error');
        setError(t('proofreader.installFailed'));
        return;
      }
      const state = await grammarApi()?.state();
      setGrammarState(state?.success ? state : { installed: false, javaAvailable: false });
      updateSettings({ proofreaderEngine: 'local' });
    } catch (err) {
      console.error('[orbit] suppression de LanguageTool échouée:', err);
      setError(t('proofreader.installFailed'));
    } finally {
      setInstallingGrammar(false);
    }
  };

  const refreshJavaState = async () => {
    try {
      const state = await grammarApi()?.state({ refreshJava: true });
      if (!state?.success) throw new Error('grammar-state-unavailable');
      setGrammarState(state);
      setError('');
    } catch (err) {
      console.error('[orbit] vérification de Java échouée:', err);
      setError(t('proofreader.engineCheckFailed'));
    }
  };

  const copyJavaCommand = async () => {
    try {
      await navigator.clipboard.writeText(grammarState.javaInstallCommand);
      setCopiedJavaCommand(true);
      window.setTimeout(() => setCopiedJavaCommand(false), 1800);
    } catch (err) {
      console.error('[orbit] copie de la commande Java échouée:', err);
      setError(t('proofreader.copyCommandFailed'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRequest();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="orbit-proofreader-title"
        aria-modal="true"
        className="flex max-h-[min(88vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
        role="dialog"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-indigo-500 text-white shadow-lg shadow-accent/20">
            <SpellCheck size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="orbit-proofreader-title" className="font-semibold tracking-tight text-text-primary">
              {t('proofreader.title')}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('proofreader.description')}</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-500 sm:inline-flex">
              <ShieldCheck size={12} />
              {t('proofreader.local')}
          </span>
          <button
            type="button"
            onClick={closeRequest}
            disabled={applying}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
            aria-label={t('proofreader.cancel')}
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                issues.length ? 'bg-accent/10 text-accent' : 'bg-emerald-500/10 text-emerald-500'
              }`}>
                {issues.length ? <SpellCheck size={17} /> : <CircleCheck size={18} />}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {issues.length
                    ? t(issues.length === 1 ? 'proofreader.issueCount.one' : 'proofreader.issueCount.many', { count: issues.length })
                    : error
                      ? t('proofreader.unavailable')
                      : t('proofreader.clean')}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {proofreaderEngine === 'languagetool' && grammarState?.installed
                    ? error
                      ? t('proofreader.enhancedFallback')
                      : t('proofreader.enhancedActive')
                    : t('proofreader.local')}
                  {checkingGrammar && ` · ${t(grammarProgress?.phase === 'starting'
                    ? 'proofreader.starting'
                    : 'proofreader.checking')}`}
                  {issues.length > 0 && ` · ${t('proofreader.selectedCount', { count: selected.size })}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {issues.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllIssues}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  <CheckCheck size={14} />
                  {t(selected.size === issues.length ? 'proofreader.selectNone' : 'proofreader.selectAll')}
                </button>
              )}
              <label className="sr-only" htmlFor="orbit-proofreader-language">{t('proofreader.language')}</label>
              <select
                id="orbit-proofreader-language"
                value={language}
                onChange={(event) => {
                  const nextLanguage = event.target.value;
                  selectionEdited.current = false;
                  setLanguage(nextLanguage);
                  setEnhancedIssues(null);
                  setError('');
                  setCheckingGrammar(false);
                  const nextIssues = analyzeText(text, nextLanguage);
                  setSelected(new Set(nextIssues.map((issue) => issue.id)));
                }}
                onMouseDown={(event) => event.stopPropagation()}
                className="rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                <option value="fr">{t('proofreader.french')}</option>
                <option value="en">{t('proofreader.english')}</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-primary/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary">{t('proofreader.enhancedTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('proofreader.enhancedDescription')}</p>
              </div>
              {grammarState?.installed ? (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-text-secondary">
                    <input
                      type="checkbox"
                      checked={proofreaderEngine === 'languagetool'}
                      onChange={(event) => {
                        selectionEdited.current = false;
                        setEnhancedIssues(null);
                        setError('');
                        setCheckingGrammar(false);
                        updateSettings({ proofreaderEngine: event.target.checked ? 'languagetool' : 'local' });
                      }}
                      className="accent-accent-primary"
                    />
                    {t('proofreader.enhancedToggle')}
                  </label>
                  <button
                    type="button"
                    onClick={removeGrammar}
                    disabled={installingGrammar || checkingGrammar}
                    className="text-xs text-text-muted underline-offset-2 hover:text-error hover:underline disabled:opacity-50"
                  >
                    {t('proofreader.remove')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={installGrammar}
                  disabled={installingGrammar || !grammarState?.javaAvailable}
                  className="btn btn-primary btn-sm"
                >
                  {installingGrammar || !grammarState
                    ? <LoaderCircle size={14} className="animate-spin" />
                    : <Download size={14} />}
                  {installingGrammar
                    ? t('proofreader.installing')
                    : !grammarState
                      ? t('proofreader.engineChecking')
                      : t('proofreader.install')}
                </button>
              )}
            </div>
            {!grammarState?.installed && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-text-muted">
                  {!grammarState
                    ? t('proofreader.engineChecking')
                    : grammarState.javaAvailable
                      ? t('proofreader.downloadInfo')
                      : grammarState.javaVersion
                        ? t('proofreader.javaVersion')
                        : t('proofreader.javaMissing')}
                </p>
                {grammarState?.javaInstallCommand && !grammarState.javaAvailable && (
                  <div className="rounded-lg border border-border bg-bg-primary/50 p-3">
                    <p className="mb-2 text-xs font-medium text-text-secondary">
                      {t('proofreader.javaInstallFor', { platform: grammarState.javaInstallLabel })}
                    </p>
                    <code className="block overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/10 p-2 text-xs text-text-primary">
                      {grammarState.javaInstallCommand}
                    </code>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={copyJavaCommand} className="btn btn-secondary btn-sm">
                        <Copy size={13} />
                        {t(copiedJavaCommand ? 'proofreader.commandCopied' : 'proofreader.copyCommand')}
                      </button>
                      <button type="button" onClick={refreshJavaState} className="btn btn-ghost btn-sm">
                        {t('proofreader.recheckJava')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {installingGrammar && grammarProgress && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-text-muted">
                  {grammarProgress.phase === 'extract'
                    ? t('proofreader.extracting')
                    : `${t('proofreader.downloading')} ${
                      grammarProgress.total
                        ? `${Math.round((grammarProgress.received / grammarProgress.total) * 100)}%`
                        : ''
                    }`}
                </p>
                {grammarProgress.phase === 'download' && grammarProgress.total > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                    <div
                      className="h-full bg-accent-primary transition-all"
                      style={{ width: `${Math.min(100, (grammarProgress.received / grammarProgress.total) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}
          {issues.length ? (
            <div className="space-y-2.5">
              {issues.map((issue) => {
                const checked = selected.has(issue.id);
                return (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => toggleIssue(issue.id)}
                    className={`group flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      checked
                        ? 'border-accent/40 bg-accent/5 shadow-sm'
                        : 'border-border bg-bg-primary/30 opacity-70 hover:opacity-100'
                    }`}
                    aria-pressed={checked}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
                        checked ? 'border-accent bg-accent text-white' : 'border-border bg-bg-elevated text-transparent'
                      }`}
                    >
                      {checked && <Check size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="rounded-md bg-red-500/10 px-2 py-1 font-medium text-red-400 line-through decoration-red-400/70">
                          {issue.original || '∅'}
                        </span>
                        <ArrowRight size={14} className="text-text-muted" />
                        <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-400">
                          {issue.replacement || '∅'}
                        </span>
                      </span>
                      <span className="mt-2 block text-xs leading-relaxed text-text-muted">{issue.message}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            !error && (
              <div className="flex flex-col items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-8 text-center">
                <CircleCheck size={30} className="mb-3 text-emerald-500" />
                <p className="text-sm font-semibold text-text-primary">{t('proofreader.noIssues')}</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-text-muted">{t('proofreader.cleanHint')}</p>
              </div>
            )
          )}
          {issues.length > 0 && selected.size > 0 && correctedText !== text && (
            <div className="rounded-xl border border-border bg-bg-primary/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t('proofreader.preview')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg border border-border bg-bg-elevated/70 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('proofreader.before')}
                  </p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">
                    {text}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-500">
                    {t('proofreader.after')}
                  </p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">
                    {correctedText}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-bg-primary/20 px-5 py-4">
          <p className="hidden text-xs text-text-muted sm:block">
            {t('proofreader.selectedCount', { count: selected.size })}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={closeRequest}
              disabled={applying}
              className="rounded-lg px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {t('proofreader.cancel')}
            </button>
            {issues.length > 0 && (
              <button
                type="button"
                onClick={applySelected}
                disabled={applying || checkingGrammar || selected.size === 0 || correctedText === text}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-md shadow-accent/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applying ? t('proofreader.applying') : t('proofreader.apply')}
                {!applying && <ArrowRight size={15} />}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
