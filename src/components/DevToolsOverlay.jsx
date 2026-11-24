import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useDevToolsStore } from '../lib/devToolsStore';
import { useStore } from '../stores/useStore';

// Modificateur des raccourcis d'Orbit (voir src/lib/shortcuts.js).
const MOD = /mac/i.test(navigator.platform || '') ? '⌘' : 'Alt';

const DatabaseApp = lazy(() => import('./devtools/DatabaseApp'));
const ApiApp = lazy(() => import('./devtools/ApiApp'));

// Espace de travail des outils développeur : il occupe la zone de contenu
// d'Orbit, comme le Téléphone. Chaque outil n'est téléchargé par le renderer
// qu'à sa première ouverture, et seulement si son extension est installée.
//
// Zoom : Ctrl/⌘ + molette, ou les raccourcis de zoom d'Orbit (Alt + / − / 0,
// ⌘ sur macOS),
// mémorisé par outil. Un indicateur n'apparaît que hors de 100 %.
export default function DevToolsOverlay() {
  const open = useDevToolsStore((s) => s.open);
  const zoom = useDevToolsStore((s) => (s.open ? s.zoom?.[s.open] || 1 : 1));
  const setZoom = useDevToolsStore((s) => s.setZoom);
  const nativeApps = useStore((s) => s.nativeApps);
  const available = Array.isArray(nativeApps) && open && nativeApps.includes(open);
  const close = () => useDevToolsStore.getState().setOpen(null);
  const root = useRef(null);
  const [flash, setFlash] = useState(false);

  // Extension retirée pendant que l'outil était ouvert : on le referme.
  useEffect(() => {
    if (open && !available) useDevToolsStore.getState().setOpen(null);
  }, [open, available]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // Échap ferme l'outil, sauf quand une boîte (connexion, import…) est
      // ouverte ou qu'on édite un champ : elle gère sa propre fermeture.
      if (e.key !== 'Escape') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('[data-devtools-modal]')) return;
      useDevToolsStore.getState().setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Ctrl + molette. Écouteur natif non passif : React enregistre `onWheel`
  // en passif, ce qui interdit `preventDefault` (la page défilerait aussi).
  // Le diagramme du schéma garde la molette pour son propre zoom.
  useEffect(() => {
    const el = root.current;
    if (!el || !open) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented) return;
      if (e.target.closest?.('[data-own-zoom]')) return;
      e.preventDefault();
      setZoom(open, e.deltaY < 0 ? 'zoom-in' : 'zoom-out');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, available, setZoom]);

  // Indicateur bref à chaque changement de zoom.
  useEffect(() => {
    if (!open) return undefined;
    const on = setTimeout(() => setFlash(true), 0);
    const off = setTimeout(() => setFlash(false), 1200);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [zoom, open]);

  if (!available) return null;

  return (
    <div ref={root} className="absolute inset-0 z-40 flex min-h-0 flex-col bg-bg-primary" role="main">
      {/* `zoom` CSS : tout l'outil grandit ou rétrécit, mise en page comprise
          (un `transform: scale` laisserait des zones vides ou tronquées). */}
      <div className="flex min-h-0 flex-1 flex-col" style={{ zoom }}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 text-sm text-text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent-primary" />
              Ouverture…
            </div>
          }
        >
          {/* Collections, environnements et historiques vivent dans des stores
              persistés : passer d'un outil à l'autre ne perd que les onglets. */}
          {open === 'database' ? <DatabaseApp onClose={close} /> : <ApiApp onClose={close} />}
        </Suspense>
      </div>
      {zoom !== 1 || flash ? (
        <div
          className={`pointer-events-auto absolute bottom-3 right-3 z-50 flex items-center gap-0.5 rounded-full border border-border bg-bg-elevated/95 px-1 py-0.5 text-xs shadow-lg transition-opacity ${zoom === 1 && !flash ? 'opacity-0' : 'opacity-100'}`}
        >
          <button className="btn-icon h-6 w-6" onClick={() => setZoom(open, 'zoom-out')} title={`Zoom arrière (${MOD} −) — ou Ctrl + molette`}>
            <Minus size={12} />
          </button>
          <button className="min-w-[3rem] rounded px-1 py-0.5 font-medium hover:bg-bg-hover" onClick={() => setZoom(open, 'zoom-reset')} title={`Revenir à 100 % (${MOD} 0)`}>
            {Math.round(zoom * 100)} %
          </button>
          <button className="btn-icon h-6 w-6" onClick={() => setZoom(open, 'zoom-in')} title={`Zoom avant (${MOD} +) — ou Ctrl + molette`}>
            <Plus size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
