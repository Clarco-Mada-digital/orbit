import { Suspense, lazy, useEffect } from 'react';
import { usePhoneStore } from '../lib/phoneStore';
import { useStore } from '../stores/useStore';

const PhoneApp = lazy(() => import('./PhoneApp'));

// Espace de travail Téléphone : il occupe la zone de contenu d'Orbit sous les
// barres et à côté de la sidebar. Le miroir natif reste une fenêtre distincte.
export default function PhoneOverlay() {
  const close = () => usePhoneStore.getState().setOpen(false);
  const open = usePhoneStore((s) => s.open);
  const available = useStore((s) => Array.isArray(s.nativeApps) && s.nativeApps.includes('phone'));

  // L'extension a été retirée/désactivée pendant que le panneau était ouvert :
  // on le referme au lieu d'afficher une app native sans pont derrière.
  useEffect(() => {
    if (!available) usePhoneStore.getState().setOpen(false);
  }, [available]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex min-h-0 flex-col bg-bg-primary"
      role="main"
      aria-label="Téléphone"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent-primary" />
              Ouverture du Téléphone…
            </div>
          }
        >
          <PhoneApp visible onClose={close} />
        </Suspense>
      </div>
    </div>
  );
}
