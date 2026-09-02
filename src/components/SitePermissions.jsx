import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Paramètres → Confidentialité → Autorisations des sites
//
// Deux choses ici : la règle générale (demander / tout accorder / tout refuser)
// et la liste des décisions déjà prises, révisables une par une. Sans cette
// liste, un « Bloquer » cliqué trop vite serait définitif et inexplicable —
// c'est précisément ce qu'on reproche aux applications qui ne montrent rien.
//
// La source de vérité est le processus principal (permissions.json) : ces
// décisions doivent survivre au rechargement de l'interface et s'appliquer
// avant même qu'elle soit prête.
// ---------------------------------------------------------------------------
export default function SitePermissions() {
  const t = useT();
  const [mode, setMode] = useState('ask');
  const [sites, setSites] = useState([]);

  const refresh = useCallback(async () => {
    const res = await window.electronAPI?.sitePermissions?.list?.();
    if (!res?.success) return;
    setMode(res.mode || 'ask');
    setSites(res.sites || []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changeMode = async (next) => {
    setMode(next);
    await window.electronAPI?.sitePermissions?.setMode?.(next);
  };

  const forget = async (origin, permission) => {
    await window.electronAPI?.sitePermissions?.forget?.(origin, permission);
    refresh();
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.permTitle')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.permDesc')}</p>

      <label className="block text-sm font-medium mb-1.5">{t('st.permMode')}</label>
      <select
        value={mode}
        onChange={(e) => changeMode(e.target.value)}
        className="input max-w-md"
      >
        <option value="ask">{t('st.permMode.ask')}</option>
        <option value="allow">{t('st.permMode.allow')}</option>
        <option value="deny">{t('st.permMode.deny')}</option>
      </select>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm font-medium">{t('st.permSaved')}</span>
        {sites.length > 0 && (
          <button onClick={() => forget(null)} className="text-xs text-text-muted hover:text-error">
            {t('st.permForgetAll')}
          </button>
        )}
      </div>

      {sites.length === 0 ? (
        <p className="text-xs text-text-muted mt-2">{t('st.permEmpty')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {sites.map((site) => (
            <div key={site.origin} className="rounded-xl border border-border bg-bg-primary p-3">
              <div className="text-sm font-medium truncate" title={site.origin}>
                {site.origin.replace(/^https?:\/\//, '')}
              </div>
              <div className="mt-2 space-y-1.5">
                {Object.entries(site.permissions).map(([permission, decision]) => (
                  <div key={permission} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-text-secondary">
                      {t(`perm.title.${permission}`) === `perm.title.${permission}`
                        ? permission
                        : t(`perm.title.${permission}`)}
                    </span>
                    <span
                      className={
                        decision === 'allow'
                          ? 'text-xs text-success'
                          : 'text-xs text-error'
                      }
                    >
                      {decision === 'allow' ? t('st.permAllowed') : t('st.permBlocked')}
                    </span>
                    <button
                      onClick={() => forget(site.origin, permission)}
                      className="btn-icon w-6 h-6 text-text-muted hover:text-error"
                      title={t('st.permForget')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
