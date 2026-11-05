// ---------------------------------------------------------------------------
// Studio d'enregistrement : MISE EN PAGE — logique pure, sans canvas ni DOM.
//
// Ce qui distingue un enregistrement d'écran brut d'une vidéo présentable, ce
// n'est pas la capture : c'est la composition. Un fond, une marge, des coins
// arrondis et une ombre suffisent à transformer une capture carrée et sèche en
// quelque chose qu'on ose envoyer à un client.
//
// Tout le calcul vit ici — où poser l'écran, où poser la caméra, quelle part
// de l'image montrer quand on zoome — pour deux raisons :
//   • c'est la partie qui se trompe en silence (un cadrage faux donne une
//     vidéo ratée qu'on ne voit qu'après l'enregistrement) ;
//   • et `npm test` tourne sans `node_modules`, donc sans canvas.
// Le composant ne garde que les appels de dessin.
// ---------------------------------------------------------------------------

// Fonds proposés. Les dégradés sont volontairement sobres et peu saturés : ils
// doivent mettre en valeur la capture, pas rivaliser avec elle.
export const BACKGROUNDS = {
  none: { kind: 'none' },
  dark: { kind: 'solid', colors: ['#0b1020'] },
  light: { kind: 'solid', colors: ['#f4f5f7'] },
  indigo: { kind: 'gradient', colors: ['#4f46e5', '#0ea5e9'], angle: 135 },
  sunset: { kind: 'gradient', colors: ['#f97316', '#db2777'], angle: 135 },
  forest: { kind: 'gradient', colors: ['#059669', '#0f766e'], angle: 135 },
  slate: { kind: 'gradient', colors: ['#1e293b', '#334155'], angle: 135 },
  // Reprend la couleur d'accent du profil : l'enregistrement ressemble alors
  // à l'application dont il parle.
  accent: { kind: 'accent' },
};

// L'ordre compte : il donne les touches 1 à 5, et va du plus sobre au plus
// mis en scène.
export const LAYOUTS = ['screenOnly', 'screen', 'camera', 'split', 'presentation'];
// Côté où se place la caméra dans les dispositions à deux zones.
export const CAMERA_SIDES = ['left', 'right'];
export const CAMERA_CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];

export const DEFAULT_STYLE = {
  resolution: '720p',
  fps: 24,
  background: 'indigo',
  padding: 6, // % de la plus petite dimension
  radius: 14, // px à l'échelle de la sortie
  shadow: true,
  layout: 'screen',
  cameraShape: 'circle', // circle | rounded
  cameraCorner: 'bottom-left',
  cameraSize: 22, // % de la hauteur de sortie
  cameraMirror: true,
  cameraSide: 'right',
  // Chevauchement : la pastille mord sur le bord de la capture au lieu de
  // s'aligner sagement à côté. C'est ce qui donne l'allure « studio » plutôt
  // que « deux fenêtres posées l'une à côté de l'autre ».
  cameraOverlap: true,
  zoom: false,
  zoomLevel: 1.6,
  // Halo autour du pointeur : une capture d'écran rend le curseur minuscule,
  // et le spectateur passe son temps à le chercher.
  cursorHalo: false,
};

// Cadences proposées. L'encodage d'une vidéo se fait ici en logiciel : sur une
// machine modeste, viser trente images par seconde produit une vidéo qui en
// contient cinq — saccadée. Mieux vaut viser plus bas et les tenir vraiment.
export const FRAME_RATES = [15, 24, 30];

// La cadence réellement obtenue mérite d'être affichée : une vidéo saccadée se
// découvre sinon à la relecture, quand il est trop tard. En dessous de ce
// rapport, on prévient.
export const FPS_WARN_RATIO = 0.6;

export function fpsHealth(achieved, target) {
  if (!target || !achieved) return 'unknown';
  return achieved >= target * FPS_WARN_RATIO ? 'ok' : 'low';
}

// Rectangle d'une source dessinée en « contain » : toute l'image visible,
// centrée, sans déformation. Recadrer (cover) couperait du contenu — sur une
// capture d'écran, couper un bord revient souvent à couper une barre d'outils.
export function containRect(srcW, srcH, boxX, boxY, boxW, boxH) {
  if (!srcW || !srcH || boxW <= 0 || boxH <= 0) return { x: boxX, y: boxY, w: 0, h: 0 };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

// Rectangle d'une source dessinée en « cover » : la boîte est remplie, les
// débordements sont coupés. C'est ce qu'on veut pour une pastille caméra, où
// un liseré vide autour du visage serait disgracieux.
export function coverRect(srcW, srcH, boxX, boxY, boxW, boxH) {
  if (!srcW || !srcH || boxW <= 0 || boxH <= 0) return { x: boxX, y: boxY, w: 0, h: 0 };
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

// Zone utile après application de la marge. La marge est exprimée en % de la
// plus PETITE dimension : sur un format 16/9, un pourcentage de la largeur
// donnerait des bandes hautes et basses minuscules.
export function contentBox(outW, outH, paddingPercent) {
  const pad = (Math.max(0, Math.min(25, paddingPercent)) / 100) * Math.min(outW, outH);
  return { x: pad, y: pad, w: Math.max(0, outW - pad * 2), h: Math.max(0, outH - pad * 2) };
}

// Place la pastille caméra dans un coin de la zone utile.
export function cameraBox(box, { cameraSize, cameraCorner }, outH) {
  const size = (Math.max(6, Math.min(50, cameraSize)) / 100) * outH;
  const margin = size * 0.18;
  const left = box.x + margin;
  const right = box.x + box.w - size - margin;
  const top = box.y + margin;
  const bottom = box.y + box.h - size - margin;
  const corners = {
    'bottom-left': { x: left, y: bottom },
    'bottom-right': { x: right, y: bottom },
    'top-left': { x: left, y: top },
    'top-right': { x: right, y: top },
  };
  const pos = corners[cameraCorner] || corners['bottom-left'];
  return { x: pos.x, y: pos.y, w: size, h: size };
}

// Plan de composition complet : où va l'écran, où va la caméra.
//
// `screen` : la capture occupe la zone utile, la caméra flotte dans un coin.
// `camera` : la caméra seule, plein cadre — pour une introduction face public.
// `split`  : moitié / moitié, côte à côte. Utile pour une démonstration
//            commentée où le visage compte autant que l'écran.
// `presentation` : l'écran est réduit et décalé, la caméra prend une place
//            large à côté — l'allure d'une présentation filmée.
export function composeLayout({ outW, outH, style, hasCamera, screenSize, cameraSize }) {
  const s = { ...DEFAULT_STYLE, ...style };
  const box = contentBox(outW, outH, s.padding);
  // Sans caméra, les dispositions qui en dépendent n'ont plus de sens — sauf
  // « présentation », qui est aussi un CADRAGE : la capture rétrécie au centre,
  // largement entourée de fond. C'est l'allure d'une diapositive, et elle vaut
  // d'exister seule.
  const layout = hasCamera ? s.layout : s.layout === 'presentation' ? 'presentation' : 'screen';

  // « Écran seul » : la caméra reste sélectionnée et son flux reste ouvert,
  // mais elle n'est pas dessinée. C'est le geste qu'on veut pendant une
  // explication en plein écran — et la pastille revient d'une touche pour la
  // suite, sans avoir à rechoisir le périphérique.
  if (layout === 'screenOnly') {
    return { screen: { x: box.x, y: box.y, w: box.w, h: box.h, fit: 'contain' }, camera: null };
  }

  if (layout === 'presentation' && !hasCamera) {
    const scale = 0.82;
    const w = box.w * scale;
    const h = box.h * scale;
    return {
      screen: { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, fit: 'contain' },
      camera: null,
    };
  }

  if (layout === 'camera' && hasCamera) {
    return {
      screen: null,
      camera: { ...box, shape: s.cameraShape === 'circle' ? 'circle' : 'rounded', full: true },
    };
  }

  // Dispositions à DEUX ZONES. Le côté de la caméra est au choix : un
  // présentateur droitier regarde naturellement vers sa gauche, et le sens de
  // lecture compte — l'écran à gauche se lit avant le visage à droite.
  const sideRight = (s.cameraSide || 'right') === 'right';

  if (layout === 'split' && hasCamera) {
    const gap = Math.min(outW, outH) * 0.02;
    const half = (box.w - gap) / 2;
    const screenX = sideRight ? box.x : box.x + half + gap;
    const cameraX = sideRight ? box.x + half + gap : box.x;
    return {
      screen: { x: screenX, y: box.y, w: half, h: box.h, fit: 'contain' },
      camera: { x: cameraX, y: box.y, w: half, h: box.h, shape: s.cameraShape === 'circle' ? 'circle' : 'rounded', full: true },
    };
  }

  if (layout === 'presentation' && hasCamera) {
    const camW = box.w * 0.34;
    const gap = Math.min(outW, outH) * 0.025;
    // Le chevauchement remplace l'écart par un recouvrement : la pastille
    // mord sur la capture, comme dans une incrustation de plateau.
    const shift = s.cameraOverlap ? -camW * 0.22 : gap;
    const screenW = box.w - camW - shift;
    const screenX = sideRight ? box.x : box.x + camW + shift;
    const cameraX = sideRight ? box.x + box.w - camW : box.x;
    return {
      screen: { x: screenX, y: box.y, w: screenW, h: box.h, fit: 'contain' },
      camera: {
        x: cameraX,
        y: box.y + box.h * 0.1,
        w: camW,
        h: s.cameraShape === 'circle' ? camW : box.h * 0.8,
        shape: s.cameraShape === 'circle' ? 'circle' : 'rounded',
        full: true,
        // Dessinée APRÈS l'écran : c'est elle qui passe par-dessus.
        over: s.cameraOverlap,
      },
    };
  }

  // Disposition par défaut : capture plein cadre, pastille caméra en incrustation.
  const screen = { x: box.x, y: box.y, w: box.w, h: box.h, fit: 'contain' };
  const camera = hasCamera
    ? { ...cameraBox(box, s, outH), shape: s.cameraShape === 'circle' ? 'circle' : 'rounded' }
    : null;
  return { screen, camera, screenSize, cameraSize };
}

// --- Zoom suivi du curseur -------------------------------------------------
// Tella zoome sur les clics. On n'a pas les clics du système, mais on a la
// POSITION du curseur : suivre le pointeur en douceur donne le même effet —
// l'œil du spectateur est amené là où ça se passe — sans dépendre d'un crochet
// système intrusif.
//
// Le rectangle rendu est exprimé dans les coordonnées de la source. On le
// garde entièrement DANS l'image : sans cette contrainte, un curseur au bord
// afficherait des bandes vides.
export function zoomSourceRect(srcW, srcH, focus, level) {
  const z = Math.max(1, Math.min(4, Number(level) || 1));
  if (z === 1 || !srcW || !srcH) return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  const sw = srcW / z;
  const sh = srcH / z;
  const fx = clamp(coord(focus?.x), 0, 1) * srcW;
  const fy = clamp(coord(focus?.y), 0, 1) * srcH;
  return {
    sx: clamp(fx - sw / 2, 0, srcW - sw),
    sy: clamp(fy - sh / 2, 0, srcH - sh),
    sw,
    sh,
  };
}

// Lissage exponentiel du point suivi : un zoom qui colle au pixel près au
// curseur donne une vidéo nerveuse, désagréable à regarder. On retient donc le
// mouvement, d'autant plus que l'écart est faible.
export function easeFocus(current, target, factor = 0.12) {
  const f = clamp(factor, 0.01, 1);
  return {
    x: clamp(lerp(coord(current?.x), coord(target?.x), f), 0, 1),
    y: clamp(lerp(coord(current?.y), coord(target?.y), f), 0, 1),
  };
}

// Position du curseur ramenée en coordonnées 0→1 de l'écran capturé.
export function cursorFocus(point, displayBounds) {
  const b = displayBounds;
  if (!point || !b || !b.width || !b.height) return { x: 0.5, y: 0.5 };
  return {
    x: clamp((point.x - b.x) / b.width, 0, 1),
    y: clamp((point.y - b.y) / b.height, 0, 1),
  };
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Coordonnée de suivi, avec repli au centre.
//
// Surtout pas `Number(v) || 0.5` : un curseur collé au bord GAUCHE vaut 0, que
// `||` prend pour une valeur absente et remplace par le centre. Le zoom
// sautait alors au milieu de l'écran au moment précis où l'on travaillait dans
// le coin.
function coord(v, fallback = 0.5) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
const lerp = (a, b, t) => a + (b - a) * t;

// Position du halo dans le CADRE dessiné, à partir du point suivi et de la
// portion de source affichée. Rend `null` quand le curseur sort de la zone
// visible : un halo collé au bord, sans curseur dessous, serait trompeur.
export function haloPoint(focus, source, srcW, srcH, fit) {
  if (!fit || !fit.w || !srcW || !srcH) return null;
  const sx = source ? source.sx : 0;
  const sy = source ? source.sy : 0;
  const sw = source ? source.sw : srcW;
  const sh = source ? source.sh : srcH;
  const px = clamp(coord(focus?.x), 0, 1) * srcW;
  const py = clamp(coord(focus?.y), 0, 1) * srcH;
  if (px < sx || px > sx + sw || py < sy || py > sy + sh) return null;
  return {
    x: fit.x + ((px - sx) / sw) * fit.w,
    y: fit.y + ((py - sy) / sh) * fit.h,
    r: Math.max(18, Math.min(fit.w, fit.h) * 0.045),
  };
}

// --- Raccourcis ------------------------------------------------------------
// Changer de fond ou de disposition À LA SOURIS pendant qu'on parle oblige à
// rouvrir le panneau, donc à sortir du cadre. Une touche suffit.
//
// Les lettres sont choisies dans la langue de l'interface principale : F
// (fond), D (disposition), C (coin), Z (zoom), H (halo), M (miroir).
export const STUDIO_KEYS = {
  f: 'background',
  d: 'layout',
  c: 'corner',
  z: 'zoom',
  h: 'halo',
  m: 'mirror',
  p: 'pause',
  s: 'stop',
  r: 'minimize',
};

// Élément suivant d'une liste, en boucle. Sert à « la touche fait défiler les
// choix » : on avance sans jamais se retrouver bloqué au bout.
export function nextInList(list, current) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return current;
  const i = items.indexOf(current);
  return items[(i + 1) % items.length];
}

// Raccourcis DIRECTS : aller d'un coup à la disposition ou au fond voulu,
// plutôt que de faire défiler jusqu'à lui.
//
//   1–5            → disposition (dans l'ordre de LAYOUTS)
//   Maj + 1–8      → fond (dans l'ordre de BACKGROUNDS)
//   flèches        → place la caméra, un axe à la fois : ↑/↓ choisissent le
//                    haut ou le bas, ←/→ la gauche ou la droite. Deux touches
//                    pour un coin, mais chacune va DIRECTEMENT où on pense.
//
// Les flèches servent aussi de côté en « côte à côte » et « présentation »,
// où il n'y a pas de coin mais une gauche et une droite.
export function directStudioKey(key, { shift = false } = {}, style = {}, { hasCamera = false } = {}) {
  const s = { ...DEFAULT_STYLE, ...style };

  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    if (shift) {
      const fonds = Object.keys(BACKGROUNDS);
      return index < fonds.length ? { background: fonds[index] } : null;
    }
    const choix = hasCamera ? LAYOUTS : LAYOUTS.filter((l) => l === 'screen' || l === 'presentation');
    return index < choix.length ? { layout: choix[index] } : null;
  }

  const [vertical, horizontal] = String(s.cameraCorner || 'bottom-left').split('-');
  switch (key) {
    case 'ArrowUp':
      return { cameraCorner: `top-${horizontal}` };
    case 'ArrowDown':
      return { cameraCorner: `bottom-${horizontal}` };
    case 'ArrowLeft':
      return { cameraCorner: `${vertical}-left`, cameraSide: 'left' };
    case 'ArrowRight':
      return { cameraCorner: `${vertical}-right`, cameraSide: 'right' };
    default:
      return null;
  }
}

// Applique un raccourci au style courant. Rend le style SUIVANT, ou null quand
// la touche ne concerne pas la mise en scène (pause, arrêt, réduction) — ces
// actions-là sont du ressort du composant.
export function applyStudioKey(key, style, { hasCamera = false } = {}) {
  const action = STUDIO_KEYS[String(key || '').toLowerCase()];
  if (!action) return null;
  const s = { ...DEFAULT_STYLE, ...style };
  switch (action) {
    case 'background':
      return { background: nextInList(Object.keys(BACKGROUNDS), s.background) };
    case 'layout':
      // Les dispositions à caméra sont sautées quand il n'y en a pas : la
      // touche ne doit jamais mener à un choix sans effet.
      return {
        layout: nextInList(hasCamera ? LAYOUTS : ['screen', 'presentation'], s.layout),
      };
    case 'corner':
      return { cameraCorner: nextInList(CAMERA_CORNERS, s.cameraCorner) };
    case 'zoom':
      return { zoom: !s.zoom };
    case 'halo':
      return { cursorHalo: !s.cursorHalo };
    case 'mirror':
      return { cameraMirror: !s.cameraMirror };
    default:
      return null; // pause / stop / minimize : traités par le composant
  }
}

// --- Nom de fichier --------------------------------------------------------
export function recordingName(date = new Date(), extension = 'webm') {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `Orbit ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}h${p(date.getMinutes())}m${p(date.getSeconds())}s.${extension}`
  );
}

// Durée lisible pour l'affichage pendant l'enregistrement.
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
