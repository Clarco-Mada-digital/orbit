import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, Upload, ShieldCheck, Loader2, CheckCircle2, AlertCircle,
  RefreshCw, FolderOpen, Monitor,
} from 'lucide-react';
import { useStore, defaultSettings } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { loadSyncConfig, saveSyncConfig, runSync, loadPassphrase, savePassphrase } from '../lib/syncClient';

// Champs de configuration inclus dans une sauvegarde (on exclut l'état
// transitoire : app active, écran partagé…).
function buildPayload() {
  const s = useStore.getState();
  return {
    orbitBackup: 1,
    exportedAt: new Date().toISOString(),
    profiles: s.profiles,
    apps: s.apps,
    settings: s.settings,
    extensions: s.extensions,
    activeProfile: s.activeProfile,
    sidebarCollapsed: s.sidebarCollapsed,
  };
}

// `t` est passé par l'appelant : cette fonction vit hors du composant, elle
// n'a donc pas accès au hook useT().
function applyPayload(data, t) {
  if (!data || !Array.isArray(data.profiles) || !Array.isArray(data.apps)) {
    throw new Error(t('bk.invalid'));
  }
  useStore.setState({
    profiles: data.profiles,
    apps: data.apps,
    settings: { ...defaultSettings, ...(data.settings || {}) },
    extensions: Array.isArray(data.extensions) ? data.extensions : [],
    activeProfile: data.activeProfile || data.profiles[0]?.id,
    sidebarCollapsed: !!data.sidebarCollapsed,
    activeApp: null,
    splitView: null,
  });
}

// Intervalle du cycle automatique. Cinq minutes : assez court pour qu'une
// machine allumée reste à jour, assez long pour ne pas solliciter le service
// de stockage en permanence (un cycle sans nouveauté n'écrit qu'un fichier).
const AUTO_SYNC_MS = 5 * 60 * 1000;

function SyncCard() {
  const t = useT();
  const [cfg, setCfg] = useState(loadSyncConfig);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }
  const [device, setDevice] = useState(null);
  // La phrase secrète vit dans le trousseau de l'OS, pas dans le localStorage :
  // elle arrive donc de façon asynchrone.
  const [pass, setPass] = useState('');

  useEffect(() => {
    window.electronAPI?.sync?.identity?.().then(setDevice);
    loadPassphrase().then(setPass);
  }, []);

  const sync = useCallback(
    async (silent = false) => {
      setBusy(true);
      if (!silent) setMsg(null);
      try {
        const res = await runSync({ folder: cfg.folder, password: pass });
        if (!res.ok) {
          setMsg({ type: 'err', text: t(res.error) || res.error });
          return;
        }
        setCfg(saveSyncConfig({ lastSync: res.at }));
        if (res.first) setMsg({ type: 'ok', text: t('sync.published') });
        else if (!res.incoming) setMsg({ type: 'ok', text: t('sync.upToDate') });
        else
          setMsg({
            type: 'ok',
            text: t('sync.applied', {
              a: res.summary.added,
              m: res.summary.updated,
              s: res.summary.removed,
            }),
          });
      } finally {
        setBusy(false);
      }
    },
    [cfg.folder, pass, t]
  );

  // Cycle automatique. `syncRef` évite de relancer le minuteur à chaque rendu
  // (sinon l'intervalle repartirait de zéro en permanence et ne tomberait
  // jamais). La référence est mise à jour dans un effet, pas pendant le rendu :
  // écrire dans une ref en plein rendu casse le rendu concurrent de React.
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  useEffect(() => {
    if (!cfg.enabled || !cfg.auto || !cfg.folder) return undefined;
    const id = setInterval(() => syncRef.current(true), AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [cfg.enabled, cfg.auto, cfg.folder]);

  const chooseFolder = async () => {
    const res = await window.electronAPI?.sync?.chooseFolder?.();
    if (res?.success) setCfg(saveSyncConfig({ folder: res.folder }));
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('sync.title')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('sync.desc')}</p>

      <label className="flex items-center gap-2 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => setCfg(saveSyncConfig({ enabled: e.target.checked }))}
        />
        <span className="text-sm">{t('sync.enable')}</span>
      </label>

      {cfg.enabled && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              readOnly
              value={cfg.folder}
              placeholder={t('sync.folderPlaceholder')}
              className="input flex-1 text-xs"
            />
            <button onClick={chooseFolder} className="btn btn-secondary whitespace-nowrap">
              <FolderOpen size={16} /> {t('sync.choose')}
            </button>
          </div>

          <input
            type="password"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              savePassphrase(e.target.value);
            }}
            placeholder={t('sync.passphrasePlaceholder')}
            className="input w-full"
          />
          <p className="text-xs text-text-muted flex items-center gap-1">
            <ShieldCheck size={12} /> {t('sync.encNote')}
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.auto}
              onChange={(e) => setCfg(saveSyncConfig({ auto: e.target.checked }))}
            />
            <span className="text-sm">{t('sync.auto')}</span>
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={() => sync(false)}
              disabled={busy || !cfg.folder}
              className="btn btn-primary"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {t('sync.now')}
            </button>
            {cfg.lastSync > 0 && (
              <span className="text-xs text-text-muted">
                {t('sync.last', { when: new Date(cfg.lastSync).toLocaleString() })}
              </span>
            )}
          </div>

          {device && (
            <p className="text-xs text-text-muted flex items-center gap-1">
              <Monitor size={12} /> {t('sync.thisDevice', { name: device.name })}
            </p>
          )}

          {msg && (
            <div
              className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                msg.type === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
                  : 'bg-error/10 text-error border border-error/30'
              }`}
            >
              {msg.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BackupSettings() {
  const t = useT();
  const [exportPwd, setExportPwd] = useState('');
  const [busy, setBusy] = useState(null); // 'export' | 'import' | null
  const [msg, setMsg] = useState(null); // { type: 'ok'|'err', text }
  // Import chiffré : on garde le blob en attendant le mot de passe
  const [pendingBlob, setPendingBlob] = useState(null);
  const [importPwd, setImportPwd] = useState('');

  const handleExport = async () => {
    setBusy('export');
    setMsg(null);
    try {
      const res = await window.electronAPI?.backupExport?.({
        data: buildPayload(),
        password: exportPwd || '',
      });
      if (res?.success) {
        setMsg({ type: 'ok', text: res.encrypted ? t('bk.savedEnc') : t('bk.saved') });
        setExportPwd('');
      } else if (!res?.canceled) {
        setMsg({ type: 'err', text: res?.error || t('bk.exportFail') });
      }
    } finally {
      setBusy(null);
    }
  };

  const finishImport = (data) => {
    try {
      applyPayload(data, t);
      setMsg({ type: 'ok', text: t('bk.restored') });
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setMsg({ type: 'err', text: String(err.message || err) });
    }
  };

  const handleImport = async () => {
    setBusy('import');
    setMsg(null);
    setPendingBlob(null);
    try {
      const res = await window.electronAPI?.backupImport?.();
      if (!res?.success) {
        if (!res?.canceled) setMsg({ type: 'err', text: res?.error || t('bk.importFail') });
        return;
      }
      if (res.encrypted) {
        setPendingBlob(res.blob); // demande le mot de passe
      } else {
        finishImport(res.data);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDecrypt = async () => {
    const res = await window.electronAPI?.backupDecrypt?.({ blob: pendingBlob, password: importPwd });
    if (res?.success) {
      setPendingBlob(null);
      setImportPwd('');
      finishImport(res.data);
    } else {
      setMsg({ type: 'err', text: res?.error || t('bk.wrongPwd') });
    }
  };

  return (
    <div className="space-y-6">
      <SyncCard />

      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Download size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('bk.exportTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          {t('bk.exportDesc')}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={exportPwd}
            onChange={(e) => setExportPwd(e.target.value)}
            placeholder={t('bk.exportPwdPlaceholder')}
            className="input flex-1"
          />
          <button onClick={handleExport} disabled={busy === 'export'} className="btn btn-primary whitespace-nowrap">
            {busy === 'export' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {t('bk.export')}
          </button>
        </div>
        {exportPwd && (
          <p className="text-xs text-text-muted mt-2 flex items-center gap-1">
            <ShieldCheck size={12} /> {t('bk.encNote')}
          </p>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Upload size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('bk.importTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          {t('bk.importDesc')}
        </p>
        {pendingBlob ? (
          <div className="flex gap-2">
            <input
              type="password"
              value={importPwd}
              onChange={(e) => setImportPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDecrypt()}
              placeholder={t('bk.filePwdPlaceholder')}
              className="input flex-1"
              autoFocus
            />
            <button onClick={handleDecrypt} className="btn btn-primary whitespace-nowrap">
              {t('bk.unlock')}
            </button>
            <button onClick={() => setPendingBlob(null)} className="btn btn-secondary">
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button onClick={handleImport} disabled={busy === 'import'} className="btn btn-secondary">
            {busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {t('bk.chooseFile')}
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
            msg.type === 'ok'
              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30'
              : 'bg-error/10 text-error border border-error/30'
          }`}
        >
          {msg.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
