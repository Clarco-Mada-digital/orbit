import { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, DatabaseZap, Eraser, Gauge, PanelBottom, PanelRight, Smartphone, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import {
  isAreaCovered,
  clampDevtoolsHeight,
  clampDevtoolsWidth,
  viewBoundsFromRect,
} from '../lib/devtoolsPanel';

// Inspecteur intégré, sous la page d'une app ou d'une page volante.
//
// Ce composant ne dessine que le CADRE : barre de titre, poignée de
// redimensionnement et une zone vide. Les outils eux-mêmes sont une vue
// native (voir electron/devtools-panel.js) que le processus principal pose
// exactement sur cette zone — on lui renvoie donc le rectangle à chaque
// changement de taille, et on la masque quand elle n'a pas à être vue (app
// cachée, boîte de dialogue ou menu d'Orbit ouvert : une vue native passerait
// par-dessus).

// Taille mémorisée, une par ancrage.
const SIZE_KEYS = { bottom: 'orbit-devtools-height', right: 'orbit-devtools-width' };
// Fermetures différées, par page (voir plus bas).
const pendingClose = new Map();

function readSize(dock) {
  try {
    return Number(localStorage.getItem(SIZE_KEYS[dock])) || undefined;
  } catch {
    return undefined;
  }
}

// `dock` : 'bottom' (sous la page) ou 'right' (à côté). `responsive` : la vue
// responsive est-elle active (le bouton de la barre la bascule).
export default function DevToolsPanel({
  webviewRef,
  visible,
  request,
  onClose,
  dock = 'bottom',
  onDock,
  responsive = false,
  onToggleResponsive,
}) {
  const t = useT();
  const bodyRef = useRef(null);
  const rootRef = useRef(null);
  const horizontal = dock === 'right';
  const clampSize = horizontal ? clampDevtoolsWidth : clampDevtoolsHeight;
  const [sizes, setSizes] = useState(() => ({ bottom: readSize('bottom'), right: readSize('right') }));
  const size = sizes[dock];
  const setSize = (value) => setSizes((current) => ({ ...current, [dock]: value }));
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const wcIdRef = useRef(null);
  const sentInspectRef = useRef(null);

  const wcId = () => {
    try {
      wcIdRef.current = webviewRef.current?.getWebContentsId?.() ?? wcIdRef.current;
    } catch {
      /* webview pas encore prêt */
    }
    return wcIdRef.current;
  };

  // Quelque chose d'Orbit (menu, boîte de dialogue, bulle) recouvre-t-il la
  // zone ? Réévalué au plus une fois par image, à chaque changement du DOM.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const body = bodyRef.current;
      setOverlayOpen(Boolean(body) && isAreaCovered(body, (x, y) => document.elementFromPoint(x, y)));
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const observer = new MutationObserver(later);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Pas `style` : les animations le changent à chaque image, et chaque
      // changement relancerait la sonde. Les menus et boîtes d'Orbit
      // apparaissent par insertion ou changement de classe.
      attributeFilter: ['class', 'hidden', 'open', 'role', 'aria-modal'],
    });
    // Les menus qui apparaissent par transition (opacité) finissent ici.
    document.addEventListener('transitionend', later, true);
    document.addEventListener('animationend', later, true);
    check();
    return () => {
      observer.disconnect();
      document.removeEventListener('transitionend', later, true);
      document.removeEventListener('animationend', later, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Place (ou masque) la vue native.
  const sync = useCallback(() => {
    const id = wcId();
    if (!id) return;
    const api = window.electronAPI;
    if (!visible || overlayOpen || !bodyRef.current) {
      api?.devtoolsHide?.(id);
      return;
    }
    const inspectAt =
      request && sentInspectRef.current !== request.key && Number.isFinite(request.x)
        ? { x: request.x, y: request.y }
        : undefined;
    if (request) sentInspectRef.current = request.key;
    api?.devtoolsShow?.({
      webContentsId: id,
      bounds: viewBoundsFromRect(bodyRef.current.getBoundingClientRect()),
      inspectAt,
    });
    // `wcId` lit une ref : pas une dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, overlayOpen, request]);

  useEffect(() => {
    sync();
    const body = bodyRef.current;
    if (!body) return undefined;
    let frame = 0;
    const later = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    const observer = new ResizeObserver(later);
    observer.observe(body);
    // La zone peut BOUGER sans changer de taille (barre latérale repliée,
    // écran partagé) : la fenêtre redimensionnée et les transitions de mise en
    // page le signalent.
    window.addEventListener('resize', later);
    document.addEventListener('transitionend', later, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', later);
      document.removeEventListener('transitionend', later, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sync, size, dock]);

  // Fermeture du panneau (ou de la page) : on referme les outils — avec un
  // court délai. React peut démonter puis remonter aussitôt le composant (mode
  // strict en développement, déplacement dans l'écran partagé) ; fermer et
  // rouvrir les outils dans la foulée laissait une vue vide, le frontal ne se
  // rechargeant pas. Un remontage immédiat annule donc la fermeture.
  useEffect(() => {
    const id = wcId();
    if (id && pendingClose.has(id)) {
      clearTimeout(pendingClose.get(id));
      pendingClose.delete(id);
    }
    return () => {
      const current = wcIdRef.current;
      if (!current) return;
      pendingClose.set(
        current,
        setTimeout(() => {
          pendingClose.delete(current);
          window.electronAPI?.devtoolsClose?.(current);
        }, 200)
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Place disponible dans la zone de l'app (hauteur ancré en bas, largeur
  // ancré à droite) : mesurée hors rendu (une ref ne se lit pas pendant le
  // rendu), et tenue à jour quand la fenêtre change de taille.
  const [room, setRoom] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => {
      const r = parent.getBoundingClientRect();
      setRoom({ width: r.width || window.innerWidth, height: r.height || window.innerHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const available = () => {
    const r = rootRef.current?.parentElement?.getBoundingClientRect();
    return horizontal ? r?.width || room.width : r?.height || room.height;
  };
  const effectiveSize = clampSize(size, horizontal ? room.width : room.height);

  // Même recette que le séparateur de l'écran partagé (App.jsx) : événements
  // SOURIS sur la fenêtre et voile plein écran pendant le geste — sinon la
  // page (<webview>) avale la souris dès qu'on passe au-dessus.
  const [dragging, setDragging] = useState(false);
  const startResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = horizontal ? event.clientX : event.clientY;
    const startSize = effectiveSize;
    // La vue native avalerait elle aussi les mouvements : on la masque le
    // temps du geste, la zone vide suit le pointeur.
    const id = wcId();
    if (id) window.electronAPI?.devtoolsHide?.(id);
    setDragging(true);
    const at = (e) => clampSize(startSize + (start - (horizontal ? e.clientX : e.clientY)), available());
    const move = (e) => setSize(at(e));
    const up = (e) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      setDragging(false);
      if (e && 'clientX' in e) {
        const next = at(e);
        setSize(next);
        try {
          localStorage.setItem(SIZE_KEYS[dock], String(next));
        } catch {
          /* stockage indisponible */
        }
      }
      requestAnimationFrame(sync);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };

  const lighthouse = async () => {
    const id = wcId();
    if (!id) return;
    const result = await window.electronAPI?.devtoolsLighthouse?.(id);
    setNotice(result?.success ? '' : t('dt.lighthouseFailed'));
  };

  // Nettoyage du site : le cache (sans conséquence), ou TOUTES ses données —
  // ce qui déconnecte du site, d'où la confirmation.
  const clearSite = async (what) => {
    const id = wcId();
    if (!id) return;
    if (what === 'data' && !window.confirm(t('dt.clearDataConfirm'))) return;
    const result = await window.electronAPI?.devtoolsClearSite?.(id, what);
    setNotice(result?.success ? t(what === 'data' ? 'dt.clearedData' : 'dt.clearedCache') : t('dt.clearFailed'));
    setTimeout(() => setNotice(''), 3000);
  };

  const toolButton = 'btn btn-ghost btn-sm h-6 px-2 text-xs';
  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col flex-shrink-0 bg-bg-secondary ${horizontal ? 'border-l' : 'border-t'} border-border`}
      style={horizontal ? { width: effectiveSize } : { height: effectiveSize }}
    >
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={t('dt.resize')}
        onMouseDown={startResize}
        className={
          horizontal
            ? 'absolute inset-y-0 -left-1 w-1.5 z-10 cursor-col-resize hover:bg-accent-primary/40'
            : 'absolute inset-x-0 -top-1 h-1.5 z-10 cursor-row-resize hover:bg-accent-primary/40'
        }
      />
      <div className="flex items-center gap-1 px-2 h-8 text-xs text-text-secondary">
        <Bug size={13} className="text-text-muted" />
        <span className="font-medium mr-1">{t('dt.title')}</span>
        {notice && <span className="text-warning truncate">{notice}</span>}
        <span className="flex-1" />
        <button
          type="button"
          className={`${toolButton} ${responsive ? 'text-accent-primary bg-accent-primary/10' : ''}`}
          onClick={onToggleResponsive}
          title={t('dt.responsiveHint')}
          aria-pressed={responsive}
        >
          <Smartphone size={13} /> {!horizontal || effectiveSize > 420 ? t('dt.responsive') : null}
        </button>
        <button type="button" className={toolButton} onClick={lighthouse} title={t('dt.lighthouseHint')}>
          <Gauge size={13} /> {!horizontal || effectiveSize > 420 ? 'Lighthouse' : null}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-6 w-6 p-0"
          onClick={() => clearSite('cache')}
          title={t('dt.clearCache')}
          aria-label={t('dt.clearCache')}
        >
          <Eraser size={14} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-6 w-6 p-0"
          onClick={() => clearSite('data')}
          title={t('dt.clearData')}
          aria-label={t('dt.clearData')}
        >
          <DatabaseZap size={14} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-6 w-6 p-0"
          onClick={() => onDock?.(horizontal ? 'bottom' : 'right')}
          title={horizontal ? t('dt.dockBottom') : t('dt.dockRight')}
          aria-label={horizontal ? t('dt.dockBottom') : t('dt.dockRight')}
        >
          {horizontal ? <PanelBottom size={14} /> : <PanelRight size={14} />}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-6 w-6 p-0"
          onClick={onClose}
          title={t('dt.close')}
          aria-label={t('dt.close')}
        >
          <X size={14} />
        </button>
      </div>
      {dragging && (
        <div className="fixed inset-0 z-[9999]" style={{ cursor: horizontal ? 'col-resize' : 'row-resize' }} />
      )}
      {/* Zone où la vue native des outils est posée. */}
      <div ref={bodyRef} className="flex-1 min-h-0" style={{ background: '#202124' }} />
    </div>
  );
}
