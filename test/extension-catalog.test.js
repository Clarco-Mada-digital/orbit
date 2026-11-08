import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bundledInstallState,
  compareExtensionVersions,
  isSafeCatalogFile,
  normalizeCatalogEntry,
  normalizeCatalog,
  extensionDownloadUrl,
  catalogIsStale,
  CATALOG_TTL_MS,
  MAX_EXTENSION_BYTES,
} from '../src/lib/extensionCatalog.js';

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

// ---------------------------------------------------------------------------
// Catalogue DISTANT : tout ce qui suit décide quoi télécharger et depuis où.
// C'est du code de sécurité — le catalogue vient du réseau.
// ---------------------------------------------------------------------------

const VALID = {
  file: 'orbit-phone.zip',
  name: 'Téléphone Orbit',
  version: '1.4.0',
  description: 'Fenêtres de bureau pour les applications Android.',
  nativeApp: 'phone',
  size: 11826,
  sha256: 'a'.repeat(64),
};

test('isSafeCatalogFile : un nom d\'archive, pas un chemin', () => {
  for (const ok of ['orbit-phone.zip', 'a.zip', 'web_clipper.1.zip', 'QR-2.zip']) {
    assert.equal(isSafeCatalogFile(ok), true, ok);
  }
  for (const no of [
    '../../etc/passwd.zip',      // remontée de dossier
    'sub/dir/ext.zip',           // séparateur
    'sub\\dir\\ext.zip',
    '/absolu.zip',
    'ext.zip.exe',               // pas une archive
    'ext.ZIP ',                  // espace en fin
    '.hidden.zip',               // commence par un point
    'ext.zip?x=1',
    '',
    null,
    `${'a'.repeat(120)}.zip`,    // trop long
  ]) {
    assert.equal(isSafeCatalogFile(no), false, String(no));
  }
});

test('normalizeCatalogEntry : une entrée sans empreinte est refusée', () => {
  assert.deepEqual(normalizeCatalogEntry(VALID), VALID);
  // L'empreinte est la seule chose qui distingue l'archive publiée d'une
  // archive substituée : sans elle, pas d'installation.
  assert.equal(normalizeCatalogEntry({ ...VALID, sha256: undefined }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, sha256: 'trop-court' }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, sha256: `${'A'.repeat(63)}z` }), null);
  // Majuscules acceptées mais normalisées (la comparaison se fait en minuscules).
  assert.equal(normalizeCatalogEntry({ ...VALID, sha256: 'A'.repeat(64) }).sha256, 'a'.repeat(64));
});

test('normalizeCatalogEntry : taille, version et app native sous contrôle', () => {
  assert.equal(normalizeCatalogEntry({ ...VALID, size: 0 }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, size: -1 }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, size: 1.5 }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, size: MAX_EXTENSION_BYTES + 1 }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, version: 'latest' }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, version: '' }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, version: '1.2.3-beta.1' }).version, '1.2.3-beta.1');
  // `nativeApp` sert à activer une app INTÉGRÉE : sa forme est stricte.
  assert.equal(normalizeCatalogEntry({ ...VALID, nativeApp: '../../phone' }), null);
  assert.equal(normalizeCatalogEntry({ ...VALID, nativeApp: null }).nativeApp, null);
  assert.equal(normalizeCatalogEntry({ ...VALID, name: '' }), null);
  assert.equal(normalizeCatalogEntry(null), null);
  // Description tronquée, jamais refusée pour sa longueur.
  assert.equal(normalizeCatalogEntry({ ...VALID, description: 'x'.repeat(900) }).description.length, 500);
});

test('normalizeCatalog : une entrée pourrie ne vide pas le magasin', () => {
  const catalog = normalizeCatalog({
    version: 1,
    generatedAt: '2026-11-08T10:00:00.000Z',
    extensions: [
      VALID,
      { ...VALID, file: 'cassee.zip', sha256: 'nope' },     // écartée
      { ...VALID, file: 'autre.zip', name: 'Aa Clipper' },  // gardée
      { ...VALID, name: 'Doublon' },                        // même fichier → écartée
      'pas un objet',
    ],
  });
  assert.equal(catalog.extensions.length, 2);
  // Triées par nom : la liste à l'écran ne saute pas d'un rafraîchissement à
  // l'autre selon l'ordre du fichier publié.
  assert.deepEqual(catalog.extensions.map((e) => e.name), ['Aa Clipper', 'Téléphone Orbit']);
  assert.equal(catalog.generatedAt, '2026-11-08T10:00:00.000Z');
  // Un catalogue vide ou illisible donne une liste vide, pas une exception.
  assert.deepEqual(normalizeCatalog(null).extensions, []);
  assert.deepEqual(normalizeCatalog({ extensions: 'non' }).extensions, []);
});

test('extensionDownloadUrl : l\'archive se télécharge À CÔTÉ du catalogue', () => {
  const base = 'https://clarco-mada-digital.github.io/orbit/extensions/catalog.json';
  assert.equal(
    extensionDownloadUrl(base, 'orbit-phone.zip'),
    'https://clarco-mada-digital.github.io/orbit/extensions/orbit-phone.zip'
  );
  // Un nom qui tenterait de sortir du dossier est refusé en amont.
  assert.equal(extensionDownloadUrl(base, '../../evil.zip'), null);
  assert.equal(extensionDownloadUrl(base, 'https://evil.example/x.zip'), null);
  assert.equal(extensionDownloadUrl(base, '//evil.example/x.zip'), null);
  // En clair : jamais.
  assert.equal(extensionDownloadUrl('http://exemple.fr/extensions/catalog.json', 'a.zip'), null);
  assert.equal(extensionDownloadUrl('pas-une-url', 'a.zip'), null);
});

test('catalogIsStale : une copie datée se dit datée', () => {
  const now = 1_800_000_000_000;
  assert.equal(catalogIsStale(now - 1000, now), false);
  assert.equal(catalogIsStale(now - CATALOG_TTL_MS - 1, now), true);
  // Jamais récupéré : vieux par défaut, donc on tente le réseau.
  assert.equal(catalogIsStale(0, now), true);
  assert.equal(catalogIsStale(undefined, now), true);
});
