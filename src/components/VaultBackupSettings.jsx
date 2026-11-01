import { useCallback, useEffect, useState } from 'react';
import { Archive, FolderOpen, Loader2, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Réglages → Mots de passe → Sauvegarde automatique
//
// Désactivé par défaut : écrire des archives de mots de passe quelque part sur
// le disque est une décision, pas un réglage à subir. L'écran dit donc tout ce
// qu'il faut savoir AVANT d'activer — où, à quelle cadence, combien de copies,
// et ce qui n'est pas couvert (les trousseaux restés fermés).
// ---------------------------------------------------------------------------
const api = () => window.electronAPI?.vault;

const FREQUENCIES = [6, 12, 24, 24 * 7];

export default function VaultBackupSettings() {
  const t = useT();
  const [state, setState] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await api()?.backupState();
      if (res?.success) setState(res);
    } catch {
      /* coffre indisponible : l'écran reste en attente */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Traduit les refus du processus principal en phrases actionnables : « il
  // manque le dossier » vaut mieux que « échec ».
  const fail = (code) =>
    setError(
      t(
        {
          'weak-passphrase': 'pv.err.weakPassphrase',
          'no-keychain': 'vb.err.noKeychain',
          'dir-required': 'vb.err.dirRequired',
          'passphrase-required': 'vb.err.passphraseRequired',
          'dir-unwritable': 'vb.err.dirUnwritable',
          'all-locked': 'vb.err.allLocked',
        }[code] || 'vb.err.generic'
      )
    );

  const apply = async (patch) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api()?.configureBackup(patch);
      if (res?.success) {
        setState(res);
        if (patch.passphrase) setPassphrase('');
      } else {
        fail(res?.error);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const pickDir = async () => {
    setError('');
    const res = await api()?.pickBackupDir();
    if (res?.success) setState(res);
    else if (res?.error && res.error !== 'canceled') fail(res.error);
  };

  const runNow = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api()?.runBackup();
      if (res?.success) setMessage(t('vb.ranOk', { n: res.written, entries: res.entries || 0 }));
      else fail(res?.error);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      const res = await api()?.forgetBackupPassphrase();
      if (res?.success) setState(res);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="card text-sm text-text-muted flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> {t('vb.loading')}
      </div>
    );
  }

  const ready = Boolean(state.dir && state.hasPassphrase);
  const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : t('vb.never'));

  return (
    <div className="card space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Archive size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('vb.title')}</h4>
        </div>
        <p className="text-sm text-text-muted">{t('vb.desc')}</p>
      </div>

      {/* Sans trousseau système, on ne peut pas garder la phrase de passe
          entre deux lancements : autant le dire avant toute manipulation. */}
      {!state.keychainAvailable && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
          <span>{t('vb.err.noKeychain')}</span>
        </div>
      )}

      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-medium">{t('vb.enable')}</span>
          <span className="block text-sm text-text-muted">{t('vb.enableDesc')}</span>
        </span>
        <input
          type="checkbox"
          checked={Boolean(state.enabled)}
          disabled={busy || (!ready && !state.enabled)}
          onChange={(e) => apply({ enabled: e.target.checked })}
          className="flex-shrink-0 w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6 disabled:opacity-50"
        />
      </label>

      {/* Dossier */}
      <div>
        <label className="block text-sm font-medium mb-1.5">{t('vb.folder')}</label>
        <div className="flex items-center gap-2">
          <input value={state.dir || ''} readOnly placeholder={t('vb.folderNone')} className="input flex-1" />
          <button onClick={pickDir} disabled={busy} className="btn btn-secondary btn-sm">
            <FolderOpen size={14} /> {t('vb.choose')}
          </button>
          {state.dir && (
            <button onClick={() => api()?.revealBackupDir()} className="btn btn-ghost btn-sm">
              {t('vb.open')}
            </button>
          )}
        </div>
        <p className="text-xs text-text-muted mt-1.5">{t('vb.folderHint')}</p>
      </div>

      {/* Phrase de passe des archives */}
      <div>
        <label className="block text-sm font-medium mb-1.5">{t('vb.passphrase')}</label>
        {state.hasPassphrase ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-success">{t('vb.passphraseSet')}</span>
            <button onClick={forget} disabled={busy} className="btn btn-ghost btn-sm">
              {t('vb.passphraseForget')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('vb.passphrasePlaceholder')}
              className="input flex-1"
            />
            <button
              onClick={() => apply({ passphrase })}
              disabled={busy || passphrase.length < 8 || !state.keychainAvailable}
              className="btn btn-primary btn-sm"
            >
              {t('vb.passphraseSave')}
            </button>
          </div>
        )}
        <p className="text-xs text-warning mt-1.5">{t('vb.passphraseWarning')}</p>
      </div>

      {/* Cadence et rotation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('vb.every')}</label>
          <select
            value={state.everyHours}
            onChange={(e) => apply({ everyHours: Number(e.target.value) })}
            disabled={busy}
            className="input"
          >
            {FREQUENCIES.map((h) => (
              <option key={h} value={h}>
                {t(h >= 24 ? 'vb.everyDays' : 'vb.everyHours', { n: h >= 24 ? h / 24 : h })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('vb.keep')}</label>
          <input
            type="number"
            min="1"
            max="100"
            value={state.keep}
            onChange={(e) => apply({ keep: Number(e.target.value) })}
            disabled={busy}
            className="input"
          />
          <p className="text-xs text-text-muted mt-1">{t('vb.keepHint')}</p>
        </div>
      </div>

      {/* État */}
      <div className="rounded-lg border border-border p-3 text-xs space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">{t('vb.lastRun')}</span>
          <span className="tabular-nums">{fmt(state.lastRunAt)}</span>
        </div>
        {state.enabled && state.nextRunAt > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">{t('vb.nextRun')}</span>
            <span className="tabular-nums">{fmt(state.nextRunAt)}</span>
          </div>
        )}
        {state.lastResult?.locked?.length > 0 && (
          // Point le plus facile à mal comprendre : un trousseau fermé n'est
          // PAS sauvegardé, parce qu'Orbit n'en a pas la clé.
          <p className="text-warning pt-1">
            {t('vb.lockedSkipped', { names: state.lastResult.locked.join(', ') })}
          </p>
        )}
        {state.lastResult?.failed?.length > 0 && (
          <p className="text-error pt-1">
            {t('vb.failed', { names: state.lastResult.failed.join(', ') })}
          </p>
        )}
      </div>

      {error && <div className="text-sm text-error">{error}</div>}
      {message && <div className="text-sm text-success">{message}</div>}

      <div className="flex items-center gap-2">
        <button onClick={runNow} disabled={busy || !ready} className="btn btn-secondary btn-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {t('vb.runNow')}
        </button>
        <button onClick={refresh} disabled={busy} className="btn btn-ghost btn-sm">
          <RefreshCw size={14} /> {t('vb.refresh')}
        </button>
      </div>
    </div>
  );
}
