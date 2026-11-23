import { useEffect } from 'react';

// Fenêtre modale des outils développeur. Échap la ferme ELLE (et non l'outil
// entier, que l'overlay ferme aussi sur Échap : il ignore la touche tant
// qu'une modale `data-devtools-modal` est affichée).
export default function Modal({ onClose, children, className = 'max-w-lg' }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div data-devtools-modal className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-full w-full overflow-auto rounded-xl border border-border bg-bg-elevated shadow-2xl ${className}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
