import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { permissionPageState } from '../electron/permission-rules.js';
import * as sitePermissions from '../electron/site-permissions.js';

const SITE = 'https://meet.example.com';

test('rien de décidé en mode « demander » → la page voit « prompt », pas « denied »', () => {
  assert.equal(permissionPageState('notifications', 'ask', null, SITE), 'prompt');
  assert.equal(permissionPageState('media', 'ask', null, SITE), 'prompt');
});

test('les décisions mémorisées priment', () => {
  assert.equal(permissionPageState('media', 'ask', 'allow', SITE), 'granted');
  assert.equal(permissionPageState('media', 'allow', 'deny', SITE), 'denied');
});

test('modes globaux et origine illisible', () => {
  assert.equal(permissionPageState('media', 'allow', null, SITE), 'granted');
  assert.equal(permissionPageState('media', 'deny', null, SITE), 'denied');
  assert.equal(permissionPageState('media', 'ask', null, null), 'denied');
});

test('réponse sans « retenir » : valable pour la session, jamais écrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-perm-'));
  sitePermissions.init(dir);
  sitePermissions.rememberForSession(SITE, 'media', true);
  assert.equal(sitePermissions.decisionFor(SITE, 'media'), 'allow');
  assert.deepEqual(sitePermissions.list(), []);
  assert.deepEqual(sitePermissions.forSite(SITE), { media: { value: 'allow', scope: 'session' } });

  // Réglage depuis la barre : enregistré, et remplace le choix de session.
  sitePermissions.set(SITE, 'media', 'deny');
  assert.deepEqual(sitePermissions.forSite(SITE), { media: { value: 'deny', scope: 'saved' } });

  // Retour à « Demander ».
  sitePermissions.set(SITE, 'media', null);
  assert.equal(sitePermissions.decisionFor(SITE, 'media'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
