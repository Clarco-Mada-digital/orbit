import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDue,
  nextRunDate,
  archiveName,
  safeName,
  archivesToPrune,
} from '../electron/vault-backup-rules.js';

const HOUR = 3600 * 1000;

test('jamais sauvegardé = dû tout de suite', () => {
  // Attendre 24 h après l'activation laisserait croire que c'est en place
  // alors qu'aucune archive n'existerait encore.
  assert.equal(isDue(0, 24), true);
  assert.equal(isDue(undefined, 24), true);
  assert.equal(nextRunDate(0, 24), 0); // l'interface dit « dès que possible »
});

test('la cadence est respectée ensuite', () => {
  const last = 1_000_000;
  assert.equal(isDue(last, 24, last + 23 * HOUR), false);
  assert.equal(isDue(last, 24, last + 24 * HOUR), true);
  assert.equal(isDue(last, 24, last + 48 * HOUR), true);
  assert.equal(nextRunDate(last, 24), last + 24 * HOUR);
  assert.equal(nextRunDate(last, 6), last + 6 * HOUR);
});

test('une cadence absurde retombe sur une valeur utilisable', () => {
  // Un réglage à 0 ou négatif ne doit pas produire une sauvegarde en boucle.
  const last = 1_000_000;
  assert.equal(nextRunDate(last, 0), last + 24 * HOUR);
  assert.equal(nextRunDate(last, -5), last + HOUR);
  assert.equal(nextRunDate(last, undefined), last + 24 * HOUR);
});

test('le nom d’archive est trié chronologiquement par ordre alphabétique', () => {
  const a = archiveName('Boulot', new Date('2026-01-02T03:04:05.678Z'));
  const b = archiveName('Boulot', new Date('2026-01-02T04:00:00.000Z'));
  assert.equal(a, 'orbit-boulot-2026-01-02T03-04-05.orbitvault');
  assert.ok(a < b);
  // Les noms de trousseau sont assainis : pas de séparateur de chemin, pas
  // d'espace, accents conservés.
  assert.equal(safeName('Perso / Banque'), 'perso-banque');
  assert.equal(safeName('../../etc'), '-etc');
  assert.equal(safeName(''), 'trousseau');
  assert.ok(!archiveName('a/b').includes('/'));
});

test('la rotation ne garde que les N plus récentes, par trousseau', () => {
  const files = [
    'orbit-boulot-2026-01-01T00-00-00.orbitvault',
    'orbit-boulot-2026-01-02T00-00-00.orbitvault',
    'orbit-boulot-2026-01-03T00-00-00.orbitvault',
    'orbit-perso-2026-01-03T00-00-00.orbitvault',
    'notes.txt',
  ];
  assert.deepEqual(archivesToPrune(files, 'Boulot', 2), [
    'orbit-boulot-2026-01-01T00-00-00.orbitvault',
  ]);
  // Les archives d'un AUTRE trousseau ne sont jamais touchées…
  assert.deepEqual(archivesToPrune(files, 'perso', 1), []);
  // …ni les fichiers qui ne sont pas des archives Orbit.
  assert.equal(
    archivesToPrune(files, 'Boulot', 1).every((f) => f.endsWith('.orbitvault')),
    true
  );
});

test('la rotation ne peut jamais vider le dossier', () => {
  const files = ['orbit-a-2026-01-01T00-00-00.orbitvault', 'orbit-a-2026-01-02T00-00-00.orbitvault'];
  // keep à 0, négatif ou absurde : on garde au moins la plus récente.
  for (const keep of [0, -3, undefined, NaN, null]) {
    const pruned = archivesToPrune(files, 'a', keep);
    assert.equal(pruned.length, files.length - 1);
    assert.equal(pruned.includes('orbit-a-2026-01-02T00-00-00.orbitvault'), false);
  }
});

test('un dossier vide ou illisible ne fait rien supprimer', () => {
  assert.deepEqual(archivesToPrune([], 'a', 3), []);
  assert.deepEqual(archivesToPrune(undefined, 'a', 3), []);
  assert.deepEqual(archivesToPrune([null, 42], 'a', 3), []);
});
