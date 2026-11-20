import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropZoneAt, splitForDrop, previewRect } from '../src/lib/splitDrop.js';

const rect = { left: 100, top: 50, width: 1000, height: 600 };

test('zone visée selon la position du pointeur', () => {
  assert.equal(dropZoneAt(120, 300, rect), 'left');
  assert.equal(dropZoneAt(1080, 300, rect), 'right');
  assert.equal(dropZoneAt(600, 60, rect), 'top');
  assert.equal(dropZoneAt(600, 640, rect), 'bottom');
  assert.equal(dropZoneAt(600, 350, rect), 'center');
  // coin : le bord le plus proche gagne
  assert.equal(dropZoneAt(105, 120, rect), 'left');
});

test('centre : remplace l’app affichée sans partage', () => {
  assert.deepEqual(splitForDrop(null, 'a', 'b', 'center'), { splitView: undefined, activeApp: 'b' });
});

test('premier partage : côté et direction', () => {
  assert.deepEqual(splitForDrop(null, 'a', 'b', 'right').splitView, {
    appIds: ['a', 'b'], direction: 'row', sizes: [0.5, 0.5],
  });
  assert.deepEqual(splitForDrop(null, 'a', 'b', 'left').splitView.appIds, ['b', 'a']);
  assert.equal(splitForDrop(null, 'a', 'b', 'top').splitView.direction, 'col');
  assert.equal(splitForDrop(null, 'a', 'a', 'left'), null);
});

test('partage existant : ajout, déplacement, plafond de 4', () => {
  const two = { appIds: ['a', 'b'], direction: 'row', sizes: [0.6, 0.4] };
  const three = splitForDrop(two, 'a', 'c', 'right').splitView;
  assert.deepEqual(three.appIds, ['a', 'b', 'c']);
  assert.equal(three.sizes, undefined);

  const moved = splitForDrop(two, 'a', 'b', 'left').splitView;
  assert.deepEqual(moved.appIds, ['b', 'a']);

  const four = { appIds: ['a', 'b', 'c', 'd'], layout: 'grid' };
  const full = splitForDrop(four, 'a', 'e', 'right').splitView;
  assert.equal(full.appIds.length, 4);
  assert.ok(full.appIds.includes('a'));
  assert.ok(full.appIds.includes('e'));
});

test('partage qui ne contient pas l’app affichée : nouveau partage', () => {
  const other = { appIds: ['x', 'y'], direction: 'row' };
  assert.deepEqual(splitForDrop(other, 'a', 'b', 'right').splitView.appIds, ['a', 'b']);
});

test('aperçu : moitié correspondante', () => {
  assert.deepEqual(previewRect('right'), { left: 0.5, top: 0, width: 0.5, height: 1 });
  assert.deepEqual(previewRect('center'), { left: 0, top: 0, width: 1, height: 1 });
});
