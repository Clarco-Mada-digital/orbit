import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, stepZoom, wheelZoom, ZOOM_MIN, ZOOM_MAX } from '../src/lib/viewZoom.js';

test('stepZoom : paliers, depuis un zoom quelconque, bornés', () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(0.42, 1), 0.5, 'le zoom « Ajuster » rejoint le palier suivant');
  assert.equal(stepZoom(0.42, -1), 0.33);
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX);
  assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN);
});

test('wheelZoom : vers le haut agrandit, vers le bas réduit, borné', () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(8, -10000), ZOOM_MAX);
  assert.equal(clampZoom('x'), 1);
});
