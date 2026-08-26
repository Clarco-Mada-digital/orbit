import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { useT } from '../../lib/i18n';
import { useZoneHold } from '../../lib/autoHide';
import { useDismiss } from '../../lib/useDismiss';

// Pastille du profil actif dans l'en-tête : d'un coup d'œil on sait si on est
// en « Travail » ou « Perso », et on bascule sans passer par la barre latérale.
export default function ProfileWidget({ placement = 'top', align = 'right-0' }) {
  const t = useT();
  const { profiles, activeProfile, setActiveProfile } = useStore();
  const [open, setOpen] = useState(false);
  // Mode épuré : garde la barre ouverte tant que ce panneau l'est.
  useZoneHold(placement, 'panel', open);
  const ref = useRef(null);
  const current = profiles.find((p) => p.id === activeProfile);

  // Clic ailleurs, Échap, clic DANS une app… : règle commune (lib/useDismiss).
  const closePanel = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, closePanel);

  if (!current) return null;

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 pl-1.5 pr-2 rounded-lg flex items-center gap-1.5 border border-border hover:bg-bg-hover transition-colors ${
          open ? 'bg-bg-hover' : ''
        }`}
        title={t('profile.switch')}
        style={{ borderColor: `${current.color}55` }}
      >
        <span className="text-base leading-none">{current.emoji}</span>
        <span className="text-xs font-medium truncate max-w-[110px]">{current.name}</span>
        <ChevronDown size={13} className="text-text-muted" />
      </button>

      {open && (
        <div className={`absolute ${align} ${placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} w-52 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in py-1`}>
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActiveProfile(p.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <span className="text-lg leading-none">{p.emoji}</span>
              <span className="flex-1 text-left truncate">{p.name}</span>
              {p.id === activeProfile && <Check size={14} className="text-accent-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
