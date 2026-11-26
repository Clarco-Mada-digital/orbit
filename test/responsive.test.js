import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICES,
  deviceById,
  clampSize,
  responsiveState,
  viewportOf,
  displayScale,
  userAgentFor,
  MIN_SIZE,
  MAX_SIZE,
} from '../src/lib/responsive.js';

test('appareils : identifiants uniques, tailles plausibles', () => {
  const ids = DEVICES.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of DEVICES) assert.ok(d.width >= MIN_SIZE && d.height >= MIN_SIZE, d.id);
  assert.equal(deviceById('inconnu').id, 'responsive');
});

test('responsiveState : un mobile active tactile et agent mobile, pas un bureau', () => {
  const phone = responsiveState('iphone-se');
  assert.deepEqual([phone.width, phone.height, phone.touch, phone.mobileUa], [375, 667, true, true]);
  const desk = responsiveState('desktop', { zoom: 0.5 });
  assert.equal(desk.touch, false);
  assert.equal(desk.mobileUa, false);
  assert.equal(desk.zoom, 0.5, 'le zoom choisi est conservé d’un appareil à l’autre');
});

test('viewportOf et clampSize : rotation, bornes', () => {
  assert.deepEqual(viewportOf({ width: 375, height: 667, rotated: true }), { width: 667, height: 375 });
  assert.equal(clampSize(10), MIN_SIZE);
  assert.equal(clampSize(99999), MAX_SIZE);
  assert.equal(clampSize('abc'), MIN_SIZE);
});

test('displayScale : ajuste sans jamais agrandir', () => {
  const stage = { width: 1000, height: 800 };
  // Un téléphone tient : échelle 1, pas d'agrandissement.
  assert.equal(displayScale(responsiveState('iphone-se'), stage), 1);
  // Un écran Full HD est réduit pour tenir.
  const s = displayScale(responsiveState('desktop'), stage);
  assert.ok(s < 1 && 1920 * s <= 1000 - 48 + 1e-9 && 1080 * s <= 800 - 48 + 1e-9);
  // Zoom fixe.
  assert.equal(displayScale({ ...responsiveState('desktop'), zoom: 0.5 }, stage), 0.5);
});

test('userAgentFor : seulement si demandé', () => {
  assert.match(userAgentFor(responsiveState('iphone-15')), /iPhone/);
  assert.match(userAgentFor(responsiveState('pixel-8')), /Android/);
  assert.equal(userAgentFor({ ...responsiveState('iphone-15'), mobileUa: false }), null);
  // Taille libre avec agent mobile : Android par défaut.
  assert.match(userAgentFor({ ...responsiveState('responsive'), mobileUa: true }), /Android/);
});

test('zoomPlan : boîte entière, zoom déduit, jamais sous 25 %', async () => {
  const { zoomPlan } = await import('../src/lib/responsive.js');
  assert.deepEqual(zoomPlan({ width: 393, height: 852 }, 1), { zoom: 1, boxWidth: 393, boxHeight: 852 });
  const p = zoomPlan({ width: 768, height: 1024 }, 0.49);
  assert.ok(Number.isInteger(p.boxWidth));
  assert.equal(p.boxWidth / p.zoom, 768, 'la page voit exactement la largeur demandée');
  assert.equal(zoomPlan({ width: 1920, height: 1080 }, 0.1).zoom, 0.25);
  // Loupe : au-delà de 100 %, largeur toujours exacte pour la page.
  const big = zoomPlan({ width: 393, height: 852 }, 2);
  assert.equal(big.boxWidth, 786);
  assert.equal(big.boxWidth / big.zoom, 393);
  assert.equal(zoomPlan({ width: 393, height: 852 }, 9).zoom, 4);
});

test('réseau : profils de Chrome, « aucun » sans conditions', async () => {
  const { NETWORK_PRESETS, networkConditionsFor } = await import('../src/lib/responsive.js');
  assert.equal(networkConditionsFor('none'), null);
  assert.equal(networkConditionsFor('inconnu'), null);
  assert.equal(networkConditionsFor('offline').offline, true);
  const slow = networkConditionsFor('slow3g');
  assert.equal(slow.latency, 2000);
  assert.equal(slow.download, 50000); // 400 kbit/s
  assert.equal(new Set(NETWORK_PRESETS.map((p) => p.id)).size, NETWORK_PRESETS.length);
});

test('deviceFrame : le cadre entoure l’écran, îlot caméra centré', async () => {
  const { deviceFrame } = await import('../src/lib/responsive.js');
  const f = deviceFrame('phone', 393, 852);
  assert.equal(f.width, 393 + f.bezel * 2);
  assert.ok(f.island && Math.abs(f.island.x + f.island.w / 2 - f.width / 2) < 1, 'îlot centré');
  const land = deviceFrame('phone', 852, 393);
  assert.ok(land.island.h > land.island.w, 'paysage : îlot sur le côté');
  assert.equal(deviceFrame('tablet', 820, 1180).island, null);
  assert.equal(deviceFrame('desktop', 1920, 1080).bezel, 10);
});

test('tileOffsets : couvre tout, dernière tuile collée au bord', async () => {
  const { tileOffsets } = await import('../src/lib/responsive.js');
  assert.deepEqual(tileOffsets(500, 800), [0]);
  assert.deepEqual(tileOffsets(1000, 400), [0, 400, 600]);
  assert.deepEqual(tileOffsets(800, 400), [0, 400]);
});

test('multiScale : échelle commune qui fait tout tenir', async () => {
  const { multiScale } = await import('../src/lib/responsive.js');
  const views = [{ width: 393, height: 852 }, { width: 820, height: 1180 }, { width: 1366, height: 768 }];
  const s = multiScale(views, { width: 1200, height: 700 });
  const sumW = views.reduce((a, v) => a + v.width * s, 0) + 24 * 2;
  assert.ok(sumW <= 1200 - 48 + 1e-6);
  assert.ok(1180 * s <= 700 - 48 - 28 + 1e-6);
  assert.equal(multiScale([{ width: 100, height: 100 }], { width: 2000, height: 2000 }), 1);
});

test('zoomPlan partagé : même zoom pour tous, largeur exacte vue par chaque page', async () => {
  const { zoomPlan } = await import('../src/lib/responsive.js');
  const a = zoomPlan({ width: 1366, height: 768 }, 0.4371, { shared: true });
  const b = zoomPlan({ width: 393, height: 852 }, 0.4371, { shared: true });
  assert.equal(a.zoom, b.zoom);
  assert.ok(Math.abs(a.boxWidth / a.zoom - 1366) < 1e-9);
  assert.ok(Math.abs(b.boxWidth / b.zoom - 393) < 1e-9);
});
