import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck, ShieldAlert, Loader2, Link } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// Onglet KeePassXC des Paramètres : état du pont, association, activer/désactiver
export default function KeepassSettings() {
  const { settings, updateSettings } = useStore();
  const t = useT();
  const [status, setStatus] = useState(null); // { enabled, associated, kpRunning, error, associationIds }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text }

  const enabled = settings.keepass?.enabled !== false;

  const refresh = async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const res = await window.electronAPI?.keepassStatus?.();
      setStatus(res || null);
    } catch {
      setStatus(null);
    } finally {
      if (!silent) setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = (value) => {
    updateSettings({ keepass: { ...(settings.keepass || {}), enabled: value } });
    window.electronAPI?.keepassSetEnabled?.(value);
  };

  const doAssociate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.electronAPI?.keepassAssociate?.();
      if (res?.success) {
        setMsg({ type: 'ok', text: t('kp.associatedMsg', { id: res.id }) });
      } else {
        setMsg({
          type: 'err',
          text:
            res?.error ||
            t('kp.assocFailed'),
        });
      }
    } catch (err) {
      setMsg({ type: 'err', text: String(err?.message || err) });
    } finally {
      setBusy(false);
      refresh(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Activer / désactiver */}
      <div className="card">
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <KeyRound size={18} className="text-accent-primary" />
          {t('kp.autofillTitle')}
        </h4>
        <p className="text-sm text-text-muted mb-4">
          {t('kp.autofillDesc')}
        </p>
        <label className="flex items-center justify-between">
          <span className="font-medium">{t('kp.enableAutofill')}</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
          />
        </label>
      </div>

      {/* État de la connexion */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold">{t('kp.connection')}</h4>
          <button onClick={() => refresh()} className="btn btn-secondary btn-sm" disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('kp.check')}
          </button>
        </div>

        {!status ? (
          <p className="text-sm text-text-muted">{t('kp.loading')}</p>
        ) : (
          <div className="space-y-3">
            {/* KeePassXC tourne ? */}
            <div className="flex items-center gap-3">
              {status.kpRunning ? (
                <ShieldCheck size={18} className="text-green-500 flex-shrink-0" />
              ) : (
                <ShieldAlert size={18} className="text-amber-500 flex-shrink-0" />
              )}
              <div>
                <div className="font-medium text-sm">
                  {status.kpRunning ? t('kp.detected') : t('kp.notReachable')}
                </div>
                {!status.kpRunning && (
                  <p className="text-xs text-text-muted">
                    {t('kp.notReachableHint')}
                    {status.error ? ` (${status.error})` : ''}
                  </p>
                )}
              </div>
            </div>

            {/* Associé ? */}
            <div className="flex items-center gap-3">
              {status.associated ? (
                <ShieldCheck size={18} className="text-green-500 flex-shrink-0" />
              ) : (
                <ShieldAlert size={18} className="text-amber-500 flex-shrink-0" />
              )}
              <div>
                <div className="font-medium text-sm">
                  {status.associated
                    ? t('kp.associatedTo', { ids: status.associationIds?.join(', ') })
                    : t('kp.notAssociated')}
                </div>
                {!status.associated && (
                  <p className="text-xs text-text-muted">
                    {t('kp.notAssociatedHint')}
                  </p>
                )}
              </div>
            </div>

            {msg && (
              <div
                className={`px-3 py-2 rounded-lg text-sm ${
                  msg.type === 'ok'
                    ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                }`}
              >
                {msg.text}
              </div>
            )}
          </div>
        )}

        <button
          onClick={doAssociate}
          disabled={busy || !status?.kpRunning}
          className="btn btn-primary mt-4 w-full"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
          {status?.associated ? t('kp.reassociate') : t('kp.associate')}
        </button>
        {!status?.kpRunning && (
          <p className="text-xs text-text-muted mt-2">
            {t('kp.needDetected')}
          </p>
        )}
      </div>

      {/* Comment ça marche */}
      <div className="card">
        <h4 className="font-semibold mb-2">{t('kp.howTitle')}</h4>
        <ul className="text-sm text-text-muted space-y-2">
          <li>• {t('kp.how1')}</li>
          <li>• {t('kp.how2')}</li>
          <li>• {t('kp.how3')}</li>
          <li>• {t('kp.how4')}</li>
        </ul>
      </div>
    </div>
  );
}
