import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSharedSettingsStore,
  readOrbitManifestFlags,
  MAX_SHARED_BYTES,
} from '../electron/extension-shared-settings.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-shared-')), 'shared.json');

test('une session reçoit la copie de référence une seule fois', () => {
  const store = createSharedSettingsStore(tmpFile());
  assert.equal(store.pending('persist:a', 'Text Snippets'), null);
  assert.equal(store.update('Text Snippets', { trigger: ';' }, 'persist:a'), 1);
  // La session source l'a déjà, les autres non.
  assert.equal(store.pending('persist:a', 'Text Snippets'), null);
  assert.deepEqual(store.pending('persist:b', 'Text Snippets'), { rev: 1, data: { trigger: ';' } });
  store.markPushed('persist:b', 'Text Snippets', 1);
  assert.equal(store.pending('persist:b', 'Text Snippets'), null);
});

test('un nouvel enregistrement relance la diffusion ; un identique non', () => {
  const store = createSharedSettingsStore(tmpFile());
  store.update('X', { a: 1 }, 'persist:a');
  store.markPushed('persist:b', 'X', 1);
  assert.equal(store.update('X', { a: 1 }, 'persist:b'), null);
  assert.equal(store.update('X', { a: 2 }, 'persist:b'), 2);
  assert.equal(store.pending('persist:a', 'X').rev, 2);
  assert.equal(store.pending('persist:b', 'X'), null);
});

test('la comptabilité survit au redémarrage', () => {
  const file = tmpFile();
  const first = createSharedSettingsStore(file);
  first.update('X', { a: 1 }, 'persist:a');
  first.markPushed('persist:b', 'X', 1);
  const again = createSharedSettingsStore(file);
  assert.deepEqual(again.get('X'), { rev: 1, data: { a: 1 } });
  assert.equal(again.pending('persist:b', 'X'), null);
  assert.equal(again.pending('persist:c', 'X').rev, 1);
});

test('données invalides ou trop lourdes refusées', () => {
  const store = createSharedSettingsStore(tmpFile());
  assert.equal(store.update('X', null), null);
  assert.equal(store.update('X', [1, 2]), null);
  assert.equal(store.update('X', { big: 'x'.repeat(MAX_SHARED_BYTES) }), null);
  assert.equal(store.get('X'), null);
});

test('readOrbitManifestFlags lit le drapeau sharedSettings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ext-'));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: 'Text Snippets', options_ui: { page: 'options.html' }, orbit: { sharedSettings: true } })
  );
  assert.deepEqual(readOrbitManifestFlags(dir), { name: 'Text Snippets', optionsPage: 'options.html', sharedSettings: true });
  assert.equal(readOrbitManifestFlags(path.join(dir, 'absent')).sharedSettings, false);
});
