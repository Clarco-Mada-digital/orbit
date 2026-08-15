import { useEffect, useState } from 'react';
import { Lock, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useSecurityStore } from '../lib/securityStore';
import LockScreen from './LockScreen';

// Réglages de verrouillage : code global (au lancement) + code par profil.
// Les codes ne transitent que vers le process principal (electron/security.js),
// qui garde une empreinte scrypt chiffrée via le trousseau de l'OS.
export default function SecuritySettings() {
  const { profiles, settings, updateSettings } = useStore();
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
          <h4 className="font-semibold">Verrouiller Orbit au démarrage</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Un code est demandé à chaque ouverture d'Orbit. Sans lui, personne ne peut voir vos
          comptes connectés. Le code n'est jamais stocké en clair.
        </p>

        {security.appLockEnabled ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                setAction({
                  fn: (pin) => run(api.setAppLock, pin),
                  title: 'Nouveau code',
                  confirm: true,
                })
              }
              className="btn btn-secondary btn-sm"
            >
              Modifier le code
            </button>
            <button
              onClick={async () => {
                await api.lockApp();
                await security.refresh();
              }}
              className="btn btn-secondary btn-sm"
            >
              <Lock size={14} /> Verrouiller maintenant
            </button>
            <button
              onClick={() =>
                setAction({
                  fn: (pin) => run(api.removeAppLock, pin),
                  title: 'Désactiver le verrou',
                  subtitle: 'Entrez le code actuel pour confirmer',
                  confirm: false,
                })
              }
              className="btn btn-sm text-error hover:bg-error/10"
            >
              <ShieldOff size={14} /> Désactiver
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              setAction({
                fn: (pin) => run(api.setAppLock, pin),
                title: 'Définir un code',
                confirm: true,
              })
            }
            className="btn btn-primary btn-sm"
          >
            <Lock size={14} /> Activer le verrou
          </button>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <label className="block text-sm font-medium mb-1.5">Verrouillage automatique</label>
          <p className="text-xs text-text-muted mb-2">
            Verrouille Orbit après une période d'inactivité (nécessite un code global).
          </p>
          <select
            value={settings.autoLockMinutes || 0}
            onChange={(e) => updateSettings({ autoLockMinutes: parseInt(e.target.value, 10) })}
            className="input max-w-xs"
            disabled={!security.appLockEnabled}
          >
            <option value={0}>Désactivé</option>
            <option value={5}>Après 5 minutes</option>
            <option value={10}>Après 10 minutes</option>
            <option value={15}>Après 15 minutes</option>
            <option value={30}>Après 30 minutes</option>
          </select>
        </div>
      </div>

      {/* Verrous par profil */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <LockKeyhole size={18} className="text-accent-primary" />
          <h4 className="font-semibold">Verrouiller un profil</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Un profil verrouillé reste masqué (ses apps ne se chargent pas) tant que son code n'est
          pas saisi. Idéal pour séparer « perso » et « pro ».
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
                        ? 'Verrouillé · déverrouillé pour cette session'
                        : 'Verrouillé'
                      : 'Non verrouillé'}
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
                      title="Reverrouiller maintenant"
                    >
                      <Lock size={13} />
                    </button>
                  )}
                  {locked ? (
                    <button
                      onClick={() =>
                        setAction({
                          fn: (pin) => run((v) => api.removeProfileLock(p.id, v), pin),
                          title: `Déverrouiller « ${p.name} »`,
                          subtitle: 'Entrez le code actuel pour retirer le verrou',
                          confirm: false,
                        })
                      }
                      className="btn btn-sm text-error hover:bg-error/10"
                    >
                      Retirer le code
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setAction({
                          fn: (pin) => run((v) => api.setProfileLock(p.id, v), pin),
                          title: `Code pour « ${p.name} »`,
                          confirm: true,
                        })
                      }
                      className="btn btn-secondary btn-sm"
                    >
                      <Lock size={13} /> Définir un code
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
