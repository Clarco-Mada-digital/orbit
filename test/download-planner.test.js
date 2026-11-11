import assert from 'node:assert/strict';
import test from 'node:test';

import { Planner } from '../electron/download/planner.js';

const MB = 1024 * 1024;

test('le planificateur commence par un seul segment couvrant le fichier', () => {
  const planner = new Planner(10 * MB, MB);
  assert.equal(planner.segs.length, 1);
  assert.deepEqual(planner.save(), [{ start: 0, cursor: 0, end: 10 * MB }]);
  assert.equal(planner.downloaded(), 0);
  assert.equal(planner.isComplete(), false);
});

test('un worker libre coupe en deux la plus grosse part restante', () => {
  const planner = new Planner(10 * MB, MB);
  const first = planner.assign(1);
  assert.deepEqual([first.from, first.to], [0, 10 * MB]);

  // Le worker 2 n'a plus de part libre : il coupe. La part haute commence au
  // milieu, alignée sur 4 Ko.
  const second = planner.assign(2);
  assert.equal(second.from % 4096, 0);
  assert.equal(second.from, 5 * MB);
  assert.equal(planner.segs.length, 2);
  assert.equal(planner.segs[0].end, 5 * MB);

  // Le worker 3 coupe à nouveau la plus grosse part (0 → 5 Mo).
  const third = planner.assign(3);
  assert.equal(third.from, Math.floor(2.5 * MB / 4096) * 4096 + 5 * MB);
  assert.equal(planner.segs.length, 3);
});

test('aucune coupure sous la taille minimale d’une part', () => {
  const planner = new Planner(3 * 1024 * 1024, MB);
  planner.assign(1);
  planner.assign(2); // coupe 3 Mo en deux parts de 1,5 Mo
  // 1,5 Mo → deux moitiés de 750 Ko : sous le minimum, on refuse la coupure.
  assert.equal(planner.assign(3), null);
  assert.equal(planner.segs.length, 2);
});

test('claim réserve avant écriture, commit avance le curseur', () => {
  const planner = new Planner(MB, MB);
  const assignment = planner.assign(1);
  assert.equal(assignment.from, 0);

  const claim = planner.claim(1, 0, 64 * 1024);
  assert.deepEqual(claim, { granted: 64 * 1024 });
  // Une seconde réservation à la même position doit être refusée : les octets
  // sont déjà réservés.
  assert.equal(planner.claim(1, 0, 10), null);

  planner.commit(1, 64 * 1024);
  assert.equal(planner.downloaded(), 64 * 1024);
  assert.equal(planner.isComplete(), false);
});

test('release abandonne les octets réservés non écrits', () => {
  const planner = new Planner(MB, MB);
  planner.assign(1);
  planner.claim(1, 0, 4096);
  planner.commit(1, 1024);
  planner.claim(1, 1024, 3072);
  planner.release(1);
  // Le curseur est retombé à ce qui est réellement écrit.
  assert.equal(planner.downloaded(), 1024);
  const again = planner.assign(2);
  assert.equal(again.from, 1024);
  assert.equal(again.written, 1024);
});

test('l’état sauvegardé se reprend, et se refuse s’il est incohérent', () => {
  const planner = new Planner(4 * MB, MB);
  planner.assign(1);
  planner.claim(1, 0, MB);
  planner.commit(1, MB);
  planner.assign(2);

  const saved = planner.save();
  const resumed = Planner.resume(4 * MB, MB, saved);
  assert.ok(resumed);
  assert.equal(resumed.downloaded(), planner.downloaded());
  assert.equal(resumed.isComplete(), false);

  // Taille différente : le fichier distant a changé, l'état ne vaut plus rien.
  assert.equal(Planner.resume(5 * MB, MB, saved), null);
  // Trou dans la table : refusé aussi.
  assert.equal(Planner.resume(4 * MB, MB, [saved[0]]), null);
  // Curseur hors bornes : refusé.
  assert.equal(
    Planner.resume(4 * MB, MB, [{ start: 0, cursor: 10 * MB, end: 4 * MB }]),
    null
  );
});

test('makeSingle redonne tout le fichier à la connexion de tête', () => {
  const planner = new Planner(MB, MB);
  planner.assign(1);
  planner.assign(2); // 2 segments, aucun octet écrit
  assert.equal(planner.makeSingle(1), true);
  assert.equal(planner.segs.length, 1);
  assert.equal(planner.segs[0].end, MB);
  // Plus aucune coupure possible.
  assert.equal(planner.assign(3), null);
});
