import { KeyRound, Vault, Layers, Ban } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// Deux gestionnaires d'identifiants cohabitent dans Orbit : le pont KeePassXC
// et les trousseaux intégrés. Tout le monde n'utilise pas les deux — ce choix
// dit lesquels Orbit interroge quand on clique un champ de connexion.
//
// Ce réglage remplace l'ancien interrupteur « activer KeePassXC » : deux
// commandes séparées pour une même décision se contredisaient (KeePassXC coupé
// mais toujours listé comme source).
const OPTIONS = [
  { id: 'both', icon: Layers },
  { id: 'keepass', icon: KeyRound },
  { id: 'vault', icon: Vault },
  { id: 'none', icon: Ban },
];

export default function CredentialSource() {
  const { settings, updateSettings } = useStore();
  const t = useT();
  const source = settings.credentials?.source || 'both';

  const choose = (value) => {
    updateSettings({ credentials: { ...(settings.credentials || {}), source: value } });
    window.electronAPI?.credentialsSetSource?.(value);
    // `keepass.enabled` reste synchronisé : d'autres écrans le lisent encore
    // pour savoir si le pont est censé répondre.
    const kp = value === 'both' || value === 'keepass';
    updateSettings({ keepass: { ...(settings.keepass || {}), enabled: kp } });
  };

  return (
    <div className="card">
      <h4 className="font-semibold mb-2 flex items-center gap-2">
        <KeyRound size={18} className="text-accent-primary" />
        {t('cred.title')}
      </h4>
      <p className="text-sm text-text-muted mb-4">{t('cred.desc')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {OPTIONS.map(({ id, icon: Icon }) => {
          const active = source === id;
          return (
            <button
              key={id}
              onClick={() => choose(id)}
              aria-pressed={active}
              className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                active
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border hover:bg-bg-hover'
              }`}
            >
              <Icon
                size={18}
                className={`mt-0.5 flex-shrink-0 ${
                  active ? 'text-accent-primary' : 'text-text-muted'
                }`}
              />
              <span>
                <span className="block font-medium text-sm">{t(`cred.${id}`)}</span>
                <span className="block text-xs text-text-muted mt-0.5">
                  {t(`cred.${id}Desc`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
