import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import {
  Info,
  HelpCircle,
  PenLine,
  Video,
  Mic,
  MapPin,
  Bell,
  MonitorUp,
  Clipboard,
  Piano,
  Timer,
  AppWindow,
  ShieldQuestion,
  Check,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// La modale d'Orbit pour les questions posées par une app
//
// Deux familles de questions passent par ici :
//   • les dialogues de la page — alert(), confirm(), prompt() ;
//   • les demandes d'autorisation — caméra, micro, position, notifications…
//
// Elles partagent la même fenêtre pour une raison simple : à l'écran, ce sont
// les mêmes gestes (lire, puis accepter ou refuser). Seuls l'icône, le texte
// et les cases à cocher changent.
//
// Ce composant ne parle à personne : il reçoit une demande et rend une réponse
// (voir WebDialogHost, qui fait le lien avec le processus principal).
// ---------------------------------------------------------------------------

// Chaque permission a son icône ; le titre et la phrase (« … souhaite utiliser
// votre caméra ») vivent dans les traductions, sous 'perm.title.*' / 'perm.verb.*'.
const PERMISSION_ICONS = {
  media: Video,
  audioCapture: Mic,
  videoCapture: Video,
  geolocation: MapPin,
  notifications: Bell,
  'display-capture': MonitorUp,
  'desktop-capture': MonitorUp,
  'clipboard-read': Clipboard,
  midiSysex: Piano,
  'idle-detection': Timer,
  'window-management': AppWindow,
};

const JS_KINDS = {
  alert: { icon: Info, label: 'dlg.message', accent: 'text-warning' },
  confirm: { icon: HelpCircle, label: 'dlg.confirm', accent: 'text-accent-primary' },
  prompt: { icon: PenLine, label: 'dlg.prompt', accent: 'text-accent-primary' },
};

// « https://meet.google.com » se lit mieux en « meet.google.com ».
function prettyOrigin(origin) {
  if (!origin) return '';
  return String(origin).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export default function WebDialog({ dialog, onAnswer }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(true);
  const [silence, setSilence] = useState(false);
  const inputRef = useRef(null);
  const okRef = useRef(null);

  const isPermission = dialog?.kind === 'permission';
  // Permission inconnue d'Orbit (une nouvelle API du moteur) : on demande quand
  // même, avec une formulation générique, plutôt que de trancher en silence.
  const known = isPermission && PERMISSION_ICONS[dialog.permission] ? dialog.permission : 'unknown';
  const permIcon = isPermission ? PERMISSION_ICONS[dialog.permission] || ShieldQuestion : null;
  const js = !isPermission ? JS_KINDS[dialog?.type] || JS_KINDS.alert : null;

  // Chaque nouvelle demande repart de zéro : ni texte de la précédente, ni
  // case cochée par mégarde.
  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.defaultText || '');
    setRemember(true);
    setSilence(false);
    const timer = setTimeout(() => {
      if (dialog.type === 'prompt') {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        okRef.current?.focus();
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [dialog?.id]);

  const accept = useCallback(() => {
    if (!dialog) return;
    if (isPermission) return onAnswer({ allowed: true, remember });
    if (dialog.type === 'prompt') return onAnswer({ value, silence });
    if (dialog.type === 'confirm') return onAnswer({ value: true, silence });
    return onAnswer({ value: null, silence });
  }, [dialog, isPermission, onAnswer, remember, silence, value]);

  const refuse = useCallback(() => {
    if (!dialog) return;
    if (isPermission) return onAnswer({ allowed: false, remember });
    return onAnswer({ value: dialog.type === 'confirm' ? false : null, silence });
  }, [dialog, isPermission, onAnswer, silence]);

  // Échap = refuser/annuler, Entrée = valider. Capture, pour passer devant les
  // raccourcis d'Orbit tant que la modale est ouverte.
  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        refuse();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        accept();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dialog, accept, refuse]);

  if (!dialog) return null;

  const Icon = isPermission ? permIcon : js.icon;
  const site = prettyOrigin(dialog.origin);
  const hasChoice = isPermission || dialog.type !== 'alert';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      // Un clic à côté ne répond pas à la place de l'utilisateur : la page
      // attend une réponse, et deviner à sa place serait pire que d'attendre.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md mx-4 rounded-2xl bg-bg-secondary border border-border shadow-2xl overflow-hidden animate-scale-in"
      >
        {/* En-tête : de qui vient la question */}
        <div className="flex items-start gap-3.5 px-5 pt-5 pb-3">
          <div
            className={`w-11 h-11 rounded-xl shrink-0 flex items-center justify-center ${
              isPermission ? 'bg-accent-primary/15 text-accent-primary' : `bg-bg-elevated ${js.accent}`
            }`}
          >
            <Icon size={20} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-[15px] font-semibold text-text-primary leading-tight">
              {isPermission ? t(`perm.title.${known}`) : dialog.appName || t(js.label)}
            </h2>
            {site && (
              <p className="text-xs text-text-muted truncate mt-0.5" title={site}>
                {site}
              </p>
            )}
          </div>
          {!hasChoice && (
            <button
              onClick={accept}
              className="btn-icon w-7 h-7 text-text-muted"
              title={t('dlg.close')}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Corps : le message de la page, ou ce que le site veut faire */}
        <div className="px-5 pb-4">
          {isPermission ? (
            <p className="text-sm text-text-secondary leading-relaxed">
              {t('perm.request', {
                site: site || t('perm.thisSite'),
                verb: t(`perm.verb.${known}`),
              })}
            </p>
          ) : (
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {dialog.message || ''}
            </p>
          )}

          {dialog.type === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('dlg.answerPlaceholder')}
              className="mt-3 w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border
                         text-sm text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-accent-primary transition-colors"
            />
          )}

          {/* Mémoriser la décision — c'est ce qui évite de reposer la question
              à chaque appel visio. */}
          {isPermission && (
            <label className="mt-4 flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 accent-[rgb(var(--accent-primary))] cursor-pointer"
              />
              {t('perm.remember')}
            </label>
          )}

          {/* Page qui s'emballe : la même sortie de secours que dans Chrome */}
          {!isPermission && dialog.offerSilence && (
            <label className="mt-4 flex items-center gap-2.5 text-sm text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={silence}
                onChange={(e) => setSilence(e.target.checked)}
                className="w-4 h-4 accent-[rgb(var(--accent-primary))] cursor-pointer"
              />
              {t('dlg.silence')}
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          {hasChoice && (
            <button onClick={refuse} className="btn btn-secondary">
              {isPermission ? t('perm.block') : t('dlg.cancel')}
            </button>
          )}
          <button ref={okRef} onClick={accept} className="btn btn-primary">
            {isPermission ? (
              <>
                <Check size={15} /> {t('perm.allow')}
              </>
            ) : (
              t('dlg.ok')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
