import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepSegments, keptDuration, normalizeCuts } from '../src/lib/videoEdit.js';

// L'édition vidéo repose sur une seule question : QUE garde-t-on ? Une erreur
// ici ne se voit pas dans l'interface — elle produit une vidéo amputée d'un
// passage utile, ou un fichier que ffmpeg refuse de fabriquer.

test('sans coupe : un seul segment, de la plage choisie', () => {
  assert.deepEqual(keepSegments({ start: 2, end: 12 }), [{ start: 2, end: 12 }]);
});

test('une coupe au milieu laisse deux segments', () => {
  assert.deepEqual(keepSegments({ start: 0, end: 20, cuts: [{ start: 5, end: 8 }] }), [
    { start: 0, end: 5 },
    { start: 8, end: 20 },
  ]);
});

test('une coupe au tout début ne laisse pas de segment vide', () => {
  assert.deepEqual(keepSegments({ start: 0, end: 20, cuts: [{ start: 0, end: 4 }] }), [
    { start: 4, end: 20 },
  ]);
});

test('une coupe jusqu’à la fin ne laisse pas de segment vide', () => {
  assert.deepEqual(keepSegments({ start: 0, end: 20, cuts: [{ start: 15, end: 20 }] }), [
    { start: 0, end: 15 },
  ]);
});

test('les coupes qui se chevauchent sont fusionnées', () => {
  assert.deepEqual(
    keepSegments({ start: 0, end: 30, cuts: [{ start: 5, end: 10 }, { start: 8, end: 14 }] }),
    [{ start: 0, end: 5 }, { start: 14, end: 30 }]
  );
});

test('les coupes sont bornées à la plage conservée', () => {
  assert.deepEqual(
    keepSegments({ start: 10, end: 20, cuts: [{ start: 4, end: 12 }, { start: 18, end: 40 }] }),
    [{ start: 12, end: 18 }]
  );
});

test('tout supprimer ne rend aucun segment (l’appelant doit refuser)', () => {
  assert.deepEqual(keepSegments({ start: 0, end: 10, cuts: [{ start: 0, end: 10 }] }), []);
});

test('sans fin connue, la durée fournie sert de borne', () => {
  assert.deepEqual(keepSegments({ start: 1, cuts: [{ start: 4, end: 6 }], duration: 10 }), [
    { start: 1, end: 4 },
    { start: 6, end: 10 },
  ]);
});

test('les coupes invalides ou vides sont ignorées', () => {
  assert.deepEqual(normalizeCuts([null, { start: 3, end: 3 }, { start: 8, end: 2 }], 0, 20), []);
});

test('la durée finale est la somme des segments gardés', () => {
  const total = keptDuration({ start: 0, end: 20, cuts: [{ start: 5, end: 8 }] });
  assert.equal(total, 17);
});
