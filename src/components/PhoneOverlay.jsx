import { Suspense, lazy, useEffect } from 'react';
import { usePhoneStore } from '../lib/phoneStore';
import { useStore } from '../stores/useStore';

const PhoneApp = lazy(() => import('./PhoneApp'));

// Panneau Téléphone : l'extension fournit un bouton de barre, pas une app du
// sidebar. Le panneau recouvre la zone de travail (l'écran du téléphone prend
// toute la place disponible) et se ferme par Échap, par sa croix, ou en
// cliquant à l'extérieur du panneau.
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
      className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-label="Téléphone"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-bg-primary m-2 rounded-2xl shadow-2xl sm:m-4">
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
