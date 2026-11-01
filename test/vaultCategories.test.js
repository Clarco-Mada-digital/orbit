import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCategories, applyCategoryIds } from '../electron/vault-categories.js';

// Une base KeePass est rangée en GROUPES, un coffre en CATÉGORIES. Si cette
// traduction rate, une base bien organisée arrive entièrement dans « Sans
// catégorie » — et personne ne s'en aperçoit avant d'ouvrir le coffre.

test('les catégories absentes sont ajoutées, les existantes conservées', () => {
  const existantes = [{ id: 'work', name: 'Boulot', color: '#6366f1' }];
  const { categories, added } = mergeCategories(existantes, [
    { id: 'kdbx-banque', name: 'Banque' },
    { id: 'kdbx-boulot', name: 'Boulot' },
  ]);
  assert.equal(added, 1);
  assert.deepEqual(categories.map((c) => c.name), ['Boulot', 'Banque']);
  // L'identifiant d'une catégorie DÉJÀ là ne change pas : sinon toutes les
  // entrées qui la référencent se retrouveraient orphelines.
  assert.equal(categories.find((c) => c.name === 'Boulot').id, 'work');
});

test('réimporter la même base n’empile pas les mêmes catégories', () => {
  const une = mergeCategories([], [{ id: 'a', name: 'Banque' }]);
  const deux = mergeCategories(une.categories, [{ id: 'autre-id', name: 'banque' }]);
  assert.equal(deux.added, 0, 'la comparaison se fait par nom, insensible à la casse');
  assert.equal(deux.categories.length, 1);
});

test('un nom vide ne crée pas de catégorie fantôme', () => {
  const { categories, added } = mergeCategories([], [{ name: '' }, { name: '   ' }, {}]);
  assert.equal(added, 0);
  assert.deepEqual(categories, []);
});

test('les lignes reçoivent l’identifiant de leur catégorie', () => {
  const categories = [{ id: 'c1', name: 'Banque' }, { id: 'c2', name: 'Travail / Clients' }];
  const rows = applyCategoryIds(
    [
      { title: 'A', category: 'Banque' },
      { title: 'B', category: 'travail / clients' },
      { title: 'C', category: '' },
      { title: 'D' },
    ],
    categories
  );
  assert.deepEqual(rows.map((r) => r.category), ['c1', 'c2', '', undefined]);
});

test('un nom inconnu retombe sur « aucune catégorie »', () => {
  // Plutôt qu'un identifiant fantôme, qui afficherait une catégorie vide.
  const rows = applyCategoryIds([{ title: 'X', category: 'Inexistante' }], [{ id: 'c1', name: 'Banque' }]);
  assert.equal(rows[0].category, '');
});

test('listes vides : rien ne plante', () => {
  assert.deepEqual(applyCategoryIds([], []), []);
  assert.deepEqual(applyCategoryIds(undefined, undefined), []);
  assert.deepEqual(mergeCategories(undefined, undefined), { categories: [], added: 0 });
});
