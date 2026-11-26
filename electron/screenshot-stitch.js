// ---------------------------------------------------------------------------
// Capture « page entière » par DÉFILEMENT ET ASSEMBLAGE — logique pure.
//
// Pourquoi pas le protocole DevTools (captureBeyondViewport) ? Mesuré sur des
// pages réelles dans un <webview> :
//   • une appli web dont le contenu défile dans un CONTENEUR (Gmail, Notion,
//     tableaux de bord…) n'a pas de « page » plus haute que l'écran : la
//     capture rendait l'écran visible, le reste du contenu était coupé ;
//   • une page longue s'arrêtait net à 16 384 px (plafond de surface).
// On fait donc comme un humain : on fait défiler l'élément qui défile, on
// capture chaque écran, et on recolle les morceaux ici, ligne par ligne.
//
// Aucune dépendance (ni electron, ni canvas) : les images sont des tampons
// bruts de 4 octets par pixel (`nativeImage.toBitmap()`), dans l'ordre de la
// plateforme — on ne fait que déplacer des lignes, l'ordre des canaux est
// donc indifférent. Vérifié par `node --test`.
// ---------------------------------------------------------------------------

// Hauteur maximale de l'image produite, en pixels. Au-delà, l'éditeur de
// capture (un <canvas>) ne peut plus l'afficher.
export const STITCH_MAX_HEIGHT = 32000;
// Surface maximale (pixels) : une page peut annoncer une hauteur démesurée,
// et un écran dense double la largeur. 50 millions de pixels ≈ 200 Mo en
// mémoire pour l'assemblage — au-delà, la capture s'arrête plus tôt.
export const STITCH_MAX_PIXELS = 50_000_000;
export const STITCH_MAX_STEPS = 200;

// Positions de défilement successives (en points) pour couvrir `scrollHeight`
// avec une fenêtre de `clientHeight`. La dernière position colle au bas : les
// deux derniers écrans se chevauchent, l'assemblage ne garde que le neuf.
export function scrollPositions({ scrollHeight, clientHeight, maxContent = Infinity, maxSteps = STITCH_MAX_STEPS }) {
  const view = Math.max(1, Math.floor(Number(clientHeight) || 0));
  const total = Math.max(view, Math.min(Math.floor(Number(scrollHeight) || 0), Math.floor(maxContent)));
  const last = total - view;
  const positions = [0];
  // Un léger recouvrement : une ligne coupée pile au bord d'un écran ne
  // laisse pas de couture visible si l'arrondi tombe d'un pixel à côté.
  const step = Math.max(1, view - 2);
  for (let top = step; top < last && positions.length < maxSteps; top += step) positions.push(top);
  if (last > 0 && positions[positions.length - 1] !== last && positions.length < maxSteps) positions.push(last);
  return positions;
}

// Contenu réellement couvert par une suite de positions (le défilement peut
// s'arrêter plus tôt que prévu : la page l'a borné, ou le plafond est atteint).
export function coveredContent(positions, clientHeight) {
  if (!positions.length) return 0;
  return Math.max(...positions) + clientHeight;
}

function blit(dst, dstW, dstH, src, srcW, srcH, { sx = 0, sy = 0, w, h, dx = 0, dy = 0 }) {
  const width = Math.min(w ?? srcW, srcW - sx, dstW - dx);
  const height = Math.min(h ?? srcH, srcH - sy, dstH - dy);
  if (width <= 0 || height <= 0 || sx < 0 || sy < 0 || dx < 0 || dy < 0) return;
  for (let row = 0; row < height; row += 1) {
    const from = ((sy + row) * srcW + sx) * 4;
    const to = ((dy + row) * dstW + dx) * 4;
    src.copy(dst, to, from, from + width * 4);
  }
}

// Assemble l'image finale.
//
//   first    : capture de la zone visible ENTIÈRE, défilement à 0
//              { data: Buffer, width, height } (pixels réels)
//   segments : captures du seul rectangle de l'élément qui défile, pour les
//              positions suivantes : [{ data, width, height, top }] (top en points)
//   layout   : en points — viewW, viewH, rect {x, y, w, h} de l'élément qui
//              défile dans la zone visible, `content` = hauteur de contenu
//              couverte. `background` : [b0, b1, b2, b3], ce qui resterait
//              vide malgré tout (filet de sécurité).
//
// Ce qui entoure l'élément qui défile (en-tête, barre latérale, pied) est pris
// UNE fois, sur la première capture ; le contenu qui défile est déroulé en
// dessous de son premier écran ; le pied éventuel est replacé tout en bas.
export function composeStitched({ first, segments = [], layout, background = [255, 255, 255, 255], maxHeight = STITCH_MAX_HEIGHT }) {
  const { viewW, viewH, rect } = layout;
  const scale = first.width / Math.max(1, viewW);
  const px = (v) => Math.round(v * scale);
  const content = Math.max(rect.h, layout.content);
  const extra = content - rect.h;
  const width = first.width;
  const cap = Math.min(maxHeight, Math.floor(STITCH_MAX_PIXELS / Math.max(1, width)));
  const height = Math.min(cap, px(viewH + extra));
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = background[3];
  }

  // 1. Tout ce qui est au-dessus du bas de l'élément, tel qu'à l'écran.
  const rectBottom = px(rect.y + rect.h);
  blit(data, width, height, first.data, first.width, first.height, { h: rectBottom });

  // 1 bis. Sous le premier écran, à côté du contenu déroulé (barre latérale,
  // barre de défilement du conteneur), il n'existe rien à capturer. Plutôt
  // qu'une couleur devinée, on PROLONGE la dernière ligne visible de chaque
  // colonne : une barre latérale garde son fond, un fond sombre reste sombre.
  // Le contenu déroulé vient ensuite par-dessus, dans ses propres colonnes.
  if (rectBottom > 0 && rectBottom <= first.height) {
    const last = (rectBottom - 1) * first.width * 4;
    const rowBytes = Math.min(width, first.width) * 4;
    const end = Math.min(height, px(rect.y + content));
    for (let y = rectBottom; y < end; y += 1) first.data.copy(data, y * width * 4, last, last + rowBytes);
  }

  // 2. Le contenu qui défile, écran après écran, sans recouvrement.
  let covered = rect.h; // contenu déjà présent (premier écran)
  for (const seg of segments) {
    const segBottom = seg.top + rect.h;
    if (segBottom <= covered) continue;
    const skip = covered - seg.top; // lignes déjà présentes en haut du morceau
    blit(data, width, height, seg.data, seg.width, seg.height, {
      sy: px(skip),
      h: px(segBottom) - px(covered),
      dx: px(rect.x),
      dy: px(rect.y + covered),
    });
    covered = segBottom;
  }

  // 3. Ce qui est sous l'élément à l'écran (pied de page fixe), tout en bas.
  const footer = px(viewH) - rectBottom;
  if (footer > 0) {
    blit(data, width, height, first.data, first.width, first.height, {
      sy: rectBottom,
      h: footer,
      dy: px(rect.y + content),
    });
  }
  return { data, width, height, truncated: px(viewH + extra) > cap };
}

// Script injecté dans la page : trouve ce qui défile, et installe de quoi le
// faire défiler pendant la capture. Tout est en pixels CSS ; le processus
// principal convertit en points (zoom de la page).
export const STITCH_SETUP_JS = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  // Deux zones à ne pas confondre (mesuré : les confondre décalait chaque
  // couture de 8 px et faussait l'échelle) :
  //   • viewW × viewH : ce que capture capturePage(), barres de défilement
  //     COMPRISES (innerWidth / innerHeight) ;
  //   • rect : ce qui défile réellement, SANS ses barres (clientWidth/Height).
  const viewW = innerWidth;
  const viewH = innerHeight;
  const docW = document.documentElement.clientWidth || viewW;
  const docH = document.documentElement.clientHeight || viewH;
  const scrollable = (el) => {
    if (!el || el.scrollHeight <= el.clientHeight + 4) return false;
    const s = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(s.overflowY) && s.visibility !== 'hidden' && s.display !== 'none';
  };
  let target = null;
  if (doc.scrollHeight > docH + 4) target = doc;
  else {
    // Appli web : le plus GRAND élément visible qui défile.
    let best = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!scrollable(el)) continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, docW) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, docH) - Math.max(r.top, 0));
      if (w * h > best) { best = w * h; target = el; }
    }
  }
  if (!target) return { kind: 'none', viewW, viewH };
  const isDoc = target === doc;
  const r = isDoc ? { left: 0, top: 0 } : target.getBoundingClientRect();
  const rect = isDoc
    ? { x: 0, y: 0, w: docW, h: docH }
    : { x: Math.max(0, r.left + target.clientLeft), y: Math.max(0, r.top + target.clientTop), w: target.clientWidth, h: target.clientHeight };
  // Fond à reproduire autour du contenu déroulé.
  let bg = 'rgb(255, 255, 255)';
  for (let el = isDoc ? document.body : target.parentElement; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\\(.*,\\s*0\\)$/.test(c)) { bg = c; break; }
  }
  const startTop = target.scrollTop;
  const prevBehavior = target.style.scrollBehavior;
  target.style.scrollBehavior = 'auto';
  // Éléments FIXES : capturés sur le premier écran, masqués ensuite (sinon
  // un en-tête fixe se répète à chaque écran). Éléments COLLANTS : rendus à
  // leur place normale, pour n'apparaître qu'une fois.
  const fixed = [];
  const sticky = [];
  const scope = isDoc ? document.body : target;
  for (const el of scope ? scope.querySelectorAll('*') : []) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') fixed.push([el, el.style.visibility]);
    else if (pos === 'sticky' || pos === '-webkit-sticky') sticky.push([el, el.style.position]);
  }
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  window.__orbitShot = {
    async go(top) {
      target.scrollTop = top;
      await frame();
      await new Promise((res) => setTimeout(res, 120));
      return target.scrollTop;
    },
    afterFirst() {
      fixed.forEach(([el]) => el.style.setProperty('visibility', 'hidden', 'important'));
      sticky.forEach(([el]) => el.style.setProperty('position', 'relative', 'important'));
    },
    async restore() {
      fixed.forEach(([el, v]) => { el.style.removeProperty('visibility'); if (v) el.style.visibility = v; });
      sticky.forEach(([el, p]) => { el.style.removeProperty('position'); if (p) el.style.position = p; });
      target.scrollTop = startTop;
      target.style.scrollBehavior = prevBehavior;
      delete window.__orbitShot;
      await frame();
      return true;
    },
  };
  return {
    kind: isDoc ? 'document' : 'element',
    viewW, viewH, rect,
    scrollHeight: target.scrollHeight,
    clientHeight: isDoc ? docH : target.clientHeight,
    bg,
  };
})()`;

// "rgb(12, 34, 56)" → [b, g, r, a] ou [r, g, b, a] selon l'ordre des octets
// de la plateforme (`bgra` : vrai sous Linux et Windows).
export function backgroundBytes(css, bgra = true) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(css || ''));
  const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 255];
  return bgra ? [b, g, r, 255] : [r, g, b, 255];
}
