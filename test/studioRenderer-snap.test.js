import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapRect } from '../src/lib/studioRenderer.js';

test('snapRect : cale le rectangle sur les pixels entiers sans le déplacer de plus d’un pixel', () => {
  assert.deepEqual(snapRect({ x: 64.8, y: 32.4, w: 1790.4, h: 1006.7 }), { x: 65, y: 32, w: 1790, h: 1007 });
  // Un rectangle déjà entier reste identique.
  assert.deepEqual(snapRect({ x: 10, y: 20, w: 300, h: 200 }), { x: 10, y: 20, w: 300, h: 200 });
});
