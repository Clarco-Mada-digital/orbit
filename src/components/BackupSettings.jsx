import { useState } from 'react';
import { Download, Upload, ShieldCheck, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStore, defaultSettings } from '../stores/useStore';
import { useT } from '../lib/i18n';

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

function applyPayload(data) {
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
      applyPayload(data);
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
