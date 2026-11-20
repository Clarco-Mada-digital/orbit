import { useEffect, useRef, useState } from 'react';
import { Columns2, Rows2, Maximize2 } from 'lucide-react';
import { useT } from '../lib/i18n';
import { dropZoneAt, previewRect } from '../lib/splitDrop';

// ---------------------------------------------------------------------------
// Voile de dépôt pour l'écran partagé (voir lib/splitDrop.js).
//
// Il n'existe que pendant un glisser : une app ou un lien libre attrapé dans
// la barre latérale (événements `orbit:app-drag` / `orbit:app-drag-end`), ou
// un lien venu d'ailleurs (`text/uri-list`). Il se pose AU-DESSUS des
// <webview> — sans lui, ce sont eux qui avaleraient le survol et le dépôt.
// ---------------------------------------------------------------------------
export const ORBIT_APP_MIME = 'application/x-orbit-app';

export function startAppDrag(event, appId) {
  try {
    event.dataTransfer.setData(ORBIT_APP_MIME, appId);
  } catch {
    /* certains moteurs refusent un type personnalisé : l'événement suffit */
  }
  window.dispatchEvent(new CustomEvent('orbit:app-drag', { detail: { id: appId } }));
}

export function endAppDrag() {
  window.dispatchEvent(new Event('orbit:app-drag-end'));
}

const ZONE_ICON = { left: Columns2, right: Columns2, top: Rows2, bottom: Rows2, center: Maximize2 };

export default function SplitDropOverlay({ enabled, splitActive, onDrop }) {
  const t = useT();
  const ref = useRef(null);
  // { kind: 'app', id } | { kind: 'url' } | null
  const [drag, setDrag] = useState(null);
  const [zone, setZone] = useState(null);

  useEffect(() => {
    const onStart = (e) => setDrag({ kind: 'app', id: e.detail?.id });
    const onEnd = () => {
      setDrag(null);
      setZone(null);
    };
    // Lien glissé depuis l'extérieur (navigateur, gestionnaire de fichiers) :
    // on ne le voit qu'à son entrée dans la fenêtre.
    const onEnter = (e) => {
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes(ORBIT_APP_MIME)) return;
      if (types.includes('text/uri-list')) setDrag((d) => d || { kind: 'url' });
    };
    const onLeaveWindow = (e) => {
      // Sortie de la fenêtre (pas un passage d'un élément à l'autre).
      if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 ||
        e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
        setDrag((d) => (d?.kind === 'url' ? null : d));
        setZone(null);
      }
    };
    window.addEventListener('orbit:app-drag', onStart);
    window.addEventListener('orbit:app-drag-end', onEnd);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeaveWindow);
    window.addEventListener('drop', onEnd);
    return () => {
      window.removeEventListener('orbit:app-drag', onStart);
      window.removeEventListener('orbit:app-drag-end', onEnd);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeaveWindow);
      window.removeEventListener('drop', onEnd);
    };
  }, []);

  if (!enabled || !drag) return null;

  const locate = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    return dropZoneAt(e.clientX, e.clientY, rect);
  };

  const handleOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.kind === 'url' ? 'copy' : 'move';
    const z = locate(e);
    if (z !== zone) setZone(z);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const z = locate(e);
    const appId = drag.kind === 'app'
      ? drag.id || e.dataTransfer.getData(ORBIT_APP_MIME)
      : null;
    let url = null;
    if (!appId) {
      const list = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      url = String(list || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#') && /^https?:\/\//i.test(l)) || null;
    }
    setDrag(null);
    setZone(null);
    if (appId || url) onDrop({ appId, url, zone: z });
  };

  const box = zone ? previewRect(zone) : null;
  const Icon = zone ? ZONE_ICON[zone] : null;
  const label = zone
    ? zone === 'center'
      ? splitActive
        ? t('split.dropReplace')
        : t('split.dropOpen')
      : t(`split.drop.${zone}`)
    : t('split.dropHint');

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[60]"
      onDragOver={handleOver}
      onDragEnter={handleOver}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget)) setZone(null);
      }}
      onDrop={handleDrop}
    >
      <div className="absolute inset-0 bg-black/20 pointer-events-none" />
      {box && (
        <div
          className="absolute pointer-events-none p-2 transition-all duration-150 ease-out"
          style={{
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          }}
        >
          <div className="w-full h-full rounded-xl border-2 border-accent-primary bg-accent-primary/15 shadow-[inset_0_0_40px_rgb(var(--accent-primary)/0.25)]" />
        </div>
      )}
      <div className="absolute left-1/2 top-6 -translate-x-1/2 pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-elevated border border-border shadow-lg text-xs font-medium">
          {Icon && <Icon size={14} className="text-accent-primary" />}
          {label}
        </div>
      </div>
    </div>
  );
}
