import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useDownloadsStore } from '../lib/downloadsStore';
import { parseDownloadUrl } from '../lib/downloadOptions';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

const FILTERS = ['all', 'active', 'completed', 'interrupted'];

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function humanTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const value = Math.round(seconds);
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function isActive(state) {
  return state === 'progressing' || state === 'paused' || state === 'selecting';
}

export default function DownloadsPage({ onClose }) {
  const t = useT();
  const downloads = useDownloadsStore((state) => state.downloads);
  const remove = useDownloadsStore((state) => state.remove);
  const clearFinished = useDownloadsStore((state) => state.clearFinished);
  const settings = useStore((state) => state.settings);
  const updateSettings = useStore((state) => state.updateSettings);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const activeCount = downloads.filter((item) => isActive(item.state)).length;
  const completedCount = downloads.filter((item) => item.state === 'completed').length;
  const interruptedCount = downloads.filter((item) => item.state === 'interrupted' || item.state === 'cancelled').length;
  const visibleDownloads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return downloads
      .filter((item) => {
        if (filter === 'active' && !isActive(item.state)) return false;
        if (filter === 'completed' && item.state !== 'completed') return false;
        if (filter === 'interrupted' && item.state !== 'interrupted' && item.state !== 'cancelled') return false;
        return !needle || `${item.filename} ${item.url}`.toLocaleLowerCase().includes(needle);
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [downloads, filter, query]);

  const start = async (mode = 'file') => {
    setMessage('');
    const parsed = parseDownloadUrl(url);
    if (!parsed.success) {
      setMessage(t(`dl.error.${parsed.reason}`));
      return;
    }
    setBusy(mode);
    try {
      let result;
      if (parsed.type === 'torrent') {
        result = await window.electronAPI?.openTorrentLink?.(parsed.url);
        if (result?.success) {
          setMessage(t('dl.torrentExternal'));
          setUrl('');
          return;
        }
      } else if (mode === 'video' || mode === 'audio') {
        result = await window.electronAPI?.downloadMedia?.(parsed.url, mode);
      } else {
        result = await window.electronAPI?.startDownloadUrl?.(parsed.url);
      }
      if (result?.success) {
        setUrl('');
      } else {
        setMessage(result?.error === 'destination-dialog-open'
          ? t('dl.error.destination-dialog-open')
          : result?.error || t('dl.startFailed'));
      }
    } catch (error) {
      console.error('[orbit] démarrage du téléchargement échoué:', error);
      setMessage(String(error.message || error));
    } finally {
      setBusy('');
    }
  };

  const clearHistory = async () => {
    try {
      const result = await window.electronAPI?.clearDownloadHistory?.();
      if (result?.success === false) throw new Error(result.error || 'history-clear-failed');
      clearFinished();
    } catch (error) {
      console.error('[orbit] suppression de l’historique des téléchargements échouée:', error);
      setMessage(String(error.message || error));
    }
  };

  const removeDownload = async (id) => {
    try {
      const result = await window.electronAPI?.removeDownload?.(id);
      if (result?.success === false) throw new Error(result.error || 'download-remove-failed');
      remove(id);
    } catch (error) {
      console.error('[orbit] retrait du téléchargement échoué:', error);
      setMessage(String(error.message || error));
    }
  };

  const controlDownload = async (action, id) => {
    try {
      const result = await window.electronAPI?.[action]?.(id);
      if (result?.success === false) throw new Error(result.error || 'download-action-failed');
    } catch (error) {
      console.error(`[orbit] action ${action} échouée:`, error);
      setMessage(String(error.message || error));
    }
  };

  const retry = async (item) => {
    if (item.kind === 'media' && item.mode) {
      const result = await window.electronAPI?.downloadMedia?.(item.url, item.mode);
      if (!result?.success) setMessage(result?.error || t('dl.startFailed'));
      return;
    }
    setUrl(item.url);
    const parsed = parseDownloadUrl(item.url);
    if (parsed.success && parsed.type === 'file') {
      const result = await window.electronAPI?.startDownloadUrl?.(parsed.url);
      if (!result?.success) setMessage(result?.error || t('dl.startFailed'));
      setUrl('');
    }
  };

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="downloads-page-title"
        className="flex h-[min(92vh,58rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-primary/40 px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-accent-primary/10 p-2.5 text-accent-primary"><Download size={21} /></span>
            <div className="min-w-0">
              <h1 id="downloads-page-title" className="text-lg font-semibold">{t('dl.title')}</h1>
              <p className="text-xs text-text-muted">{t('dl.subtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label={t('common.close')} title={t('common.close')}>
            <X size={20} />
          </button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-7">
          <section className="rounded-2xl border border-border bg-bg-primary/35 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ArrowDownToLine size={16} className="text-accent-primary" />
              {t('dl.addTitle')}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                start('file');
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <div className="relative min-w-0 flex-1">
                <ExternalLink size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={t('dl.urlPlaceholder')}
                  aria-label={t('dl.urlPlaceholder')}
                  className="input w-full pl-9"
                />
              </div>
              <button type="submit" disabled={!url.trim() || Boolean(busy)} className="btn btn-primary justify-center">
                <Download size={15} /> {t('dl.addFile')}
              </button>
            </form>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => start('video')} disabled={!url.trim() || Boolean(busy)} className="btn btn-secondary btn-sm">
                {busy === 'video' ? t('dl.starting') : t('dl.downloadVideo')}
              </button>
              <button type="button" onClick={() => start('audio')} disabled={!url.trim() || Boolean(busy)} className="btn btn-secondary btn-sm">
                {busy === 'audio' ? t('dl.starting') : t('dl.downloadAudio')}
              </button>
              <span className="text-xs text-text-muted">{t('dl.addHint')}</span>
            </div>
            {message && <p role="alert" className="mt-3 rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-sm text-error">{message}</p>}
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: t('dl.statActive'), value: activeCount, icon: RefreshCw, tint: 'text-accent-primary' },
              { label: t('dl.statCompleted'), value: completedCount, icon: CheckCircle2, tint: 'text-emerald-500' },
              { label: t('dl.statInterrupted'), value: interruptedCount, icon: AlertCircle, tint: 'text-amber-500' },
            ].map(({ label, value, icon: Icon, tint }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-border bg-bg-primary/30 px-4 py-3">
                <Icon size={18} className={tint} />
                <div><div className="text-xl font-semibold">{value}</div><div className="text-xs text-text-muted">{label}</div></div>
              </div>
            ))}
          </section>

          <section className="min-h-64 flex-1 overflow-hidden rounded-2xl border border-border bg-bg-primary/25">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-1">
                {FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      filter === key ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    {t(`dl.filter.${key}`)}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2.5">
                <Search size={14} className="shrink-0 text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('dl.search')}
                  aria-label={t('dl.search')}
                  className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-text-muted"
                />
              </div>
              <button
                type="button"
                onClick={clearHistory}
                disabled={!downloads.some((item) => !isActive(item.state))}
                className="btn btn-ghost btn-sm shrink-0"
              >
                <Trash2 size={14} /> {t('dl.clearHistory')}
              </button>
            </div>

            <div className="max-h-full divide-y divide-border/70 overflow-y-auto">
              {visibleDownloads.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                  <span className="mb-3 rounded-2xl bg-bg-hover p-4 text-text-muted"><File size={24} /></span>
                  <p className="font-medium">{t('dl.emptyTitle')}</p>
                  <p className="mt-1 max-w-sm text-sm text-text-muted">{t('dl.emptyHint')}</p>
                </div>
              ) : visibleDownloads.map((item) => {
                const percent = item.totalBytes > 0
                  ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
                  : null;
                const active = isActive(item.state);
                const failed = item.state === 'cancelled' || item.state === 'interrupted';
                const Icon = item.state === 'completed' ? CheckCircle2 : failed ? AlertCircle : item.state === 'paused' ? Pause : File;
                return (
                  <article key={item.id} className="px-4 py-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 rounded-xl bg-bg-hover p-2 ${item.state === 'completed' ? 'text-emerald-500' : failed ? 'text-error' : 'text-accent-primary'}`}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="max-w-full truncate text-sm font-medium" title={item.filename}>{item.filename}</span>
                          {item.kind === 'media' && <span className="rounded-full bg-accent-primary/10 px-2 py-0.5 text-[10px] font-medium text-accent-primary">{t(item.mode === 'audio' ? 'dl.audioTag' : 'dl.videoTag')}</span>}
                          <span className="text-[11px] text-text-muted">{t(`dl.state.${item.state}`)}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-text-muted" title={item.url}>{item.url}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                          <span>{humanSize(item.receivedBytes)}{item.totalBytes > 0 ? ` / ${humanSize(item.totalBytes)}` : ''}</span>
                          {percent !== null && <span>{percent}%</span>}
                          {item.speedBytesPerSecond > 0 && <span className="inline-flex items-center gap-1"><Gauge size={12} />{humanSize(item.speedBytesPerSecond)}/s</span>}
                          {active && item.etaSeconds > 0 && <span className="inline-flex items-center gap-1"><Clock3 size={12} />{humanTime(item.etaSeconds)}</span>}
                          {item.updatedAt && <span>{new Date(item.updatedAt).toLocaleString()}</span>}
                        </div>
                        {item.error && <p className="mt-2 break-words text-xs text-error">{item.error}</p>}
                        {active && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-hover">
                            <div className="h-full rounded-full bg-accent-primary transition-[width] duration-300" style={{ width: percent === null ? '35%' : `${percent}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.state === 'completed' && item.savePath && (
                          <>
                            <button type="button" onClick={() => controlDownload('openDownload', item.id)} className="btn-icon h-8 w-8" title={t('dl.openFile')} aria-label={t('dl.openFile')}><Play size={15} /></button>
                            <button type="button" onClick={() => controlDownload('revealDownload', item.id)} className="btn-icon h-8 w-8" title={t('dl.showInFolder')} aria-label={t('dl.showInFolder')}><FolderOpen size={15} /></button>
                          </>
                        )}
                        {item.state === 'progressing' && item.canPause && (
                          <button type="button" onClick={() => controlDownload('pauseDownload', item.id)} className="btn-icon h-8 w-8" title={t('dl.pause')} aria-label={t('dl.pause')}><Pause size={15} /></button>
                        )}
                        {item.state === 'paused' && (
                          <button type="button" onClick={() => controlDownload('resumeDownload', item.id)} className="btn-icon h-8 w-8" title={t('dl.resume')} aria-label={t('dl.resume')}><Play size={15} /></button>
                        )}
                        {active && (
                          <button type="button" onClick={() => controlDownload('cancelDownload', item.id)} className="btn-icon h-8 w-8 text-error" title={t('common.cancel')} aria-label={t('common.cancel')}><X size={15} /></button>
                        )}
                        {failed && (
                          <button type="button" onClick={() => retry(item)} className="btn-icon h-8 w-8" title={t('dl.retry')} aria-label={t('dl.retry')}><RefreshCw size={15} /></button>
                        )}
                        {!active && (
                          <button type="button" onClick={() => removeDownload(item.id)} className="btn-icon h-8 w-8 text-text-muted" title={t('dl.removeFromList')} aria-label={t('dl.removeFromList')}><X size={15} /></button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <details className="rounded-xl border border-border bg-bg-primary/25">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
              <Settings2 size={16} className="text-text-muted" /> {t('dl.preferences')}
            </summary>
            <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">{t('dl.videoQuality')}</span>
                <select
                  value={settings.downloadVideoQuality || 'best'}
                  onChange={(event) => updateSettings({ downloadVideoQuality: event.target.value })}
                  className="input w-full"
                >
                  {['best', '1080p', '720p', '480p'].map((value) => <option key={value} value={value}>{t(`dl.quality.${value}`)}</option>)}
                </select>
                <span className="block text-xs text-text-muted">{t('dl.videoQualityHint')}</span>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">{t('dl.audioFormat')}</span>
                <select
                  value={settings.downloadAudioFormat || 'm4a'}
                  onChange={(event) => updateSettings({ downloadAudioFormat: event.target.value })}
                  className="input w-full"
                >
                  <option value="m4a">{t('dl.audio.m4a')}</option>
                  <option value="mp3">{t('dl.audio.mp3')}</option>
                </select>
                <span className="block text-xs text-text-muted">{t('dl.audioHint')}</span>
              </label>
            </div>
          </details>
        </main>
      </section>
    </div>
  );
}
