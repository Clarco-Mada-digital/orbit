import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncedFieldsChanged, stampCollection } from '../src/lib/syncStamp.js';
import { SYNC_COLLECTIONS } from '../src/lib/syncMerge.js';

// L'horodatage décide qui gagne une fusion. Deux erreurs opposées sont
// possibles et coûteuses : trop horodater (chaque navigation réécrirait le
// fichier de synchronisation et ferait gagner la mauvaise machine), ou pas
// assez (une modification réelle serait écrasée par la version d'en face).

const APP = SYNC_COLLECTIONS.apps;
const T0 = 1_700_000_000_000;
const NOW = T0 + 60_000;
const app = (over = {}) => ({
  id: 'gmail', profileId: 'work', name: 'Gmail', homeUrl: 'https://mail.test',
  icon: '📧', color: '#000', order: 0, updatedAt: T0, ...over,
});

test('syncedFieldsChanged : ignore ce qui ne voyage pas', () => {
  const a = app();
  // url, unread, title, sleeping, favicon transitoire : jamais synchronisés
  assert.equal(syncedFieldsChanged(a, { ...a, url: 'https://autre.test' }, APP), false);
  assert.equal(syncedFieldsChanged(a, { ...a, unread: 12 }, APP), false);
  assert.equal(syncedFieldsChanged(a, { ...a, title: 'Boîte (3)' }, APP), false);
  assert.equal(syncedFieldsChanged(a, { ...a, sleeping: true }, APP), false);
});

test('syncedFieldsChanged : détecte une vraie modification', () => {
  const a = app();
  assert.equal(syncedFieldsChanged(a, { ...a, name: 'Gmail Pro' }, APP), true);
  assert.equal(syncedFieldsChanged(a, { ...a, order: 3 }, APP), true);
  assert.equal(syncedFieldsChanged(a, { ...a, profileId: 'perso' }, APP), true);
  assert.equal(syncedFieldsChanged(a, { ...a, zoom: 1.2 }, APP), true);
});

test('stampCollection : une navigation ne réhorodate PAS', () => {
  // Le scénario qui compte : <WebView> écrit l'URL courante à chaque clic.
  const before = [app()];
  const after = [{ ...app(), url: 'https://mail.test/inbox/42', unread: 3 }];
  const { list, changed } = stampCollection(before, after, APP, NOW);
  assert.equal(changed, false, 'une simple navigation a déclenché un horodatage');
  assert.equal(list[0].updatedAt, T0);
});

test('stampCollection : un renommage horodate', () => {
  const { list, changed } = stampCollection([app()], [{ ...app(), name: 'Pro' }], APP, NOW);
  assert.equal(changed, true);
  assert.equal(list[0].updatedAt, NOW);
});

test('stampCollection : une nouvelle entité est horodatée', () => {
  const { list, changed } = stampCollection([], [app({ updatedAt: undefined })], APP, NOW);
  assert.equal(changed, true);
  assert.equal(list[0].updatedAt, NOW);
});

test('stampCollection : les données d’avant la synchro reçoivent un horodatage', () => {
  // Installation existante : les apps n'ont pas d'`updatedAt`. Sans ce
  // rattrapage, elles perdraient tous les arbitrages face au distant.
  const legacy = { id: 'x', name: 'X', profileId: 'work' };
  const { list, changed } = stampCollection([legacy], [legacy], APP, NOW);
  assert.equal(changed, true);
  assert.equal(list[0].updatedAt, NOW);
});

test('stampCollection : une suppression est signalée', () => {
  const { removed } = stampCollection([app(), app({ id: 'slack' })], [app()], APP, NOW);
  assert.deepEqual(removed, ['slack']);
});

test('stampCollection : rien ne bouge → aucune écriture', () => {
  const same = [app()];
  const { changed, removed } = stampCollection(same, same, APP, NOW);
  assert.equal(changed, false);
  assert.deepEqual(removed, []);
});

test('stampCollection : entités sans id traversées sans planter', () => {
  const { list } = stampCollection([], [{ name: 'orpheline' }], APP, NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].updatedAt, undefined);
});
