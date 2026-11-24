import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download, Upload, ShieldCheck, Loader2, CheckCircle2, AlertCircle,
  RefreshCw, FolderOpen, Monitor,
} from 'lucide-react';
import { useStore, defaultSettings } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { loadSyncConfig, saveSyncConfig, runSync, loadPassphrase, savePassphrase } from '../lib/syncClient';
import { BACKUP_CATEGORIES, categoriesIn, defaultSelection, describeCategory, mainFilesFor } from '../lib/backupCategories';
import { useHistoryStore } from '../lib/historyStore';
import { useApiStore, useDbUiStore } from '../lib/devToolsStore';

// Contenu d'une sauvegarde, catégorie par catégorie (voir
// lib/backupCategories.js) : l'utilisateur choisit ce qu'il emporte, et ce
// qu'il restaure.
function buildPayload(selection) {
  const s = useStore.getState();
  const out = { orbitBackup: 3, exportedAt: new Date().toISOString(), categories: [] };
  const take = (id, fill) => {
    if (!selection[id]) return;
    out.categories.push(id);
    fill();
  };
  take('workspace', () => {
    Object.assign(out, {
      profiles: s.profiles,
      apps: s.apps,
      containers: s.containers,
      folders: s.folders,
      workspaces: s.workspaces,
      activeProfile: s.activeProfile,
      sidebarCollapsed: s.sidebarCollapsed,
    });
  });
  take('automations', () => (out.rules = s.rules));
  take('settings', () => (out.settings = s.settings));
  take('extensions', () => (out.extensions = s.extensions));
  take('assistant', () => (out.assistantSessions = s.assistantSessions));
  take('history', () => (out.history = useHistoryStore.getState()));
  take('api', () => {
    const a = useApiStore.getState();
    out.api = { collections: a.collections, environments: a.environments, activeEnvId: a.activeEnvId, history: a.history };
  });
  take('database', () => {
    const d = useDbUiStore.getState();
    out.dbUi = { favorites: d.favorites, history: d.history, layouts: d.layouts };
  });
  // Fonctions (actions des stores) : jamais dans un fichier.
  return JSON.parse(JSON.stringify(out));
}

// `t` est passé par l'appelant : cette fonction vit hors du composant, elle
// n'a donc pas accès au hook useT().
async function applyPayload(data, selection, t) {
  const want = (id) => selection[id] && categoriesIn(data).includes(id);
  if (want('workspace')) {
    if (!Array.isArray(data.profiles) || !Array.isArray(data.apps)) throw new Error(t('bk.invalid'));
    useStore.setState({
      profiles: data.profiles,
      apps: data.apps,
      containers: Array.isArray(data.containers) ? data.containers : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
      workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
      activeProfile: data.activeProfile || data.profiles[0]?.id,
      sidebarCollapsed: !!data.sidebarCollapsed,
      activeApp: null,
      splitView: null,
    });
  }
  if (want('automations')) useStore.setState({ rules: data.rules });
  if (want('settings')) useStore.setState({ settings: { ...defaultSettings, ...(data.settings || {}) } });
  if (want('extensions')) useStore.setState({ extensions: data.extensions });
  if (want('assistant')) useStore.setState({ assistantSessions: data.assistantSessions });
  if (want('history') && data.history && typeof data.history === 'object') {
    const { entries, items } = data.history;
    useHistoryStore.setState({ ...(entries ? { entries } : {}), ...(items ? { items } : {}) });
  }
  if (want('api') && data.api) {
    useApiStore.setState({
      collections: Array.isArray(data.api.collections) ? data.api.collections : [],
      environments: Array.isArray(data.api.environments) ? data.api.environments : [],
      activeEnvId: data.api.activeEnvId || null,
      history: Array.isArray(data.api.history) ? data.api.history : [],
    });
  }
  if (want('database') && data.dbUi) {
    useDbUiStore.setState({ favorites: data.dbUi.favorites || {}, history: data.dbUi.history || {}, layouts: data.dbUi.layouts || {} });
  }
  // Fichiers du processus principal : seulement les catégories cochées.
  const mainFiles = {};
  for (const id of ['database', 'sites']) {
    if (!want(id)) continue;
    for (const name of BACKUP_CATEGORIES.find((c) => c.id === id).main || []) {
      if (data.mainFiles?.[name]) mainFiles[name] = data.mainFiles[name];
    }
  }
  if (Object.keys(mainFiles).length) {
    const r = await window.electronAPI?.backupRestoreMain?.({ files: mainFiles });
    if (r && !r.success) throw new Error(r.error || t('bk.importFail'));
  }
}

// Cases à cocher des catégories (export et restauration).
function CategoryPicker({ selection, onChange, available, data }) {
  return (
    <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {BACKUP_CATEGORIES.filter((c) => !available || available.includes(c.id)).map((c) => (
        <label
          key={c.id}
          className={`flex cursor-pointer items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-sm ${selection[c.id] ? 'bg-accent-primary/5' : ''}`}
        >
          <input
            type="checkbox"
            checked={Boolean(selection[c.id])}
            disabled={c.required && !available}
            onChange={(e) => onChange({ ...selection, [c.id]: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-accent-primary"
          />
          <span className="min-w-0">
            <span className="block font-medium">{c.label}</span>
            <span className="block text-xs text-text-muted">{data ? describeCategory(c.id, data) || c.detail : c.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
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
  // Sauvegarde complète (sessions + trousseaux) : activée par défaut — c'est
  // ce qui retrouve ses comptes connectés sur un autre ordinateur. Exige un
  // mot de passe : les cookies de connexion ne doivent jamais reposer en clair
  // dans un fichier qu'on enverra à un service de stockage.
  const [full, setFull] = useState(true);
  const [busy, setBusy] = useState(null); // 'export' | 'import' | null
  const [msg, setMsg] = useState(null); // { type: 'ok'|'err', text }
  // Import chiffré : on garde le blob en attendant le mot de passe
  const [pendingBlob, setPendingBlob] = useState(null);
  const [importPwd, setImportPwd] = useState('');
  // Catégories choisies à l'export ; contenu lu en attente de restauration.
  const [exportSel, setExportSel] = useState(defaultSelection);
  const [pendingData, setPendingData] = useState(null);
  const [importSel, setImportSel] = useState({});

  const handleExport = async () => {
    if (full && !exportPwd.trim()) {
      setMsg({ type: 'err', text: t('bk.fullNeedsPwd') });
      return;
    }
    setBusy('export');
    setMsg(null);
    try {
      const res = await window.electronAPI?.backupExport?.({
        data: buildPayload(exportSel),
        password: exportPwd || '',
        full,
        mainFiles: mainFilesFor(exportSel),
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

  // Fichier lu (et déchiffré) : on montre ce qu'il contient, l'utilisateur
  // coche ce qu'il veut restaurer.
  const finishImport = (data) => {
    const found = categoriesIn(data);
    if (!found.length) {
      setMsg({ type: 'err', text: t('bk.invalid') });
      return;
    }
    setPendingData(data);
    setImportSel(Object.fromEntries(found.map((id) => [id, true])));
  };

  const restore = async () => {
    const data = pendingData;
    setBusy('import');
    try {
      await applyPayload(data, importSel, t);
      setPendingData(null);
      // Fichiers de session / trousseaux dans la sauvegarde : on les ÉTAGE,
      // puis on redémarre — ils ne seront appliqués qu'au prochain lancement,
      // avant qu'Electron n'ouvre la moindre session (sinon les cookies en
      // mémoire réécriraient par-dessus).
      const files = Array.isArray(data.files) && importSel.sessions !== false ? data.files : [];
      if (files.length > 0) {
        setMsg({ type: 'ok', text: t('bk.restarting') });
        const st = await window.electronAPI?.backupStageRestore?.({ files });
        if (st?.success) setTimeout(() => window.electronAPI?.backupRelaunch?.(), 1200);
        else setMsg({ type: 'err', text: st?.error || t('bk.importFail') });
        return;
      }
      setMsg({ type: 'ok', text: t('bk.restored') });
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setMsg({ type: 'err', text: String(err.message || err) });
    } finally {
      setBusy(null);
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
        <CategoryPicker selection={exportSel} onChange={setExportSel} />
        <label className="flex items-start gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-accent-primary"
          />
          <span className="text-sm">{t('bk.fullLabel')}</span>
        </label>
        <p className="text-xs text-text-muted mb-3">{t('bk.fullDesc')}</p>
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
        {pendingData ? (
          <div>
            <p className="mb-2 text-sm font-medium">
              Contenu du fichier{pendingData.exportedAt ? ` (exporté le ${new Date(pendingData.exportedAt).toLocaleString()})` : ''} — cochez ce qu’il faut restaurer :
            </p>
            <CategoryPicker selection={importSel} onChange={setImportSel} available={categoriesIn(pendingData)} data={pendingData} />
            {Array.isArray(pendingData.files) && pendingData.files.length ? (
              <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={importSel.sessions !== false}
                  onChange={(e) => setImportSel({ ...importSel, sessions: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-accent-primary"
                />
                <span>
                  <span className="block font-medium">Comptes connectés et trousseaux</span>
                  <span className="block text-xs text-text-muted">Sessions des apps et coffres-forts — Orbit redémarre pour les appliquer.</span>
                </span>
              </label>
            ) : null}
            <p className="mb-3 text-xs text-text-muted">
              Les catégories cochées remplacent celles de cet ordinateur (les connexions de base de données et les autorisations des sites, elles, s’ajoutent).
            </p>
            <div className="flex gap-2">
              <button onClick={restore} disabled={busy === 'import' || !Object.values(importSel).some(Boolean)} className="btn btn-primary">
                {busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Restaurer la sélection
              </button>
              <button onClick={() => setPendingData(null)} className="btn btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : pendingBlob ? (
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
