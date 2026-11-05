// ---------------------------------------------------------------------------
// Annotation d'une capture — LOGIQUE PURE, aucune dépendance.
//
// Entre la capture et l'enregistrement, Orbit laisse écrire, dessiner, masquer
// et corriger l'image. Tout ce qui se décide sans toile (`canvas`) vit ici :
// géométrie des formes, conversion des coordonnées d'affichage vers les pixels
// de l'image, filtre CSS des réglages, validation du PNG renvoyé au processus
// principal. Le composant ne garde que les appels de dessin, et `node --test`
// verrouille les calculs sans navigateur.
// ---------------------------------------------------------------------------

// Outils de la barre. `pointer` ne dessine pas : il sert à déplacer/annuler
// sans toucher à l'image (et reste l'outil par défaut).
export const ANNOTATION_TOOLS = [
  'arrow',
  'rect',
  'ellipse',
  'pen',
  'highlight',
  'text',
  'step',
  'blur',
  'crop',
];

export const ANNOTATION_COLORS = [
  '#ef4444', // rouge — ce qui ne va pas
  '#f59e0b', // ambre — à regarder
  '#22c55e', // vert — ce qui est attendu
  '#3b82f6', // bleu — commentaire
  '#a855f7', // violet
  '#0f172a', // encre sombre
  '#ffffff', // blanc, pour écrire sur une image foncée
];

export const ANNOTATION_WIDTHS = [2, 4, 8, 14];

export const DEFAULT_ADJUSTMENTS = { brightness: 100, contrast: 100, saturation: 100 };

// Bornes larges mais pas absurdes : au-delà, l'image ne se lit plus et la
// capture perd sa raison d'être.
const ADJUSTMENT_RANGE = { brightness: [20, 200], contrast: [20, 300], saturation: [0, 300] };

export function clampAdjustments(raw = {}) {
  const out = {};
  for (const [key, [min, max]] of Object.entries(ADJUSTMENT_RANGE)) {
    const value = Number(raw?.[key]);
    out[key] = Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : DEFAULT_ADJUSTMENTS[key];
  }
  return out;
}

export function adjustmentsAreNeutral(adjustments) {
  const a = clampAdjustments(adjustments);
  return Object.entries(DEFAULT_ADJUSTMENTS).every(([key, value]) => a[key] === value);
}

// Même chaîne pour l'aperçu (style CSS de l'image) et pour l'aplatissement
// (`ctx.filter`) : l'image enregistrée est exactement celle qu'on voyait.
export function cssFilterFor(adjustments) {
  const a = clampAdjustments(adjustments);
  return `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturation}%)`;
}

// Coordonnées d'un pointeur → pixels de l'image.
//
// L'aperçu est mis à l'échelle (`object-contain`) : sans cette conversion, un
// trait dessiné en haut à gauche atterrirait ailleurs dans le fichier final.
export function toImagePoint(point, displayRect, imageSize) {
  const rect = displayRect || {};
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  const imageWidth = Number(imageSize?.width) || 0;
  const imageHeight = Number(imageSize?.height) || 0;
  if (!width || !height || !imageWidth || !imageHeight) return { x: 0, y: 0 };
  // `object-contain` : l'image occupe tout un axe et se centre sur l'autre.
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const offsetX = (width - imageWidth * scale) / 2;
  const offsetY = (height - imageHeight * scale) / 2;
  const x = (Number(point?.x || 0) - (Number(rect.left) || 0) - offsetX) / scale;
  const y = (Number(point?.y || 0) - (Number(rect.top) || 0) - offsetY) / scale;
  return {
    x: Math.min(imageWidth, Math.max(0, Math.round(x))),
    y: Math.min(imageHeight, Math.max(0, Math.round(y))),
  };
}

// Rectangle normalisé (largeur/hauteur positives) depuis deux coins, borné à
// l'image : un glissement vers la gauche ou vers le haut reste valide.
export function normalizeRect(from, to, imageSize) {
  const maxX = Number(imageSize?.width) || Number.MAX_SAFE_INTEGER;
  const maxY = Number(imageSize?.height) || Number.MAX_SAFE_INTEGER;
  const clamp = (value, max) => Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
  const x1 = clamp(from?.x, maxX);
  const y1 = clamp(from?.y, maxY);
  const x2 = clamp(to?.x, maxX);
  const y2 = clamp(to?.y, maxY);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

// Pointe de flèche : deux segments à 28° de la ligne, longueur proportionnelle
// à l'épaisseur du trait (une flèche fine garde une pointe fine).
export function arrowHead(from, to, width) {
  const fromX = Number(from?.x) || 0;
  const fromY = Number(from?.y) || 0;
  const toX = Number(to?.x) || 0;
  const toY = Number(to?.y) || 0;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const length = Math.hypot(toX - fromX, toY - fromY);
  // Sur une flèche très courte, une pointe à taille fixe dépasserait la ligne.
  const head = Math.min(Math.max(8, (Number(width) || 2) * 4.5), Math.max(4, length * 0.6));
  const spread = 0.49; // ≈ 28°
  return [
    { x: toX - head * Math.cos(angle - spread), y: toY - head * Math.sin(angle - spread) },
    { x: toX, y: toY },
    { x: toX - head * Math.cos(angle + spread), y: toY - head * Math.sin(angle + spread) },
  ];
}

// Masquage d'une zone par pixellisation : on calcule la grille de blocs à
// recopier (chaque bloc prend la couleur de son coin supérieur gauche). Un
// flou gaussien se « dé-floute » à l'œil nu sur du texte ; des blocs, non.
export function pixelateGrid(rect, blockSize) {
  const size = Math.max(4, Math.round(Number(blockSize) || 12));
  const width = Math.max(0, Math.round(Number(rect?.width) || 0));
  const height = Math.max(0, Math.round(Number(rect?.height) || 0));
  const x = Math.round(Number(rect?.x) || 0);
  const y = Math.round(Number(rect?.y) || 0);
  const blocks = [];
  if (!width || !height) return blocks;
  for (let row = y; row < y + height; row += size) {
    for (let col = x; col < x + width; col += size) {
      blocks.push({
        x: col,
        y: row,
        width: Math.min(size, x + width - col),
        height: Math.min(size, y + height - row),
      });
    }
  }
  return blocks;
}

// Taille du bloc de pixellisation relative à l'image : une zone masquée sur une
// capture 4K doit rester illisible, et rester discrète sur une petite image.
export function pixelateBlockSize(imageSize) {
  const longest = Math.max(Number(imageSize?.width) || 0, Number(imageSize?.height) || 0);
  return Math.min(40, Math.max(8, Math.round(longest / 90)));
}

// Corps de texte : taille de police liée à l'épaisseur choisie, pour que la
// barre d'outils pilote une seule notion (« trait fin » / « trait épais »).
export function textFontSize(width) {
  return Math.max(12, Math.round((Number(width) || 2) * 5.5));
}

// Étapes numérotées : documenter un parcours sans écrire « 1 », « 2 », « 3 » à
// la main (et sans se tromper après avoir annulé une pastille).
export function nextStepNumber(shapes) {
  const used = (Array.isArray(shapes) ? shapes : [])
    .filter((shape) => shape?.tool === 'step')
    .map((shape) => Number(shape.index) || 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

// Rayon d'une pastille d'étape : lié à l'épaisseur choisie, comme la police du
// texte, pour que la barre d'outils ne pilote qu'une seule notion.
export function stepRadius(width) {
  return Math.max(11, Math.round((Number(width) || 2) * 4));
}

// Recadrage : le rectangle demandé, ramené dans l'image et refusé s'il ne
// reste presque rien (un clic involontaire ne doit pas réduire la capture à
// quelques pixels).
export function normalizeCrop(rect, imageSize) {
  const bounded = normalizeRect(
    { x: rect?.x, y: rect?.y },
    { x: (rect?.x || 0) + (rect?.width || 0), y: (rect?.y || 0) + (rect?.height || 0) },
    imageSize
  );
  if (bounded.width < 24 || bounded.height < 24) return null;
  return bounded;
}

// Les formes vivent dans les coordonnées de l'image D'ORIGINE : un recadrage
// ne les déplace pas, il déplace seulement la fenêtre qu'on regarde.
export function cropOrigin(crop) {
  return { x: Math.max(0, Math.round(Number(crop?.x) || 0)), y: Math.max(0, Math.round(Number(crop?.y) || 0)) };
}

// Une forme est-elle assez grande pour être gardée ? Un simple clic avec le
// rectangle ne doit pas laisser un artefact invisible dans l'image.
export function shapeIsMeaningful(shape) {
  if (!shape || typeof shape !== 'object') return false;
  if (shape.tool === 'text') return Boolean(String(shape.text || '').trim());
  // Une pastille d'étape se pose d'un clic : elle n'a pas de taille à vérifier.
  if (shape.tool === 'step') return Number.isFinite(shape.at?.x) && Number.isFinite(shape.at?.y);
  if (shape.tool === 'pen' || shape.tool === 'highlight') {
    return Array.isArray(shape.points) && shape.points.length > 1;
  }
  if (shape.tool === 'arrow') {
    return Math.hypot(
      (shape.to?.x || 0) - (shape.from?.x || 0),
      (shape.to?.y || 0) - (shape.from?.y || 0)
    ) > 6;
  }
  return (shape.rect?.width || 0) > 4 && (shape.rect?.height || 0) > 4;
}

// Fenêtre d'une capture ÉPINGLÉE (flottante, toujours visible).
//
// Deux contraintes : tenir dans l'écran utile (une capture de page entière
// fait parfois 16 000 px de haut) et rester lisible (une vignette de 40 px ne
// sert à rien). Les épinglages successifs se décalent en cascade, sinon la
// deuxième capture masque exactement la première.
export function pinnedWindowBounds(imageSize, workArea, index = 0) {
  const area = {
    x: Number(workArea?.x) || 0,
    y: Number(workArea?.y) || 0,
    width: Math.max(320, Number(workArea?.width) || 1280),
    height: Math.max(240, Number(workArea?.height) || 800),
  };
  const imageWidth = Math.max(1, Number(imageSize?.width) || 1);
  const imageHeight = Math.max(1, Number(imageSize?.height) || 1);
  // Trois contraintes, par ordre de priorité — les proportions d'abord : la
  // fenêtre est contrainte par `setAspectRatio`, un plancher appliqué
  // séparément à la largeur et à la hauteur déformerait la capture (une page
  // entière de 1200×9000 devenait un bandeau).
  //   1. proportions de l'image, toujours ;
  //   2. tenir dans l'écran utile, toujours ;
  //   3. rester lisible (220×140 minimum), si 2 le permet.
  const fit = Math.min(1, (area.width * 0.6) / imageWidth, (area.height * 0.6) / imageHeight);
  const readable = Math.max(fit, 220 / imageWidth, 140 / imageHeight);
  const scale = Math.min(readable, area.width / imageWidth, area.height / imageHeight);
  const width = Math.round(imageWidth * scale);
  const height = Math.round(imageHeight * scale);
  const offset = Math.max(0, Math.min(8, Math.round(Number(index) || 0))) * 28;
  const x = Math.max(area.x, Math.min(area.x + area.width - width, area.x + area.width - width - 24 - offset));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, area.y + 24 + offset));
  return { x, y, width, height };
}

// L'image modifiée revient au processus principal en data URL : elle doit être
// un PNG, et rien d'autre (le processus principal écrit un fichier avec).
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

// 80 Mio de base64 ≈ 60 Mio de PNG : au-delà, ce n'est plus une capture.
export const MAX_ANNOTATED_BYTES = 80 * 1024 * 1024;

export function parsePngDataUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > MAX_ANNOTATED_BYTES) return null;
  const match = PNG_DATA_URL.exec(raw);
  return match ? match[1] : null;
}
