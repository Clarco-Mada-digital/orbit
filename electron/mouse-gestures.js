// ---------------------------------------------------------------------------
// Souris : défilement automatique (clic molette) et boutons précédent/suivant
//
// Chrome fait les deux lui-même, dans son interface. Electron, non : ni le
// défilement automatique, ni les boutons latéraux de la souris ne font rien
// dans un <webview>. (L'ancienne écoute de `app-command` sur le webContents ne
// pouvait pas marcher : Electron n'émet cet événement que sur une
// BrowserWindow, et seulement sous Windows et Linux.)
//
// On injecte donc un petit script, le même partout :
//   • dans chaque page (<webview> et fenêtres détachées), dans un MONDE ISOLÉ :
//     les scripts du site ne le voient pas et ne peuvent pas l'appeler ;
//   • dans l'interface d'Orbit (accueil, réglages, visionneuse…).
// Il lit les événements DOM de la souris, ce qui marche à l'identique sous
// Windows, Linux et macOS (boutons 4/5 = `button` 3/4 côté DOM).
//
// Défilement automatique, comme Chrome sous Windows :
//   • clic molette sur une zone qui défile → un repère apparaît ;
//   • on éloigne la souris du repère : la page défile dans cette direction, de
//     plus en plus vite avec la distance (vertical ET horizontal) ;
//   • molette maintenue puis relâchée après un mouvement → on s'arrête en
//     relâchant ; simple clic → le mode reste actif jusqu'au clic suivant,
//     une touche ou un coup de molette.
// Jamais sur un lien (clic molette = ouvrir à part), un champ de saisie ou
// une zone éditable : là, le clic molette garde son rôle habituel.
//
// L'extension « Souris & Défilement » a son propre défilement automatique :
// le script pose `data-orbit-autoscroll` sur <html> pour qu'elle s'efface.
// ---------------------------------------------------------------------------

// Monde isolé réservé (les extensions et preloads utilisent d'autres ids).
const WORLD_ID = 1207;

const enabled = { autoScroll: true, mouseNav: true };

// `host` : 'page' (navigation dans l'historique de la page elle-même) ou
// 'ui' (interface d'Orbit : l'événement est relayé à l'app affichée).
export function gestureScript(host, opts = enabled) {
  const cfg = JSON.stringify({ host, autoScroll: opts.autoScroll !== false, mouseNav: opts.mouseNav !== false });
  return `(() => {
  const cfg = ${cfg};
  const prev = window.__orbitMouse;
  if (prev) { prev.configure(cfg); return; }

  const state = { cfg, auto: null, lastNav: 0, swallow: false };
  const root = () => document.documentElement;
  const mark = () => { try { if (root()) root().toggleAttribute('data-orbit-autoscroll', state.cfg.autoScroll); } catch (e) {} };

  // --- Précédent / suivant ------------------------------------------------
  const nav = (dir) => {
    const now = Date.now();
    if (now - state.lastNav < 250) return;
    state.lastNav = now;
    if (state.cfg.host === 'ui') {
      window.dispatchEvent(new CustomEvent('orbit:mouse-nav', { detail: dir }));
    } else if (dir === 'back') {
      history.back();
    } else {
      history.forward();
    }
  };
  // mouseup : c'est là que Chrome navigue. On bloque aussi mousedown/auxclick
  // pour qu'aucune page ne reçoive un clic fantôme.
  const navButton = (e) => (e.button === 3 ? 'back' : e.button === 4 ? 'forward' : null);
  window.addEventListener('mouseup', (e) => {
    const dir = state.cfg.mouseNav && navButton(e);
    if (!dir) return;
    e.preventDefault();
    nav(dir);
  }, true);

  // --- Défilement automatique ---------------------------------------------
  const canScroll = (el, axis) => {
    const doc = document.scrollingElement || root();
    if (el === doc) {
      return axis === 'y' ? doc.scrollHeight > innerHeight + 1 : doc.scrollWidth > innerWidth + 1;
    }
    const s = getComputedStyle(el);
    const ov = axis === 'y' ? s.overflowY : s.overflowX;
    if (!/(auto|scroll|overlay)/.test(ov)) return false;
    return axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
  };
  const scroller = (node) => {
    const doc = document.scrollingElement || root();
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== document.body && el !== root()) {
      if (canScroll(el, 'y') || canScroll(el, 'x')) return el;
      el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    }
    return canScroll(doc, 'y') || canScroll(doc, 'x') ? doc : null;
  };
  const excluded = (t) => {
    const el = t && t.nodeType === 1 ? t : t && t.parentElement;
    if (!el || !el.closest) return true;
    return Boolean(el.closest('a[href], input, textarea, select, button, [contenteditable=""], [contenteditable="true"], video, audio, canvas, iframe, embed, object'));
  };
  const markerFor = (x, y, both) => {
    const m = document.createElement('div');
    m.setAttribute('aria-hidden', 'true');
    m.style.cssText = 'position:fixed;left:' + (x - 14) + 'px;top:' + (y - 14) + 'px;width:28px;height:28px;border-radius:50%;'
      + 'background:rgba(15,23,42,.55);border:1.5px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.35);'
      + 'pointer-events:none;z-index:2147483647;display:flex;align-items:center;justify-content:center;'
      + 'color:#fff;font:10px/1 system-ui,sans-serif;backdrop-filter:blur(2px)';
    m.textContent = both ? '\\u2725' : '\\u2195';
    (document.body || root()).appendChild(m);
    return m;
  };
  // Vitesse : zone morte de 12 px, puis accélération douce, plafonnée.
  const speed = (d) => {
    const a = Math.abs(d);
    if (a <= 12) return 0;
    return Math.sign(d) * Math.min(60, Math.pow((a - 12) / 10, 1.35) * 1.6);
  };
  const stop = () => {
    const a = state.auto;
    if (!a) return;
    state.auto = null;
    cancelAnimationFrame(a.frame);
    if (a.marker && a.marker.parentNode) a.marker.parentNode.removeChild(a.marker);
    root() && (root().style.cursor = a.cursor);
  };
  const start = (e, el) => {
    const both = canScroll(el, 'x') && canScroll(el, 'y');
    const a = {
      el, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY,
      moved: false, sticky: false, frame: 0,
      marker: markerFor(e.clientX, e.clientY, both),
      cursor: root().style.cursor,
    };
    root().style.cursor = 'all-scroll';
    const tick = () => {
      if (state.auto !== a) return;
      const vx = canScroll(a.el, 'x') ? speed(a.x - a.ox) : 0;
      const vy = canScroll(a.el, 'y') ? speed(a.y - a.oy) : 0;
      if (vx || vy) a.el.scrollBy(vx, vy);
      a.frame = requestAnimationFrame(tick);
    };
    a.frame = requestAnimationFrame(tick);
    state.auto = a;
  };

  window.addEventListener('mousedown', (e) => {
    if (state.auto) {
      // Mode « collant » : n'importe quel clic l'arrête, sans rien déclencher.
      // Le clic qui suit (click / auxclick) est avalé lui aussi.
      if (state.auto.sticky) { e.preventDefault(); e.stopPropagation(); state.swallow = true; stop(); }
      return;
    }
    if (!state.cfg.autoScroll || e.button !== 1 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
    if (e.defaultPrevented || excluded(e.target)) return;
    const el = scroller(e.target);
    if (!el) return;
    // Empêche le collage du presse-papiers X11 (Linux) et le défilement natif.
    e.preventDefault();
    start(e, el);
  }, true);
  window.addEventListener('mousemove', (e) => {
    const a = state.auto;
    if (!a) return;
    a.x = e.clientX; a.y = e.clientY;
    if (!a.moved && Math.hypot(a.x - a.ox, a.y - a.oy) > 6) a.moved = true;
  }, true);
  window.addEventListener('mouseup', (e) => {
    const a = state.auto;
    if (!a || e.button !== 1) return;
    e.preventDefault();
    // Maintenu puis déplacé → on relâche, on s'arrête. Sinon : mode collant.
    if (a.moved) stop(); else a.sticky = true;
  }, true);
  // Le clic molette de fin ne doit rien ouvrir ni coller, et le clic qui
  // arrête le mode collant ne doit rien activer.
  const swallow = (e) => {
    if (state.swallow || (e.button === 1 && state.auto)) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    }
    if (e.type === 'auxclick' && (e.button === 3 || e.button === 4)) e.preventDefault();
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('auxclick', swallow, true);
  window.addEventListener('mouseup', (e) => {
    if (state.swallow) { e.preventDefault(); e.stopPropagation(); setTimeout(() => { state.swallow = false; }, 0); }
  }, true);
  window.addEventListener('keydown', (e) => { if (state.auto) { if (e.key === 'Escape') e.preventDefault(); stop(); } }, true);
  window.addEventListener('wheel', () => stop(), { capture: true, passive: true });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

  window.__orbitMouse = {
    configure(next) { state.cfg = next; if (!next.autoScroll) stop(); mark(); },
  };
  Object.defineProperty(window, '__orbitMouse', { enumerable: false });
  mark();
})();`;
}

const tracked = new Map(); // webContents → 'page' | 'ui'

function inject(contents, host) {
  if (!contents || contents.isDestroyed()) return;
  const code = gestureScript(host, enabled);
  const run =
    host === 'ui'
      ? contents.executeJavaScript(code, false)
      : contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }], false);
  Promise.resolve(run).catch(() => {
    /* page en cours de fermeture ou de navigation : le prochain dom-ready s'en charge */
  });
}

// `host` : 'page' pour une page web, 'ui' pour l'interface d'Orbit.
export function attach(contents, host = 'page') {
  if (!contents || tracked.has(contents)) return;
  tracked.set(contents, host);
  contents.on('dom-ready', () => inject(contents, host));
  contents.once('destroyed', () => tracked.delete(contents));
}

// Réglages venant de l'interface : { autoScroll, mouseNav }.
export function configure({ autoScroll, mouseNav } = {}) {
  const next = { autoScroll: autoScroll !== false, mouseNav: mouseNav !== false };
  if (next.autoScroll === enabled.autoScroll && next.mouseNav === enabled.mouseNav) return;
  Object.assign(enabled, next);
  for (const [contents, host] of tracked) inject(contents, host);
}
