import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepIndex, appCycleList, openSwitcher, moveSwitcher } from '../src/lib/keyboardSwitcher.js';

test('stepIndex : circulaire dans les deux sens', () => {
  assert.equal(stepIndex(3, 0, 1), 1);
  assert.equal(stepIndex(3, 2, 1), 0);
  assert.equal(stepIndex(3, 0, -1), 2);
  assert.equal(stepIndex(3, -1, 1), 0, 'aucun actif : vers l’avant, on part du premier');
  assert.equal(stepIndex(3, -1, -1), 2, 'aucun actif : vers l’arrière, on part du dernier');
  assert.equal(stepIndex(0, 0, 1), -1);
});

test('appCycleList : profil actif + apps « tous profils », hors veille, dans l’ordre', () => {
  const apps = [
    { id: 'b', profileId: 'w', order: 2 },
    { id: 'a', profileId: 'w', order: 1 },
    { id: 'z', profileId: 'p', order: 0 },
    { id: 's', profileId: 'w', order: 3, sleeping: true },
    { id: 'g', profileId: 'p', scope: 'all', order: 4 },
  ];
  assert.deepEqual(appCycleList({ apps, activeProfile: 'w' }).map((a) => a.id), ['a', 'b', 'g']);
});

test('openSwitcher / moveSwitcher : le premier appui désigne le suivant, sans activer', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const st = openSwitcher('app', items, 'a', 1);
  assert.equal(st.ids[st.index], 'b');
  const st2 = moveSwitcher(moveSwitcher(st, 1), 1);
  assert.equal(st2.ids[st2.index], 'a', 'retour au début');
  assert.equal(st2.steps, 3);
  assert.equal(openSwitcher('app', [{ id: 'a' }], 'a', 1), null, 'une seule app : rien à choisir');
});
