import assert from 'node:assert/strict';
import test from 'node:test';

import { Limiter } from '../electron/download/limiter.js';

test('sans limite, rien n’attend', async () => {
  const limiter = new Limiter(0);
  const started = Date.now();
  await limiter.acquire(50 * 1024 * 1024);
  assert.ok(Date.now() - started < 50, 'aucune attente attendue');
  assert.equal(limiter.get(), null);
});

test('la limite tient la moyenne demandée', async () => {
  const limiter = new Limiter(400 * 1024);
  const started = Date.now();
  for (let i = 0; i < 20; i += 1) await limiter.acquire(10 * 1024); // 200 Ko
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds >= 0.35 && seconds <= 1.2, `${seconds.toFixed(2)} s pour 200 Ko à 400 Ko/s`);
  assert.equal(limiter.taken(), 200 * 1024);
});

test('lever la limite libère immédiatement une attente déjà commencée', async () => {
  const limiter = new Limiter(1024); // 1 Ko/s : 64 Ko = 64 s
  const started = Date.now();
  const pending = limiter.acquire(64 * 1024);
  setTimeout(() => limiter.set(0), 50);
  await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `l’attente a duré ${elapsed} ms`);
  assert.equal(limiter.get(), null);
});

test('refund rend le budget des octets payés mais non gardés', async () => {
  const limiter = new Limiter(0);
  await limiter.acquire(2048);
  assert.equal(limiter.taken(), 2048);
  limiter.refund(2048);
  assert.equal(limiter.taken(), 0);
});
