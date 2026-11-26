import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAreaCovered,
  overlayPoints,
  clampDevtoolsHeight,
  clampDevtoolsWidth,
  DEVTOOLS_MIN_WIDTH,
  viewBoundsFromRect,
  DEVTOOLS_MIN_HEIGHT,
  DEVTOOLS_MIN_PAGE,
} from '../src/lib/devtoolsPanel.js';

test('clampDevtoolsHeight : part par défaut, bornes, page toujours visible', () => {
  assert.equal(clampDevtoolsHeight(undefined, 1000), 420);
  assert.equal(clampDevtoolsHeight(300, 1000), 300);
  // Jamais plus que la zone moins la page minimale…
  assert.equal(clampDevtoolsHeight(5000, 1000), 1000 - DEVTOOLS_MIN_PAGE);
  // …ni moins que le minimum du panneau, même dans une zone minuscule.
  assert.equal(clampDevtoolsHeight(10, 1000), DEVTOOLS_MIN_HEIGHT);
  assert.equal(clampDevtoolsHeight(300, 50), DEVTOOLS_MIN_HEIGHT);
  assert.equal(clampDevtoolsHeight('abc', 500), 210);
});

test('viewBoundsFromRect : arrondi vers l’intérieur', () => {
  assert.deepEqual(viewBoundsFromRect({ left: 10.4, top: 20.6, width: 100.5, height: 50.2 }), {
    x: 11,
    y: 21,
    width: 99,
    height: 49,
  });
  assert.deepEqual(viewBoundsFromRect(null), { x: 0, y: 0, width: 0, height: 0 });
});

test('isAreaCovered : un menu qui mord sur un coin suffit à masquer la vue', () => {
  const rect = { left: 100, top: 500, width: 800, height: 300 };
  const area = { getBoundingClientRect: () => rect, contains: (el) => el === inner };
  const inner = {};
  const menu = {};
  assert.equal(overlayPoints(rect).length, 8 * 4 + 4);
  // Rien au-dessus : la zone (ou un de ses enfants) est en haut partout.
  assert.equal(isAreaCovered(area, () => inner), false);
  assert.equal(isAreaCovered(area, () => area), false);
  // Un menu dans le coin haut-gauche seulement.
  assert.equal(isAreaCovered(area, (x, y) => (x < 115 && y < 515 ? menu : area)), true);
  // Le fond du document (coin arrondi de la fenêtre) ne compte pas.
  assert.equal(isAreaCovered(area, () => ({ tagName: 'BODY' })), false);
  // Zone vide ou absente : jamais couverte.
  assert.equal(isAreaCovered(null, () => menu), false);
  assert.deepEqual(overlayPoints({ left: 0, top: 0, width: 0, height: 10 }), []);
});

test('clampDevtoolsWidth : ancré à droite, garde la place de sa barre', () => {
  assert.equal(clampDevtoolsWidth(100, 1600), DEVTOOLS_MIN_WIDTH);
  assert.equal(clampDevtoolsWidth(undefined, 1000), 420);
  assert.equal(clampDevtoolsWidth(5000, 1000), 1000 - DEVTOOLS_MIN_PAGE);
});
