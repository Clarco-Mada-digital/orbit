import assert from 'node:assert/strict';
import test from 'node:test';

import { DOWNLOAD_CATEGORIES, downloadCategory } from '../src/lib/downloadCategories.js';

test('chaque type de fichier courant tombe dans son dossier', () => {
  assert.equal(downloadCategory('photo.PNG'), DOWNLOAD_CATEGORIES.images);
  assert.equal(downloadCategory('film.mkv'), DOWNLOAD_CATEGORIES.video);
  assert.equal(downloadCategory('album.flac'), DOWNLOAD_CATEGORIES.audio);
  assert.equal(downloadCategory('rapport final.pdf'), DOWNLOAD_CATEGORIES.documents);
  assert.equal(downloadCategory('sauvegarde.tar.gz'), DOWNLOAD_CATEGORIES.archives);
  assert.equal(downloadCategory('installateur.deb'), DOWNLOAD_CATEGORIES.programs);
});

test('ce qui n’est pas reconnu va dans « Autres », sans deviner', () => {
  assert.equal(downloadCategory('donnees.xyz'), DOWNLOAD_CATEGORIES.other);
  assert.equal(downloadCategory('sans-extension'), DOWNLOAD_CATEGORIES.other);
  assert.equal(downloadCategory(''), DOWNLOAD_CATEGORIES.other);
});

test('un nom composé ne sort jamais du dossier de classement', () => {
  // Le nom est réduit à son dernier segment : « ../ » ne remonte pas.
  assert.equal(downloadCategory('../../etc/passwd.zip'), DOWNLOAD_CATEGORIES.archives);
});
