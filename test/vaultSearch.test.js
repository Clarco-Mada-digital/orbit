import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchVaultEntries, scoreEntry, MIN_QUERY } from '../src/lib/vaultSearch.js';

// La palette ne voit que la vue PUBLIQUE d'une entrée : ni mot de passe ni
// secret TOTP n'arrivent jusqu'au renderer (voir electron/vault.js).
const entries = [
  { id: 'e1', title: 'Amazon', username: 'ada@example.com', url: 'https://amazon.fr', hasTotp: false },
  { id: 'e2', title: 'Banque Réunion', username: 'ada', url: 'https://banque.re', favorite: true },
  { id: 'e3', title: 'Compte test', username: 'amazonien', url: 'https://autre.test' },
  { id: 'e4', title: 'Mail boulot', username: 'ada.pro', url: 'https://mail.example.com' },
];

test('une recherche trop courte ne liste RIEN', () => {
  // Dérouler le coffre dès l'ouverture de la palette exposerait les comptes
  // sur un écran laissé sans surveillance.
  assert.deepEqual(searchVaultEntries(entries, ''), []);
  assert.deepEqual(searchVaultEntries(entries, 'a'), []);
  assert.equal(MIN_QUERY, 2);
  assert.equal(searchVaultEntries(entries, 'am').length > 0, true);
});

test('le titre passe devant un identifiant qui contient le même mot', () => {
  const found = searchVaultEntries(entries, 'amazon');
  assert.equal(found[0].id, 'e1');
  assert.deepEqual(found.map((e) => e.id), ['e1', 'e3']);
});

test('on trouve par hôte et par identifiant', () => {
  assert.deepEqual(searchVaultEntries(entries, 'banque.re').map((e) => e.id), ['e2']);
  assert.deepEqual(searchVaultEntries(entries, 'ada.pro').map((e) => e.id), ['e4']);
});

test('accents et casse sont ignorés', () => {
  assert.deepEqual(searchVaultEntries(entries, 'reunion').map((e) => e.id), ['e2']);
  assert.deepEqual(searchVaultEntries(entries, 'BANQUE').map((e) => e.id), ['e2']);
});

test('rien ne sort pour une recherche sans correspondance', () => {
  assert.deepEqual(searchVaultEntries(entries, 'zzzz'), []);
  assert.deepEqual(searchVaultEntries([], 'amazon'), []);
  assert.deepEqual(searchVaultEntries(undefined, 'amazon'), []);
});

test('la liste est bornée : la palette doit rester lisible', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: `x${i}`,
    title: `Service ${i}`,
    username: 'ada',
    url: 'https://service.test',
  }));
  assert.equal(searchVaultEntries(many, 'service').length, 4);
  assert.equal(searchVaultEntries(many, 'service', { limit: 2 }).length, 2);
});

test('une entrée sans champ ne fait pas planter le classement', () => {
  assert.equal(scoreEntry(null, 'x'), 0);
  assert.equal(scoreEntry({}, 'x'), 0);
  const sparse = [{ id: 'e', title: 'Sans rien' }];
  assert.deepEqual(searchVaultEntries(sparse, 'sans').map((e) => e.id), ['e']);
  // Une entrée sans identifiant stable est écartée : la palette a besoin de
  // l'id pour demander la copie au processus principal.
  assert.deepEqual(searchVaultEntries([{ title: 'Orpheline' }], 'orph'), []);
});
