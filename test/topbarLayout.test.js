import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTopbar,
  availableModules,
  TOPBAR_ZONES,
} from '../src/lib/topbarLayout.js';

test('normalizeTopbar : retire les ids inconnus (anciennes versions)', () => {
  const out = normalizeTopbar({ left: ['logo', 'bogus'], center: [], right: [] });
  assert.deepEqual(out.left, ['logo']);
});

test('normalizeTopbar : retire les doublons, sauf les séparateurs', () => {
  const out = normalizeTopbar({ left: ['nav', 'nav'], center: ['divider', 'divider'], right: [] });
  assert.deepEqual(out.left, ['nav']);
  assert.deepEqual(out.center, ['divider', 'divider']); // divider = répétable
});

test('normalizeTopbar : complète les zones manquantes depuis le fallback', () => {
  const out = normalizeTopbar({ left: ['logo'] });
  assert.ok(TOPBAR_ZONES.every((z) => Array.isArray(out[z])));
});

test('availableModules : exclut les non-répétables déjà placés', () => {
  const avail = availableModules({ left: ['vault'], center: [], right: [] });
  assert.ok(!avail.some((m) => m.id === 'vault'));
  assert.ok(avail.some((m) => m.id === 'divider')); // répétable → toujours dispo
});
