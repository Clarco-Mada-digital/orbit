import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollPositions,
  coveredContent,
  composeStitched,
  backgroundBytes,
} from '../electron/screenshot-stitch.js';

// Une « page » synthétique : chaque ligne de CONTENU porte sa valeur
// (ligne c → octet c % 251), ce qui permet de vérifier qu'aucune ligne ne
// manque ni n'est en double après assemblage.
const W = 6;
function image(width, height, rowValue) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.fill(rowValue(y, x), (y * width + x) * 4, (y * width + x) * 4 + 4);
  }
  return { data, width, height };
}
const at = (img, x, y) => img.data[(y * img.width + x) * 4];

test('scrollPositions : couvre tout, finit au bas, sans dépasser', () => {
  const pos = scrollPositions({ scrollHeight: 1000, clientHeight: 300 });
  assert.equal(pos[0], 0);
  assert.equal(pos.at(-1), 700);
  assert.ok(pos.every((p, i) => i === 0 || p > pos[i - 1]));
  assert.ok(pos.every((p, i) => i === 0 || p - pos[i - 1] <= 300));
  assert.equal(coveredContent(pos, 300), 1000);
  // Contenu qui tient dans l'écran : une seule position.
  assert.deepEqual(scrollPositions({ scrollHeight: 200, clientHeight: 300 }), [0]);
  // Plafond de contenu et de nombre d'étapes.
  assert.equal(coveredContent(scrollPositions({ scrollHeight: 100000, clientHeight: 500, maxContent: 4000 }), 500), 4000);
  assert.equal(scrollPositions({ scrollHeight: 1e6, clientHeight: 10, maxSteps: 5 }).length, 5);
});

test('composeStitched : page qui défile entièrement (document)', () => {
  const viewH = 10;
  const content = 34;
  const pos = scrollPositions({ scrollHeight: content, clientHeight: viewH });
  const shot = (top) => image(W, viewH, (y) => (top + y) % 251);
  const out = composeStitched({
    first: shot(0),
    segments: pos.slice(1).map((top) => ({ ...shot(top), top })),
    layout: { viewW: W, viewH, rect: { x: 0, y: 0, w: W, h: viewH }, content: coveredContent(pos, viewH) },
  });
  assert.equal(out.height, content);
  for (let y = 0; y < content; y += 1) assert.equal(at(out, 2, y), y % 251, `ligne ${y}`);
});

test('composeStitched : appli dont le contenu défile dans un conteneur', () => {
  // Écran de 12 lignes : en-tête (2), conteneur (8 lignes, colonnes 2 à 5),
  // pied (2). Barre latérale en colonnes 0-1. Contenu du conteneur : 30 lignes.
  const viewH = 12;
  const rect = { x: 2, y: 2, w: 4, h: 8 };
  const content = 30;
  const HEADER = 200;
  const FOOTER = 201;
  const SIDE = 202;
  const screen = (top) =>
    image(W, viewH, (y, x) => {
      if (y < 2) return HEADER;
      if (y >= 10) return FOOTER;
      if (x < 2) return SIDE;
      return (top + y - 2) % 251;
    });
  const pos = scrollPositions({ scrollHeight: content, clientHeight: rect.h });
  const crop = (img) => {
    const part = Buffer.alloc(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y += 1) img.data.copy(part, y * rect.w * 4, ((rect.y + y) * W + rect.x) * 4, ((rect.y + y) * W + rect.x + rect.w) * 4);
    return { data: part, width: rect.w, height: rect.h };
  };
  const out = composeStitched({
    first: screen(0),
    segments: pos.slice(1).map((top) => ({ ...crop(screen(top)), top })),
    layout: { viewW: W, viewH, rect, content: coveredContent(pos, rect.h) },
    background: [7, 7, 7, 255],
  });
  // En-tête + tout le contenu + pied.
  assert.equal(out.height, 2 + content + 2);
  assert.equal(at(out, 0, 0), HEADER);
  for (let c = 0; c < content; c += 1) assert.equal(at(out, 3, 2 + c), c % 251, `contenu ${c}`);
  assert.equal(at(out, 0, out.height - 1), FOOTER);
  // La barre latérale est prolongée (sa dernière ligne visible), jamais
  // remplacée par une couleur devinée.
  assert.equal(at(out, 0, 3), SIDE);
  assert.equal(at(out, 0, 2 + 20), SIDE);
});

test('composeStitched : échelle 2 (écran dense) et plafond de hauteur', () => {
  const first = image(W * 2, 20, (y) => Math.floor(y / 2));
  const seg = { ...image(W * 2, 20, (y) => 10 + Math.floor(y / 2)), top: 10 };
  const out = composeStitched({ first, segments: [seg], layout: { viewW: W, viewH: 10, rect: { x: 0, y: 0, w: W, h: 10 }, content: 20 } });
  assert.equal(out.height, 40);
  assert.equal(at(out, 0, 39), 19);
  const capped = composeStitched({ first, segments: [seg], layout: { viewW: W, viewH: 10, rect: { x: 0, y: 0, w: W, h: 10 }, content: 20 }, maxHeight: 25 });
  assert.equal(capped.height, 25);
  assert.equal(capped.truncated, true);
});

test('backgroundBytes : ordre des octets de la plateforme', () => {
  assert.deepEqual(backgroundBytes('rgb(10, 20, 30)'), [30, 20, 10, 255]);
  assert.deepEqual(backgroundBytes('rgba(10, 20, 30, 0.5)', false), [10, 20, 30, 255]);
  assert.deepEqual(backgroundBytes('n’importe quoi'), [255, 255, 255, 255]);
});

test('composeStitched : surface plafonnée (page qui annonce une hauteur démesurée)', async () => {
  const { STITCH_MAX_PIXELS } = await import('../electron/screenshot-stitch.js');
  const width = 5000;
  const first = { data: Buffer.alloc(width * 10 * 4), width, height: 10 };
  const out = composeStitched({ first, layout: { viewW: width, viewH: 10, rect: { x: 0, y: 0, w: width, h: 10 }, content: 1e6 } });
  assert.ok(out.width * out.height <= STITCH_MAX_PIXELS);
  assert.equal(out.truncated, true);
});
