import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, Clock3, Download, ExternalLink, FolderOpen, X } from 'lucide-react';
import { DOWNLOAD_CATEGORIES, downloadCategory } from '../lib/downloadCategories';
import { parseDownloadUrl } from '../lib/downloadOptions';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// « Nouveau téléchargement » : tout ce que le gestionnaire a le droit de
// décider avant d'ouvrir une seule connexion.
//
// Le champ d'adresse du panneau Téléchargements reste le chemin rapide (il
// démarre avec les réglages généraux) ; ce dialogue est là quand on veut
// choisir : nom du fichier, dossier, catégorie, description, nombre de
// connexions pour CE fichier, plafond de débit pour CE fichier, priorité dans
// la file, et démarrer maintenant ou plus tard.
//
// Rien n'est inventé côté page : les replis (dossier par défaut, nom déduit de
// l'adresse) sont calculés dans le processus principal, qui connaît les
// réglages et le dossier système des téléchargements.
// ---------------------------------------------------------------------------

const PRIORITIES = [
  { value: 1, key: 'high' },
  { value: 0, key: 'normal' },
  { value: -1, key: 'low' },
];

function fileNameFromUrl(value) {
  try {
    const url = new URL(value);
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

export default function DownloadOptionsDialog({ initialUrl = '', onClose, onStarted }) {
  const t = useT();
  const settings = useStore((state) => state.settings);
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState(fileNameFromUrl(initialUrl));
  const [directory, setDirectory] = useState('');
  const [baseDir, setBaseDir] = useState('');
  const [category, setCategory] = useState(downloadCategory(fileNameFromUrl(initialUrl)));
  const [description, setDescription] = useState('');
  const [connections, setConnections] = useState(String(settings.downloadConnections ?? 8));
  const [rate, setRate] = useState(String(settings.downloadFileSpeedLimit ?? 0));
  const [priority, setPriority] = useState('0');
  const [folderTouched, setFolderTouched] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  // Dossier et nom proposés une fois, d'après les réglages du processus
  // principal (dossier choisi, classement par type, dossier système).
  useEffect(() => {
    let cancelled = false;
    const nameGuess = fileNameFromUrl(initialUrl);
    window.electronAPI
      ?.downloadDefaultTarget?.(nameGuess)
      .then((result) => {
        if (cancelled || !result) return;
        if (result.baseDir) setBaseDir(result.baseDir);
        if (result.directory) setDirectory(result.directory);
        if (!nameGuess && result.filename) setName(result.filename);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changer de catégorie range le fichier dans le sous-dossier correspondant,
  // comme le fait le classement automatique — sauf si un dossier a été choisi
  // à la main.
  const chooseCategory = (value) => {
    setCategory(value);
    if (folderTouched || !baseDir) return;
    setDirectory(`${baseDir}${baseDir.endsWith('/') || baseDir.endsWith('\\') ? '' : '/'}${DOWNLOAD_CATEGORIES[value]}`);
  };

  const browse = async () => {
    const result = await window.electronAPI?.pickDownloadFolder?.();
    if (result?.success && result.path) {
      setDirectory(result.path);
      setFolderTouched(true);
    }
  };

  const extension = useMemo(() => {
    const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
    return match ? match[1].toUpperCase() : '';
  }, [name]);

  const submit = async (deferred) => {
    setMessage('');
    const parsed = parseDownloadUrl(url);
    if (!parsed.success) {
      setMessage(t(`dl.error.${parsed.reason}`));
      return;
    }
    if (parsed.type !== 'file') {
      setMessage(t('dl.error.notFile'));
      return;
    }
    setBusy(deferred ? 'later' : 'now');
    try {
      const result = await window.electronAPI?.startDownloadUrl?.(parsed.url, {
        name: name.trim(),
        directory,
        description: description.trim(),
        connections: Number(connections),
        rateBytesPerSecond: Math.max(0, Number(rate) || 0) * 1024,
        priority: Number(priority),
        deferred,
      });
      if (!result?.success) {
        setMessage(result?.error || t('dl.startFailed'));
        return;
      }
      onStarted?.(deferred);
      onClose?.();
    } catch (error) {
      console.error('[orbit] nouveau téléchargement échoué:', error);
      setMessage(String(error.message || error));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-download-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-accent-primary/10 p-2.5 text-accent-primary"><ArrowDownToLine size={19} /></span>
            <div className="min-w-0">
              <h2 id="new-download-title" className="text-base font-semibold">{t('dl.newTitle')}</h2>
              <p className="text-xs text-text-muted">{t('dl.newSubtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label={t('common.close')} title={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">{t('dl.url')}</span>
            <div className="relative">
              <ExternalLink size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                autoFocus
                type="text"
                inputMode="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  const guess = fileNameFromUrl(event.target.value);
                  if (guess) {
                    setName((current) => (current === fileNameFromUrl(url) || !current ? guess : current));
                    if (!folderTouched) setCategory(downloadCategory(guess));
                  }
                }}
                placeholder={t('dl.urlPlaceholder')}
                className="input w-full pl-9"
              />
            </div>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="block font-medium">{t('dl.fileName')}</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('dl.fileNamePlaceholder')}
                className="input w-full"
              />
              {extension && <span className="block text-xs text-text-muted">{t('dl.fileType', { ext: extension })}</span>}
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="block font-medium">{t('dl.category')}</span>
              <select value={category} onChange={(event) => chooseCategory(event.target.value)} className="input w-full">
                {Object.entries(DOWNLOAD_CATEGORIES).map(([key, folder]) => (
                  <option key={key} value={key}>{t(`dl.cat.${key}`)} — {folder}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="block space-y-1.5 text-sm">
            <span className="block font-medium">{t('dl.destination')}</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={directory}
                onChange={(event) => {
                  setDirectory(event.target.value);
                  setFolderTouched(true);
                }}
                placeholder={t('dl.destinationPlaceholder')}
                className="input min-w-0 flex-1"
              />
              <button type="button" onClick={browse} className="btn btn-secondary shrink-0" title={t('dl.browse')}>
                <FolderOpen size={15} /> {t('dl.browse')}
              </button>
            </div>
            <span className="block text-xs text-text-muted">{t('dl.destinationHint')}</span>
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">{t('dl.description')}</span>
            <input
              type="text"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('dl.descriptionPlaceholder')}
              className="input w-full"
            />
            <span className="block text-xs text-text-muted">{t('dl.descriptionHint')}</span>
          </label>

          <fieldset className="space-y-3 rounded-xl border border-border bg-bg-primary/30 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t('dl.perDownload')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm">
                <span className="block font-medium">{t('dl.connections')}</span>
                <select value={connections} onChange={(event) => setConnections(event.target.value)} className="input w-full">
                  {[1, 2, 4, 6, 8, 12, 16].map((value) => (
                    <option key={value} value={value}>{value === 1 ? t('dl.connectionsOneShort') : value}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="block font-medium">{t('dl.perFileLimitShort')}</span>
                <input
                  type="number"
                  min="0"
                  step="64"
                  inputMode="numeric"
                  value={rate}
                  onChange={(event) => setRate(String(Math.max(0, Number(event.target.value) || 0)))}
                  className="input w-full"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="block font-medium">{t('dl.priority')}</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value)} className="input w-full">
                  {PRIORITIES.map((item) => (
                    <option key={item.key} value={item.value}>{t(`dl.priority.${item.key}`)}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-text-muted">{t('dl.perDownloadHint')}</p>
          </fieldset>

          {message && <p role="alert" className="rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-sm text-error">{message}</p>}
        </form>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="btn btn-ghost">{t('common.cancel')}</button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={Boolean(busy) || !url.trim()}
            className="btn btn-secondary"
          >
            <Clock3 size={15} /> {t('dl.addLater')}
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={Boolean(busy) || !url.trim()}
            className="btn btn-primary"
          >
            <Download size={15} /> {busy === 'now' ? t('dl.starting') : t('dl.startNow')}
          </button>
        </footer>
      </section>
    </div>
  );
}
