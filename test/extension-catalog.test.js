import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledInstallState, compareExtensionVersions } from '../src/lib/extensionCatalog.js';

test('compareExtensionVersions : compare des nombres, pas des chaînes', () => {
  assert.equal(compareExtensionVersions('1.1.0', '1.0.0'), 1);
  assert.equal(compareExtensionVersions('1.0.0', '1.1.0'), -1);
  assert.equal(compareExtensionVersions('1.0.0', '1.0.0'), 0);
  // Le piège de la comparaison alphabétique : « 1.10.0 » < « 1.9.0 » en texte.
  assert.equal(compareExtensionVersions('1.10.0', '1.9.3'), 1);
  // Segments manquants = 0.
  assert.equal(compareExtensionVersions('2', '2.0.0'), 0);
  assert.equal(compareExtensionVersions('2.0.1', '2'), 1);
  // Versions illisibles : égales, donc aucune mise à jour inventée.
  assert.equal(compareExtensionVersions('', ''), 0);
  assert.equal(compareExtensionVersions(undefined, 'abc'), 0);
});

test('bundledInstallState : absente → installable', () => {
  const state = bundledInstallState({ name: 'Souris & Défilement', version: '1.1.0' }, []);
  assert.deepEqual(state, { state: 'install', installedVersion: null });
});

test('bundledInstallState : version plus récente livrée → mise à jour proposée', () => {
  // LE cas qui manquait : l'ancienne version restait active, le bouton était
  // grisé sur « Installée », et rien ne disait qu'une version plus récente
  // était livrée avec Orbit.
  const state = bundledInstallState(
    { name: 'Souris & Défilement', version: '1.1.0' },
    [{ name: 'Souris & Défilement', version: '1.0.0', id: 'abc' }]
  );
  assert.deepEqual(state, { state: 'update', installedVersion: '1.0.0' });
});

test('bundledInstallState : même version → rien à faire', () => {
  const state = bundledInstallState(
    { name: 'Téléphone Orbit', version: '1.4.0' },
    [{ name: 'Téléphone Orbit', version: '1.4.0' }]
  );
  assert.equal(state.state, 'installed');
});

test('bundledInstallState : installée plus récente que l\'archive → rien à faire', () => {
  // Extension installée à la main depuis un ZIP plus récent : Orbit ne doit
  // pas proposer de revenir en arrière.
  const state = bundledInstallState(
    { name: 'Web Clipper', version: '1.0.0' },
    [{ name: 'Web Clipper', version: '2.0.0' }]
  );
  assert.equal(state.state, 'installed');
});

test('bundledInstallState : rapprochement par nom, pas par identifiant', () => {
  // L'ID d'une extension non empaquetée est dérivé du dossier d'extraction :
  // il change à chaque installation et ne peut pas servir de repère.
  const state = bundledInstallState(
    { name: 'Color Picker', version: '1.2.0', file: 'color-picker.zip' },
    [{ name: 'Color Picker', version: '1.1.0', id: 'identifiant-tout-neuf' }]
  );
  assert.equal(state.state, 'update');
  // Une entrée sans nom ne doit jamais se faire passer pour l'extension.
  assert.equal(bundledInstallState({ name: 'X', version: '1' }, [{ version: '1' }]).state, 'install');
});
