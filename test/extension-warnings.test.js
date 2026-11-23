import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extensionWarnings, UNSUPPORTED } from '../electron/extension-warnings.js';

// Ces tests protègent surtout contre le DÉFAUT INVERSE de celui qu'on corrige :
// avertir à tort. Les anciens messages prévenaient que toute extension Manifest
// V3 « pourrait ne rien faire » et que declarativeNetRequest n'était pas pris en
// charge — relevé fait, les deux sont faux sur Electron 43. Un avertissement
// systématique et inexact apprend à ne plus lire les avertissements.

test('une extension Manifest V3 ordinaire n’est plus signalée', () => {
  const warnings = extensionWarnings({
    manifest_version: 3,
    name: 'Truc',
    permissions: ['storage', 'activeTab', 'scripting', 'tabs', 'alarms'],
    background: { service_worker: 'sw.js' },
  });
  assert.deepEqual(warnings, []);
});

test('un bloqueur Manifest V3 n’est plus découragé à tort', () => {
  // Relevé : `declarativeNetRequest` fonctionne, règles dynamiques comprises
  // (la requête visée part en ERR_BLOCKED_BY_CLIENT). On conseillait pourtant
  // de revenir à une version « classique » qui n'existe plus chez la plupart
  // des éditeurs.
  const warnings = extensionWarnings({
    manifest_version: 3,
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess'],
  });
  assert.deepEqual(warnings, []);
});

test('le native messaging reste signalé : rien ne peut le combler', () => {
  const [w] = extensionWarnings({ permissions: ['nativeMessaging'] });
  assert.match(w, /native messaging/);
});

test('le menu contextuel absent est annoncé en clair', () => {
  const [w] = extensionWarnings({ manifest_version: 3, permissions: ['contextMenus'] });
  assert.match(w, /clic droit/);
  assert.match(w, /sans effet/);
});

test('plusieurs API manquantes tiennent en une seule ligne', () => {
  // Trois avertissements séparés pour une même extension, personne ne les lit.
  const warnings = extensionWarnings({
    permissions: ['contextMenus', 'notifications', 'bookmarks', 'storage'],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /clic droit/);
  assert.match(warnings[0], /notifications/);
  assert.match(warnings[0], /favoris/);
  // Et on rassure sur le reste : l'extension n'est pas inutilisable.
  assert.match(warnings[0], /fonctionne normalement/);
});

test('les permissions optionnelles comptent aussi', () => {
  const warnings = extensionWarnings({ optional_permissions: ['contextMenus'] });
  assert.equal(warnings.length, 1);
});

test('une permission manquante n’est annoncée qu’une fois', () => {
  const warnings = extensionWarnings({
    permissions: ['contextMenus'],
    optional_permissions: ['contextMenus'],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].match(/clic droit/g).length, 1);
});

test('les clés de manifeste sans équivalent sont signalées', () => {
  const [w] = extensionWarnings({ commands: { foo: {} } });
  assert.match(w, /raccourcis clavier/);
  const [w2] = extensionWarnings({ devtools_page: 'devtools.html' });
  assert.match(w2, /outils de développement/);
});

test('un manifeste vide ou absurde ne jette pas', () => {
  assert.deepEqual(extensionWarnings(null), []);
  assert.deepEqual(extensionWarnings(undefined), []);
  assert.deepEqual(extensionWarnings({}), []);
  assert.deepEqual(extensionWarnings('pas un objet'), []);
  // `permissions` mal typé (manifeste bricolé à la main) ne doit pas casser.
  assert.deepEqual(extensionWarnings({ permissions: 'storage' }), []);
});

test('les API mesurées comme présentes ne figurent pas dans la liste', () => {
  // Relevé sur Electron 43 : ces API répondent bien dans un service worker MV3.
  for (const ok of ['storage', 'tabs', 'scripting', 'alarms', 'idle', 'webRequest', 'declarativeNetRequest', 'management', 'offscreen']) {
    assert.equal(
      UNSUPPORTED.permissions.includes(ok),
      false,
      `${ok} est disponible : il ne doit pas déclencher d’avertissement`
    );
  }
});
