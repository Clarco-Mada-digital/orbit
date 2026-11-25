import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { useStore } from '../stores/useStore';

// ---------------------------------------------------------------------------
// Réglages → Sécurité → Mode panique.
//
// Un raccourci global qui protège tout de suite : fenêtres cachées (même de
// la barre des tâches), vidéos en pause et incrustations fermées, micro et
// caméra coupés, notifications bloquées, coffres fermés, Orbit et profils
// verrouillés, navigation privée fermée. On revient par le raccourci
// d'invocation ou l'icône de la zone de notification.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  enabled: true,
  accelerator: 'CommandOrControl+Alt+H',
  lock: true,
  stopNetworks: false,
  clearTor: false,
  closePrivate: true,
  clearClipboard: false,
};
const mac = () => window.electronAPI?.platform === 'darwin';

const pretty = (accel) =>
  String(accel || '')
    .replace('CommandOrControl', mac() ? '⌘' : 'Ctrl')
    .replace('Alt', mac() ? '⌥' : 'Alt')
    .replace('Shift', mac() ? '⇧' : 'Maj')
    .split('+')
    .join(' + ');

// Touche → accélérateur Electron (au moins un modificateur exigé : un
// raccourci global sur une seule touche volerait cette touche partout).
function comboFromEvent(e) {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const k = e.key;
  if (!mods.length || ['Control', 'Meta', 'Alt', 'Shift'].includes(k)) return null;
  const key = k.length === 1 ? k.toUpperCase() : { Escape: 'Escape', ' ': 'Space', Backspace: 'Backspace', Delete: 'Delete' }[k] || (/^F\d{1,2}$/.test(k) ? k : null);
  return key ? [...mods, key].join('+') : null;
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4 py-1.5">
      <span>
        <span className="text-sm">{label}</span>
        {hint ? <span className="block text-xs text-text-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-12 h-6 shrink-0 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
      />
    </label>
  );
}

export default function PanicSettings() {
  const saved = useStore((s) => s.settings.panic);
  const panic = { ...DEFAULTS, ...(saved || {}) };
  const updateSettings = useStore((s) => s.updateSettings);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState(null);
  const [lockOn, setLockOn] = useState(null);
  const [profileLocks, setProfileLocks] = useState(0);

  const set = (patch) => updateSettings({ panic: { ...panic, ...patch } });

  useEffect(() => {
    window.electronAPI?.security
      ?.getState?.()
      .then((st) => {
        setLockOn(Boolean(st?.appLockEnabled));
        setProfileLocks(st?.lockedProfileIds?.length || 0);
      })
      .catch(() => {});
  }, []);

  // Le processus principal dit si le raccourci a pu être réservé.
  useEffect(() => {
    let alive = true;
    window.electronAPI?.panic
      ?.configure?.(panic)
      .then((r) => alive && setStatus(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panic.enabled, panic.accelerator]);

  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2">
        <EyeOff size={18} className="text-red-500" />
        <h4 className="font-semibold">Mode panique</h4>
      </div>
      <p className="text-sm text-text-muted">
        Un raccourci qui protège tout de suite, même quand Orbit n’est pas au premier plan : toutes ses fenêtres disparaissent
        (barre des tâches comprise), les vidéos s’arrêtent et leurs incrustations se ferment, le micro, la caméra et le partage
        d’écran sont coupés, plus aucune notification ne s’affiche, et les coffres se ferment. Pour revenir : raccourci
        d’invocation ou icône de la zone de notification.
      </p>

      <Toggle label="Activer le raccourci panique" checked={panic.enabled} onChange={(v) => set({ enabled: v })} />

      {panic.enabled ? (
        <>
          <div className="flex flex-wrap items-center gap-2 py-1">
            <span className="text-sm">Raccourci :</span>
            <button
              type="button"
              onClick={() => setRecording(true)}
              onKeyDown={(e) => {
                if (!recording) return;
                e.preventDefault();
                if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                  setRecording(false);
                  return;
                }
                const combo = comboFromEvent(e);
                if (combo) {
                  set({ accelerator: combo });
                  setRecording(false);
                }
              }}
              onBlur={() => setRecording(false)}
              className={`rounded-lg border px-3 py-1 font-mono text-xs ${recording ? 'border-accent-primary text-accent-primary' : 'border-border'}`}
            >
              {recording ? 'Tapez la combinaison… (Échap : annuler)' : pretty(panic.accelerator)}
            </button>
            <button type="button" onClick={() => window.electronAPI?.panic?.trigger?.()} className="btn btn-secondary btn-sm">
              Essayer maintenant
            </button>
          </div>
          {status && !status.registered ? <p className="text-xs text-red-500">{status.error || 'Raccourci indisponible.'}</p> : null}

          {lockOn === false && profileLocks === 0 ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              Aucun code de verrouillage n’est défini : au retour, tout réapparaît sans rien demander. Définissez un code ci-dessus
              (pour Orbit ou pour un profil) pour que la panique protège vraiment.
            </p>
          ) : null}
          <Toggle
            label="Verrouiller Orbit et les profils protégés"
            hint={
              lockOn === false && profileLocks === 0
                ? 'Aucun code défini : ce choix ne sert qu’une fois un code défini.'
                : 'Le code sera demandé au retour ; les pages des profils verrouillés sont fermées.'
            }
            checked={panic.lock}
            onChange={(v) => set({ lock: v })}
          />
          <Toggle
            label="Fermer la navigation privée"
            hint="Les pages et fenêtres privées sont fermées et leurs données effacées."
            checked={panic.closePrivate}
            onChange={(v) => set({ closePrivate: v })}
          />
          <Toggle
            label="Vider le presse-papiers"
            hint="Utile si vous venez de copier un mot de passe."
            checked={panic.clearClipboard}
            onChange={(v) => set({ clearClipboard: v })}
          />
          <Toggle
            label="Arrêter Tor et les VPN"
            hint="Coupe Tor, le VPN et le VPN Orbit (les apps qui en dépendent ne chargent plus rien)."
            checked={panic.stopNetworks}
            onChange={(v) => set({ stopNetworks: v })}
          />
          <Toggle
            label="Effacer les données des apps passées par Tor"
            hint="Cookies, connexions et cache de ces apps — vous serez déconnecté."
            checked={panic.clearTor}
            onChange={(v) => set({ clearTor: v })}
          />
          <p className="text-xs text-text-muted">Aussi disponible dans la palette de commandes : « Mode panique ».</p>
        </>
      ) : null}
    </div>
  );
}
