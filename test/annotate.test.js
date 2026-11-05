import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_TOOLS,
  DEFAULT_ADJUSTMENTS,
  MAX_ANNOTATED_BYTES,
  adjustmentsAreNeutral,
  arrowHead,
  clampAdjustments,
  cssFilterFor,
  normalizeRect,
  parsePngDataUrl,
  pixelateBlockSize,
  cropOrigin,
  nextStepNumber,
  normalizeCrop,
  pinnedWindowBounds,
  pixelateGrid,
  shapeIsMeaningful,
  stepRadius,
  textFontSize,
  toImagePoint,
} from '../src/lib/annotate.js';

test('clampAdjustments : borne, arrondit et répare les valeurs absurdes', () => {
  assert.deepEqual(clampAdjustments({}), DEFAULT_ADJUSTMENTS);
  assert.deepEqual(clampAdjustments({ brightness: 1000, contrast: -5, saturation: 150.4 }), {
    brightness: 200,
    contrast: 20,
    saturation: 150,
  });
  assert.deepEqual(clampAdjustments({ brightness: 'beaucoup' }), DEFAULT_ADJUSTMENTS);
});

test('adjustmentsAreNeutral : décide s\'il faut ré-encoder l\'image', () => {
  assert.equal(adjustmentsAreNeutral(DEFAULT_ADJUSTMENTS), true);
  assert.equal(adjustmentsAreNeutral({ ...DEFAULT_ADJUSTMENTS, contrast: 120 }), false);
});

test('cssFilterFor : même filtre pour l\'aperçu et pour l\'image enregistrée', () => {
  assert.equal(
    cssFilterFor({ brightness: 110, contrast: 130, saturation: 90 }),
    'brightness(110%) contrast(130%) saturate(90%)'
  );
});

test('toImagePoint : coordonnées écran → pixels de l\'image mise à l\'échelle', () => {
  // Image 1000×500 affichée dans 500×500 : échelle 0,5, image centrée
  // verticalement (125 px de marge en haut et en bas).
  const rect = { left: 100, top: 50, width: 500, height: 500 };
  const size = { width: 1000, height: 500 };
  assert.deepEqual(toImagePoint({ x: 100, y: 175 }, rect, size), { x: 0, y: 0 });
  assert.deepEqual(toImagePoint({ x: 350, y: 300 }, rect, size), { x: 500, y: 250 });
  // Clic dans la marge : borné à l'image, jamais négatif.
  assert.deepEqual(toImagePoint({ x: 100, y: 50 }, rect, size), { x: 0, y: 0 });
  assert.deepEqual(toImagePoint({ x: 0, y: 0 }, null, size), { x: 0, y: 0 });
});

test('normalizeRect : largeur positive même en glissant vers le haut-gauche', () => {
  assert.deepEqual(normalizeRect({ x: 80, y: 60 }, { x: 20, y: 10 }, { width: 100, height: 100 }), {
    x: 20,
    y: 10,
    width: 60,
    height: 50,
  });
  // Débordement : la forme reste dans l'image.
  assert.deepEqual(normalizeRect({ x: 90, y: 90 }, { x: 500, y: 500 }, { width: 100, height: 100 }), {
    x: 90,
    y: 90,
    width: 10,
    height: 10,
  });
});

test('arrowHead : pointe orientée, et jamais plus longue que la flèche', () => {
  const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  assert.deepEqual(head[1], { x: 100, y: 0 });
  // Les deux ailes reviennent vers l'origine, symétriques autour de l'axe.
  assert.ok(head[0].x < 100 && head[2].x < 100);
  assert.ok(Math.abs(head[0].y + head[2].y) < 1e-9);
  // Flèche minuscule : la pointe se réduit au lieu de dépasser.
  const tiny = arrowHead({ x: 0, y: 0 }, { x: 5, y: 0 }, 14);
  assert.ok(Math.hypot(tiny[1].x - tiny[0].x, tiny[1].y - tiny[0].y) <= 5);
});

test('pixelateGrid : couvre exactement la zone, bords compris', () => {
  const blocks = pixelateGrid({ x: 10, y: 10, width: 25, height: 10 }, 10);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[2], { x: 30, y: 10, width: 5, height: 10 });
  const area = blocks.reduce((sum, b) => sum + b.width * b.height, 0);
  assert.equal(area, 25 * 10);
  assert.deepEqual(pixelateGrid({ x: 0, y: 0, width: 0, height: 10 }, 10), []);
});

test('pixelateBlockSize : bloc lisible sur une petite image, opaque sur une grande', () => {
  assert.equal(pixelateBlockSize({ width: 400, height: 300 }), 8);
  assert.equal(pixelateBlockSize({ width: 3840, height: 2160 }), 40);
});

test('textFontSize : suit l\'épaisseur choisie', () => {
  assert.ok(textFontSize(2) < textFontSize(14));
  assert.ok(textFontSize(0) >= 12);
});

test('shapeIsMeaningful : un clic sans glissement ne laisse pas d\'artefact', () => {
  assert.equal(shapeIsMeaningful({ tool: 'rect', rect: { width: 2, height: 2 } }), false);
  assert.equal(shapeIsMeaningful({ tool: 'rect', rect: { width: 40, height: 20 } }), true);
  assert.equal(shapeIsMeaningful({ tool: 'text', text: '   ' }), false);
  assert.equal(shapeIsMeaningful({ tool: 'text', text: 'à revoir' }), true);
  assert.equal(shapeIsMeaningful({ tool: 'pen', points: [{ x: 1, y: 1 }] }), false);
  assert.equal(shapeIsMeaningful({ tool: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), false);
  assert.equal(shapeIsMeaningful(null), false);
});

test('nextStepNumber : la numérotation suit, même après une annulation', () => {
  assert.equal(nextStepNumber([]), 1);
  assert.equal(nextStepNumber([{ tool: 'arrow' }]), 1, 'seules les étapes comptent');
  const shapes = [{ tool: 'step', index: 1 }, { tool: 'rect' }, { tool: 'step', index: 2 }];
  assert.equal(nextStepNumber(shapes), 3);
  // Après avoir annulé la 3e, la suivante reprend le numéro 3 — et non 4.
  assert.equal(nextStepNumber(shapes.slice(0, 2)), 2);
  assert.equal(nextStepNumber(null), 1);
});

test('stepRadius : la pastille suit l\'épaisseur, avec un minimum lisible', () => {
  assert.ok(stepRadius(2) >= 11);
  assert.ok(stepRadius(14) > stepRadius(2));
});

test('shapeIsMeaningful : une étape se pose d\'un clic, sans taille', () => {
  assert.equal(shapeIsMeaningful({ tool: 'step', at: { x: 10, y: 10 }, index: 1 }), true);
  assert.equal(shapeIsMeaningful({ tool: 'step' }), false);
});

test('normalizeCrop : borné à l\'image, refusé s\'il ne reste presque rien', () => {
  const image = { width: 1000, height: 800 };
  assert.deepEqual(normalizeCrop({ x: 100, y: 50, width: 400, height: 300 }, image), {
    x: 100,
    y: 50,
    width: 400,
    height: 300,
  });
  // Débordement : ramené dans l'image.
  const clamped = normalizeCrop({ x: 900, y: 700, width: 500, height: 500 }, image);
  assert.deepEqual(clamped, { x: 900, y: 700, width: 100, height: 100 });
  // Clic involontaire : aucun recadrage plutôt qu'une capture de 3 pixels.
  assert.equal(normalizeCrop({ x: 10, y: 10, width: 8, height: 400 }, image), null);
  assert.equal(normalizeCrop({ x: 10, y: 10, width: 0, height: 0 }, image), null);
});

test('cropOrigin : les formes gardent les coordonnées de l\'image d\'origine', () => {
  assert.deepEqual(cropOrigin({ x: 120, y: 40, width: 100, height: 100 }), { x: 120, y: 40 });
  // Sans recadrage, l'origine est le coin de l'image.
  assert.deepEqual(cropOrigin(null), { x: 0, y: 0 });
  assert.deepEqual(cropOrigin({ x: -5, y: 2.6 }), { x: 0, y: 3 });
});

test('pinnedWindowBounds : tient dans l\'écran, reste lisible, se décale en cascade', () => {
  const workArea = { x: 0, y: 30, width: 1920, height: 1050 };

  // Capture de page entière (très haute) : elle tient dans l'écran SANS être
  // déformée — les proportions passent avant le plancher de lisibilité, car
  // la fenêtre est contrainte par son ratio.
  const tall = pinnedWindowBounds({ width: 1200, height: 9000 }, workArea);
  assert.ok(tall.height <= workArea.height, 'doit tenir dans la zone utile');
  assert.ok(Math.abs(tall.width / tall.height - 1200 / 9000) < 0.01, 'proportions conservées');

  // Petite capture : gardée à sa taille réelle (pas d'agrandissement).
  const small = pinnedWindowBounds({ width: 400, height: 300 }, workArea);
  assert.equal(small.width, 400);
  assert.equal(small.height, 300);

  // Posée en haut à droite, dans la zone utile (barre système comprise).
  assert.equal(small.x, workArea.width - 400 - 24);
  assert.equal(small.y, workArea.y + 24);

  // Épinglages successifs : décalés, sinon le second masque exactement le
  // premier. Le décalage sature pour ne pas sortir de l'écran.
  const second = pinnedWindowBounds({ width: 400, height: 300 }, workArea, 1);
  assert.ok(second.x < small.x && second.y > small.y);
  const far = pinnedWindowBounds({ width: 400, height: 300 }, workArea, 99);
  assert.ok(far.x >= workArea.x && far.y + far.height <= workArea.y + workArea.height);

  // Vignette minuscule : agrandie jusqu'au plancher de lisibilité, sans
  // déformation.
  const tiny = pinnedWindowBounds({ width: 20, height: 10 }, workArea);
  assert.ok(tiny.width >= 220 && tiny.height >= 140);
  assert.ok(Math.abs(tiny.width / tiny.height - 2) < 0.01, 'proportions conservées');

  // Écran inconnu : valeurs par défaut plutôt qu'une fenêtre de 0 pixel.
  const fallback = pinnedWindowBounds({ width: 800, height: 600 }, null);
  assert.ok(fallback.width > 0 && fallback.height > 0);
});

test('parsePngDataUrl : seul un PNG en data URL peut devenir un fichier', () => {
  assert.equal(parsePngDataUrl('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(parsePngDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(parsePngDataUrl('data:image/png;base64,../../etc/passwd'), null);
  assert.equal(parsePngDataUrl('file:///etc/passwd'), null);
  assert.equal(parsePngDataUrl(null), null);
  // Garde-fou de taille : une « capture » de 100 Mio n'en est pas une.
  assert.equal(parsePngDataUrl(`data:image/png;base64,${'A'.repeat(MAX_ANNOTATED_BYTES)}`), null);
});

test('ANNOTATION_TOOLS : la barre d\'outils et le dessin parlent de la même liste', () => {
  assert.deepEqual(ANNOTATION_TOOLS, [
    'arrow',
    'rect',
    'ellipse',
    'pen',
    'highlight',
    'text',
    'step',
    'blur',
    'crop',
  ]);
});
