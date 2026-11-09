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
// Cadrage de la « présentation » : la vignette mord sur la capture, ou se
// range à côté avec un écart. La vignette garde la même taille et la même
// forme dans les deux cas — on choisit un rapport entre les deux images, pas
// une autre mise en scène.
export const PRESENTATION_FRAMINGS = ['overlap', 'spaced'];

// Le cadrage est stocké comme un booléen (`cameraOverlap`) depuis l'origine :
// ces deux fonctions font la traduction, pour que l'interface puisse offrir
// deux choix nommés sans migrer les réglages déjà enregistrés.
export function framingOf(style) {
  return style?.cameraOverlap === false ? 'spaced' : 'overlap';
}
export function framingPatch(framing) {
  return { cameraOverlap: framing !== 'spaced' };
}

// Hauteur de pose de la vignette en « présentation ». Le milieu est le réglage
// par défaut, mais la capture a parfois quelque chose d'important là où la
// vignette tombe — un menu latéral, une colonne de totaux.
export const CAMERA_ALIGNS = ['middle', 'top', 'bottom'];

export const DEFAULT_STYLE = {
  resolution: '720p',
  fps: 24,
  // Ce qui s'entend dans la vidéo : 'mic' (défaut), 'system', 'both', 'none'.
  // Le micro seul reste le défaut : il fonctionne partout, alors que le son du
  // système dépend du système d'exploitation.
  audioSource: 'mic',
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
  cameraAlign: 'middle',
  // Liseré qui pulse avec la voix : il dit QUI parle, et donne un signe de vie
  // à la vignette pendant les passages où l'on commente sans bouger.
  voiceRing: true,
  // Carton de titre : quelques secondes de fond avec un titre, avant que la
  // composition n'arrive. Vide = pas de carton.
  title: '',
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
    // Ce qui compte ici, c'est la PRÉSENTATION. Une caméra de même hauteur que
    // la capture met les deux à égalité : le regard hésite, et la capture — la
    // seule à porter de l'information — se retrouve réduite pour rien.
    //
    // La caméra devient donc une vignette, à MI-HAUTEUR du côté choisi : posée
    // dans un coin, elle ne se distinguait plus de « écran + pastille ». Au
    // milieu du bord, elle donne l'incrustation de plateau — et elle garde
    // toute sa hauteur à la capture.
    const camW = box.w * 0.24;
    const camH = s.cameraShape === 'circle' ? camW : camW * 1.12;
    const gap = Math.min(outW, outH) * 0.025;
    // Part de la vignette qui passe DEVANT la capture. En « espacé », on
    // repasse à un écart : même vignette, mêmes proportions, mais les deux
    // zones redeviennent disjointes.
    const bite = s.cameraOverlap ? camW * 0.55 : -gap;
    const reserved = camW - bite; // largeur réellement prise sur la capture
    const screenX = sideRight ? box.x : box.x + reserved;
    const cameraX = sideRight ? box.x + box.w - camW : box.x;
    const aligns = {
      middle: box.y + (box.h - camH) / 2,
      top: box.y,
      bottom: box.y + box.h - camH,
    };
    return {
      screen: { x: screenX, y: box.y, w: box.w - reserved, h: box.h, fit: 'contain' },
      camera: {
        x: cameraX,
        y: aligns[s.cameraAlign] ?? aligns.middle,
        w: camW,
        h: camH,
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

// --- Enchaînements ---------------------------------------------------------
// Changer de disposition ou de fond en pleine phrase se voyait comme une
// coupure : l'image sautait d'un cadrage à l'autre en une image. Le spectateur
// le ressent comme une erreur de montage.
//
// On interpole donc la géométrie entre l'ancien plan et le nouveau. Assez lent
// pour qu'on suive le mouvement du regard, assez court pour ne pas donner
// l'impression que l'application rame.
export const LAYOUT_TRANSITION_MS = 420;
export const BACKGROUND_FADE_MS = 320;

// Accompagnement aux deux bouts : le mouvement démarre et s'arrête en douceur,
// la vitesse est au milieu. Un déplacement linéaire paraît mécanique.
export function easeInOut(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Interpolation d'une zone. `to` donne les champs non géométriques (forme,
// cadrage) : c'est la destination qui décide de l'apparence.
function tweenRect(from, to, t) {
  return {
    ...to,
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    w: lerp(from.w, to.w, t),
    h: lerp(from.h, to.h, t),
    alpha: 1,
  };
}

// Zone qui apparaît ou disparaît (passer en « caméra seule » retire l'écran).
// La faire surgir d'un coup serait aussi sec que le saut qu'on cherche à
// éviter : elle grandit depuis son centre en se révélant.
function appearRect(rect, t) {
  const scale = lerp(0.94, 1, t);
  const w = rect.w * scale;
  const h = rect.h * scale;
  return {
    ...rect,
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) / 2,
    w,
    h,
    alpha: clamp(t, 0, 1),
  };
}

// Plan intermédiaire entre deux compositions.
export function tweenPlan(from, to, t) {
  const eased = easeInOut(t);
  const slot = (a, b) => {
    if (!a && !b) return null;
    if (!a) return appearRect(b, eased);
    if (!b) return appearRect(a, 1 - eased);
    return tweenRect(a, b, eased);
  };
  return {
    screen: slot(from?.screen, to?.screen),
    camera: slot(from?.camera, to?.camera),
    // L'ombre portée est un flou sur toute la surface, mis en cache d'après la
    // géométrie : pendant un mouvement elle serait recalculée à chaque image.
    // On la met de côté le temps de l'enchaînement — personne ne remarque une
    // ombre absente sur une image qui bouge.
    animating: true,
  };
}

// Signature géométrique d'un plan, pour détecter un changement de cible sans
// comparer des flottants au pixel près.
function planSignature(plan) {
  const rect = (r) =>
    r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)},${r.shape || ''}` : 'x';
  return `${rect(plan?.screen)}|${rect(plan?.camera)}`;
}

// Écart entre deux plans, en pixels de sortie. `Infinity` quand une zone
// apparaît ou disparaît : ce n'est plus un déplacement, c'est un changement de
// composition.
function planDistance(from, to) {
  let max = 0;
  for (const slot of ['screen', 'camera']) {
    const a = from?.[slot];
    const b = to?.[slot];
    if (!a && !b) continue;
    if (!a || !b) return Infinity;
    max = Math.max(max, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
  }
  return max;
}

// En dessous de ce déplacement (en part de la plus grande zone), on va
// directement à la cible : c'est ce qui arrive quand on fait GLISSER un
// réglage — taille de la pastille, marge. Animer chaque pixel donnerait un
// curseur que l'image suit avec un demi-temps de retard, donc une impression
// de lenteur, là où un changement de disposition mérite le mouvement.
const SNAP_RATIO = 0.03;

// Fait avancer l'enchaînement d'une image. Fonction PURE : l'état est rendu,
// l'appelant le garde (une référence dans le composant). Rend `{ plan, ... }`
// où `plan` est ce qu'il faut dessiner maintenant.
export function stepLayoutTransition(state, target, now, duration = LAYOUT_TRANSITION_MS) {
  const signature = planSignature(target);
  // Première image : on affiche la cible, sans mouvement d'entrée.
  if (!state) return { plan: target, from: target, target, signature, start: now - duration };
  if (state.signature !== signature) {
    const span = Math.max(target.screen?.w || 0, target.camera?.w || 0, 1);
    if (planDistance(state.plan, target) < span * SNAP_RATIO) {
      return { plan: target, from: target, target, signature, start: now - duration };
    }
    // On repart de ce qui est AFFICHÉ, pas de l'ancienne cible : deux
    // changements rapprochés s'enchaînent alors sans saut en arrière.
    return { plan: state.plan, from: state.plan, target, signature, start: now };
  }
  const t = duration > 0 ? clamp((now - state.start) / duration, 0, 1) : 1;
  return { ...state, plan: t >= 1 ? target : tweenPlan(state.from, target, t) };
}

// Même principe pour une valeur qui n'est pas une géométrie — le fond : on
// garde l'ancienne le temps d'un fondu.
export function stepFade(state, value, now, duration = BACKGROUND_FADE_MS) {
  if (!state || state.value !== value) {
    return { value, from: state?.value ?? null, start: now, t: state ? 0 : 1 };
  }
  const t = duration > 0 ? clamp((now - state.start) / duration, 0, 1) : 1;
  return { ...state, t: easeInOut(t) };
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

// Passage des coordonnées ÉCRAN (pixels logiques du système, comme les bornes
// d'un écran ou d'une fenêtre) vers le canvas composé. Sert à replacer dans la
// vidéo ce qui est dessiné PAR-DESSUS l'écran filmé — les annotations — ou à
// masquer ce qui ne doit pas y figurer — le retour d'image du studio.
//
// Rend une transformation affine `{ a, d, e, f }` (x' = a·x + e, y' = d·y + f),
// directement utilisable par `ctx.setTransform(a, 0, 0, d, e, f)`, ou `null`
// quand l'écran filmé est inconnu (capture d'une fenêtre) : sans ses bornes, on
// ne sait pas où tombe un point de l'écran.
export function screenToCanvas(captureBounds, videoW, videoH, source, fit) {
  if (!captureBounds?.width || !captureBounds?.height || !videoW || !videoH || !fit?.w || !fit?.h) {
    return null;
  }
  const sx = source ? source.sx : 0;
  const sy = source ? source.sy : 0;
  const sw = source ? source.sw : videoW;
  const sh = source ? source.sh : videoH;
  // écran → pixels de la vidéo capturée → portion affichée → cadre du canvas
  const a = (videoW / captureBounds.width) * (fit.w / sw);
  const d = (videoH / captureBounds.height) * (fit.h / sh);
  return {
    a,
    d,
    e: fit.x - (sx * fit.w) / sw - captureBounds.x * a,
    f: fit.y - (sy * fit.h) / sh - captureBounds.y * d,
  };
}

// --- Raccourcis ------------------------------------------------------------
// Changer de fond ou de disposition À LA SOURIS pendant qu'on parle oblige à
// rouvrir le panneau, donc à sortir du cadre. Une touche suffit.
//
// Les lettres sont choisies dans la langue de l'interface principale : F
// (fond), D (disposition), C (coin), Z (zoom), H (halo), M (miroir), O
// (cadrage), V (voix), X (coup de zoom).
export const STUDIO_KEYS = {
  f: 'background',
  d: 'layout',
  c: 'corner',
  z: 'zoom',
  h: 'halo',
  m: 'mirror',
  // Cadrage de la présentation : chevauché ou espacé. Le réglage se juge à
  // l'œil, sur la capture du moment — il faut pouvoir le basculer sans
  // rouvrir le panneau.
  o: 'framing',
  v: 'voice',
  // Coup de zoom : traité par le composant, qui seul connaît l'instant.
  x: 'zoomPulse',
  p: 'pause',
  s: 'stop',
  r: 'minimize',
  // Annoter l'écran : une couche de dessin par-dessus tout, utile surtout
  // quand le studio est réduit et qu'on montre autre chose.
  a: 'annotate',
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
  // ↑/↓ règlent aussi la HAUTEUR DE POSE en présentation : la vignette n'y a
  // pas de coin, mais elle se pose en haut, au milieu ou en bas.
  switch (key) {
    case 'ArrowUp':
      return { cameraCorner: `top-${horizontal}`, cameraAlign: 'top' };
    case 'ArrowDown':
      return { cameraCorner: `bottom-${horizontal}`, cameraAlign: 'bottom' };
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
      // « Placer la caméra » n'a pas le même sens partout : en présentation,
      // la vignette n'a pas de coin, elle a une hauteur de pose. La touche
      // reste la même, elle agit sur ce qui existe.
      return s.layout === 'presentation'
        ? { cameraAlign: nextInList(CAMERA_ALIGNS, s.cameraAlign) }
        : { cameraCorner: nextInList(CAMERA_CORNERS, s.cameraCorner) };
    case 'zoom':
      return { zoom: !s.zoom };
    case 'halo':
      return { cursorHalo: !s.cursorHalo };
    case 'mirror':
      return { cameraMirror: !s.cameraMirror };
    case 'framing':
      return framingPatch(nextInList(PRESENTATION_FRAMINGS, framingOf(s)));
    case 'voice':
      return { voiceRing: !s.voiceRing };
    default:
      return null; // pause / stop / minimize / coup de zoom : au composant
  }
}

// --- « Je viens d'appuyer, rien n'a bougé » ---------------------------------
// Un raccourci qui ne change rien à l'image est indiscernable d'un raccourci
// qui ne marche pas. Deux cas honnêtes : le réglage ne concerne qu'une
// disposition, ou il ne concerne que les prises avec caméra.
//
// Rend `null` quand le changement se voit, sinon la RAISON pour laquelle il ne
// se voit pas — que l'interface annonce au lieu de laisser croire à une panne.
export function inertReason(patch, style, { hasCamera = false } = {}) {
  if (!patch) return null;
  const s = { ...DEFAULT_STYLE, ...style, ...patch };
  const fields = Object.keys(patch);
  const touche = (...names) => names.some((n) => fields.includes(n));

  const cameraVisible = hasCamera && s.layout !== 'screenOnly';
  if (touche('cameraOverlap', 'cameraAlign') && s.layout !== 'presentation') return 'needsPresentation';
  if (touche('cameraCorner') && s.layout !== 'screen') return 'needsBubble';
  if (touche('cameraSide') && s.layout !== 'split' && s.layout !== 'presentation') {
    return 'needsTwoZones';
  }
  if (
    touche('cameraOverlap', 'cameraAlign', 'cameraCorner', 'cameraSide', 'cameraShape', 'cameraSize', 'cameraMirror', 'voiceRing') &&
    !cameraVisible
  ) {
    return 'needsCamera';
  }
  if (touche('layout') && !hasCamera && s.layout !== 'presentation' && s.layout !== 'screen') {
    return 'needsCamera';
  }
  return null;
}

// --- Niveau de voix --------------------------------------------------------
// Qui parle ? Sur une vidéo à deux zones, le spectateur met un instant à le
// comprendre. Un liseré qui respire autour de la vignette le dit sans un mot,
// et donne un signe de vie à une caméra immobile.

// Niveau efficace (RMS) d'un bloc d'échantillons temporels, tel que les rend
// `AnalyserNode.getByteTimeDomainData` : des octets centrés sur 128.
//
// Pas la crête : une seule impulsion ferait alors bondir l'anneau, et le
// liseré clignoterait au rythme des consonnes au lieu de suivre la voix.
export function micLevel(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  return clamp(Math.sqrt(sum / samples.length), 0, 1);
}

// Épaisseur de l'anneau, en part du rayon de la vignette. Une voix normale
// tourne autour de 0,05 à 0,15 de niveau efficace : sans ce gain, l'anneau ne
// bougerait pratiquement jamais. En dessous du seuil, rien du tout — un
// anneau qui vibre sur le bruit de fond ne dit plus rien.
export const VOICE_FLOOR = 0.012;
export function voiceRingWidth(level) {
  const l = clamp(Number(level) || 0, 0, 1);
  if (l < VOICE_FLOOR) return 0;
  return clamp((l - VOICE_FLOOR) * 6, 0, 1);
}

// --- Coup de zoom ----------------------------------------------------------
// Le zoom permanent qui suit le curseur finit par donner le mal de mer, et le
// zoom sur les CLICS demanderait un crochet système que l'application n'a pas.
// Reste le geste : une touche, et l'image se rapproche de là où l'on travaille
// puis revient toute seule. C'est ponctuel, donc supportable, et c'est l'auteur
// qui décide du moment — ce qu'aucune heuristique ne devinerait.
export const ZOOM_PULSE_MS = 2800;

// Niveau de zoom effectif d'un coup de zoom commencé à `start`. Rend 1 (pas de
// zoom) quand il n'y en a pas, ou qu'il est terminé.
export function zoomPulseLevel(start, now, level, duration = ZOOM_PULSE_MS) {
  if (!start || !duration) return 1;
  const t = (now - start) / duration;
  if (t < 0 || t >= 1) return 1;
  const target = Math.max(1, Math.min(4, Number(level) || 1));
  // Trois temps : on entre (20 %), on tient (60 %), on ressort (20 %). Entrer
  // et sortir vite donnerait un sursaut ; tenir est le seul moment utile.
  const amount = t < 0.2 ? easeInOut(t / 0.2) : t > 0.8 ? easeInOut((1 - t) / 0.2) : 1;
  return 1 + (target - 1) * amount;
}

// --- Carton de titre -------------------------------------------------------
// Les trois premières secondes d'une vidéo décident si on la regarde. Un titre
// posé sur le fond, puis la composition qui arrive, remplace le démarrage
// abrupt « bonjour, alors voilà » par quelque chose qui ressemble à un début.
export const TITLE_CARD_MS = 2600;

// Avancement du carton : `{ text, veil }` — l'opacité du titre, et celle du
// voile qui couvre la composition le temps de le lire.
export function titleCardPhase(elapsed, duration = TITLE_CARD_MS) {
  if (!(duration > 0)) return null;
  const t = clamp(elapsed / duration, 0, 1);
  if (t >= 1) return null;
  // Le titre reste lisible la moitié du temps, puis s'efface ; le voile se
  // lève un peu plus tôt, pour que la composition se découvre dessous.
  return {
    text: t < 0.5 ? 1 : easeInOut((1 - t) / 0.5),
    veil: t < 0.35 ? 1 : easeInOut((1 - t) / 0.65),
  };
}

// --- Cadrages mémorisés ----------------------------------------------------
// « Ma démo client » et « mon tutoriel » ne se filment pas pareil, et refaire
// huit réglages à chaque fois use. On garde donc la mise en scène sous un nom.
export const MAX_PRESETS = 5;

// Champs d'un cadrage : la MISE EN SCÈNE, pas les réglages de machine.
// Rappeler un cadrage ne doit pas remonter la définition ou la cadence — ce
// sont des réglages de performance, propres à l'ordinateur du moment, et les
// imposer donnerait une vidéo saccadée sans qu'on comprenne pourquoi.
const PRESET_FIELDS = [
  'background', 'padding', 'radius', 'shadow', 'layout', 'cameraShape', 'cameraCorner',
  'cameraSize', 'cameraMirror', 'cameraSide', 'cameraAlign', 'cameraOverlap', 'zoom',
  'zoomLevel', 'cursorHalo', 'voiceRing',
];

export function stagingOf(style) {
  const s = { ...DEFAULT_STYLE, ...style };
  return Object.fromEntries(PRESET_FIELDS.map((field) => [field, s[field]]));
}

// Enregistre (ou remplace) un cadrage. Le même nom écrase : on corrige un
// cadrage en le réenregistrant, sans avoir à supprimer d'abord.
export function savePreset(presets, name, style) {
  const label = String(name || '').trim();
  if (!label) return Array.isArray(presets) ? presets : [];
  const others = (Array.isArray(presets) ? presets : []).filter((p) => p?.name !== label);
  return [...others, { name: label, style: stagingOf(style) }].slice(-MAX_PRESETS);
}

export function removePreset(presets, name) {
  return (Array.isArray(presets) ? presets : []).filter((p) => p?.name !== name);
}

// Cadrage rappelé par sa place dans la liste (Alt + chiffre). Rend le style à
// appliquer, ou null — une touche qui ne correspond à rien ne doit rien faire.
export function presetPatch(presets, index) {
  const preset = (Array.isArray(presets) ? presets : [])[index];
  return preset?.style ? stagingOf(preset.style) : null;
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
