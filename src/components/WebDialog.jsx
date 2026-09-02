import { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  HelpCircle,
  Keyboard,
  Camera,
  Mic,
  MapPin,
  Bell,
  Share2,
  X,
  Check,
} from 'lucide-react';

/**
 * Modal élégant pour les dialogues JS (alert/confirm/prompt) émis par
 * le contenu des webviews.  Le webview émet un événement 'dialog' quand
 * une page exécute alert(), confirm() ou prompt().  Sans handler, la page
 * est bloquée indéfiniment.
 *
 * Props :
 *   dialog — { type, message, defaultText, checkboxChecked, callback }
 *            ou null quand aucun dialogue n'est ouvert.
 *   onResolve — (value) → résout le dialogue et le referme.
 */

/* ---------- icônes par type ---------- */
const TYPE_CONFIG = {
  alert: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning/10', label: 'Information' },
  confirm: { icon: HelpCircle, color: 'text-primary', bg: 'bg-primary/10', label: 'Confirmation' },
  prompt: { icon: Keyboard, color: 'text-primary', bg: 'bg-primary/10', label: 'Saisie' },
  permission: { icon: Camera, color: 'text-accent', bg: 'bg-accent/10', label: 'Autorisation' },
};

const PERM_ICONS = {
  media: Camera,
  geolocation: MapPin,
  notifications: Bell,
  'display-capture': Share2,
  microphone: Mic,
  camera: Camera,
};

export default function WebDialog({ dialog, onResolve }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (dialog) {
      setInputValue(dialog.defaultText || '');
      // Focus le champ après le rendu
      setTimeout(() => {
        if (dialog.type === 'prompt') {
          inputRef.current?.focus();
          inputRef.current?.select();
        } else {
          dialogRef.current?.querySelector('button')?.focus();
        }
      }, 50);
    }
  }, [dialog]);

  /* --- raccourcis clavier --- */
  const handleKeyDown = useCallback(
    (e) => {
      if (!dialog) return;
      if (e.key === 'Enter' && dialog.type === 'prompt') {
        e.preventDefault();
        onResolve(inputValue);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve(dialog.type === 'prompt' ? null : false);
      }
    },
    [dialog, inputValue, onResolve]
  );

  useEffect(() => {
    if (!dialog) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, handleKeyDown]);

  if (!dialog) return null;

  const isPermission = dialog.type === 'permission';
  const config = TYPE_CONFIG[dialog.type] || TYPE_CONFIG.alert;
  const Icon = isPermission
    ? PERM_ICONS[dialog.permissionType] || Camera
    : config.icon;

  /* --- Permission labels --- */
  const permLabel = {
    media: { label: 'Caméra / Microphone', desc: 'Accéder à votre caméra et microphone' },
    geolocation: { label: 'Position', desc: 'Connaître votre position géographique' },
    notifications: { label: 'Notifications', desc: 'Envoyer des notifications push' },
    'display-capture': { label: 'Partage d\'écran', desc: 'Capturer le contenu de votre écran' },
    microphone: { label: 'Microphone', desc: 'Accéder à votre microphone' },
    camera: { label: 'Caméra', desc: 'Accéder à votre caméra' },
  };
  const permInfo = permLabel[dialog.permissionType] || {
    label: dialog.permissionType || 'Ressource',
    desc: 'Accéder à une ressource système',
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => {
        // Fermer uniquement les alertes (pas confirm/prompt) au clic extérieur
        if (e.target === e.currentTarget && dialog.type === 'alert') {
          onResolve(undefined);
        }
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md mx-4 rounded-2xl border border-border-base/60 shadow-2xl overflow-hidden animate-in"
        style={{
          backgroundColor: 'var(--color-bg-surface, #1a1b2e)',
          animation: 'dialogSlideIn 0.2s ease-out',
        }}
      >
        {/* --- Header --- */}
        <div className="flex items-start gap-3 p-5 pb-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${config.bg}`}
          >
            <Icon size={20} className={config.color} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
              {isPermission ? permInfo.label : config.label}
            </p>
            {isPermission && dialog.origin && (
              <p className="text-[11px] text-text-muted/70 truncate mb-1">
                {dialog.origin}
              </p>
            )}
          </div>
          {dialog.type === 'alert' && (
            <button
              onClick={() => onResolve(undefined)}
              className="p-1 rounded-lg hover:bg-white/5 text-text-muted/50 hover:text-text-muted transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* --- Body --- */}
        <div className="px-5 pb-4">
          <p className="text-sm text-text-base leading-relaxed whitespace-pre-wrap break-words">
            {isPermission ? permInfo.desc : dialog.message}
          </p>

          {/* Champ de saisie pour prompt */}
          {dialog.type === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="mt-3 w-full px-3 py-2.5 rounded-xl bg-bg-base/80 border border-border-base/50
                         text-sm text-text-base placeholder:text-text-muted/40
                         focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
                         transition-colors"
              placeholder="Saisissez votre réponse…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onResolve(inputValue);
                }
                e.stopPropagation();
              }}
            />
          )}
        </div>

        {/* --- Actions --- */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
          {isPermission ? (
            <>
              <button
                onClick={() => onResolve(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-text-muted
                           hover:bg-white/5 border border-border-base/40 transition-colors"
              >
                Refuser
              </button>
              <button
                onClick={() => onResolve(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white
                           bg-gradient-to-r from-primary to-accent
                           hover:opacity-90 transition-opacity shadow-lg shadow-primary/20
                           flex items-center gap-1.5"
              >
                <Check size={14} />
                Autoriser
              </button>
            </>
          ) : dialog.type === 'confirm' ? (
            <>
              <button
                onClick={() => onResolve(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-text-muted
                           hover:bg-white/5 border border-border-base/40 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => onResolve(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white
                           bg-gradient-to-r from-primary to-accent
                           hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
              >
                OK
              </button>
            </>
          ) : (
            <button
              onClick={() => onResolve(undefined)}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white
                         bg-gradient-to-r from-primary to-accent
                         hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
            >
              OK
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes dialogSlideIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
