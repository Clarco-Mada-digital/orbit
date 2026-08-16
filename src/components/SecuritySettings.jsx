import { useEffect, useState } from 'react';
import { Lock, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useSecurityStore } from '../lib/securityStore';
import LockScreen from './LockScreen';
import { useT } from '../lib/i18n';

// Réglages de verrouillage : code global (au lancement) + code par profil.
// Les codes ne transitent que vers le process principal (electron/security.js),
// qui garde une empreinte scrypt chiffrée via le trousseau de l'OS.
export default function SecuritySettings() {
  const { profiles, settings, updateSettings } = useStore();
  const t = useT();
  const security = useSecurityStore();
  const [action, setAction] = useState(null); // { fn, title, subtitle, confirm }

  useEffect(() => {
    security.refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const api = window.electronAPI?.security;

  // Enveloppe : exécute l'action, rafraîchit l'état, ferme le modal si succès
  const run = async (fn, pin) => {
    const res = await fn(pin);
    if (res?.success) {
      await security.refresh();
      setAction(null);
    }
    return res;
  };

  const isProfileLocked = (id) => security.lockedProfileIds.includes(id);
  const isProfileUnlocked = (id) => security.unlockedProfileIds.includes(id);

  return (
    <div className="space-y-6">
      {/* Verrou global */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('sec.appLockTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          {t('sec.appLockDesc')}
        </p>

        {security.appLockEnabled ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                setAction({
                  fn: (pin) => run(api.setAppLock, pin),
                  title: t('sec.newCode'),
                  confirm: true,
                })
              }
              className="btn btn-secondary btn-sm"
            >
              {t('sec.changeCode')}
            </button>
            <button
              onClick={async () => {
                await api.lockApp();
                await security.refresh();
              }}
              className="btn btn-secondary btn-sm"
            >
              <Lock size={14} /> {t('sec.lockNow')}
            </button>
            <button
              onClick={() =>
                setAction({
                  fn: (pin) => run(api.removeAppLock, pin),
                  title: t('sec.disableLockTitle'),
                  subtitle: t('sec.enterCurrentConfirm'),
                  confirm: false,
                })
              }
              className="btn btn-sm text-error hover:bg-error/10"
            >
              <ShieldOff size={14} /> {t('sec.disable')}
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              setAction({
                fn: (pin) => run(api.setAppLock, pin),
                title: t('lock.setTitle'),
                confirm: true,
              })
            }
            className="btn btn-primary btn-sm"
          >
            <Lock size={14} /> {t('sec.enableLock')}
          </button>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <label className="block text-sm font-medium mb-1.5">{t('sec.autoLock')}</label>
          <p className="text-xs text-text-muted mb-2">
            {t('sec.autoLockDesc')}
          </p>
          <select
            value={settings.autoLockMinutes || 0}
            onChange={(e) => updateSettings({ autoLockMinutes: parseInt(e.target.value, 10) })}
            className="input max-w-xs"
            disabled={!security.appLockEnabled}
          >
            <option value={0}>{t('sec.disabled')}</option>
            <option value={5}>{t('sec.after5')}</option>
            <option value={10}>{t('sec.after10')}</option>
            <option value={15}>{t('st.sleep15')}</option>
            <option value={30}>{t('st.sleep30')}</option>
          </select>
        </div>
      </div>

      {/* Verrous par profil */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <LockKeyhole size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('sec.profileLockTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          {t('sec.profileLockDesc')}
        </p>

        <div className="space-y-2">
          {profiles.map((p) => {
            const locked = isProfileLocked(p.id);
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-bg-secondary"
              >
                <span className="text-xl flex-shrink-0">{p.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-xs text-text-muted">
                    {locked
                      ? isProfileUnlocked(p.id)
                        ? t('sec.lockedUnlockedSession')
                        : t('sec.locked')
                      : t('sec.notLocked')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {locked && isProfileUnlocked(p.id) && (
                    <button
                      onClick={async () => {
                        await api.lockProfile(p.id);
                        await security.refresh();
                      }}
                      className="btn btn-secondary btn-sm"
                      title={t('sec.relockNow')}
                    >
                      <Lock size={13} />
                    </button>
                  )}
                  {locked ? (
                    <button
                      onClick={() =>
                        setAction({
                          fn: (pin) => run((v) => api.removeProfileLock(p.id, v), pin),
                          title: t('sec.unlockProfileTitle', { name: p.name }),
                          subtitle: t('sec.enterCurrentRemove'),
                          confirm: false,
                        })
                      }
                      className="btn btn-sm text-error hover:bg-error/10"
                    >
                      {t('sec.removeCode')}
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setAction({
                          fn: (pin) => run((v) => api.setProfileLock(p.id, v), pin),
                          title: t('sec.codeForProfile', { name: p.name }),
                          confirm: true,
                        })
                      }
                      className="btn btn-secondary btn-sm"
                    >
                      <Lock size={13} /> {t('lock.setTitle')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal de saisie */}
      {action && (
        <div className="fixed inset-0 z-[60]">
          <LockScreen
            variant="profile"
            title={action.title}
            subtitle={action.subtitle}
            confirm={action.confirm}
            onSubmit={action.fn}
            onCancel={() => setAction(null)}
          />
        </div>
      )}
    </div>
  );
}
