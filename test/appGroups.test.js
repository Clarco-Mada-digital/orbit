import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FOLDER_EMOJI,
  FOLDER_COLORS,
  folderId,
  makeFolder,
  normalizeFolderName,
  foldersFor,
  groupByFolder,
  pruneEmptyFolders,
  folderAppIds,
  countUnread,
  toggleId,
  selectRange,
  isToggleClick,
  withoutFolderId,
  reorderIdsByDrop,
} from '../src/lib/appGroups.js';

// Les dossiers se contentent d'un `folderId` posé sur l'app : le risque n'est
// donc pas de « perdre » un dossier mais de faire DISPARAÎTRE une app rangée
// dans un dossier devenu introuvable. Ces tests couvrent ce cas en premier.

const app = (id, over = {}) => ({ id, name: id, order: 0, ...over });
const folder = (id, over = {}) => makeFolder({ id, name: id, profileId: 'work', ...over });

test('makeFolder : normalise le nom et borne sa longueur', () => {
  const f = makeFolder({ name: '   Mes   outils  ', profileId: 'work' });
  assert.equal(f.name, 'Mes outils');
  assert.equal(f.emoji, DEFAULT_FOLDER_EMOJI);
  assert.equal(f.color, FOLDER_COLORS[0]);
  assert.equal(f.collapsed, false);
  const long = makeFolder({ name: 'x'.repeat(200), profileId: 'work' });
  assert.equal(long.name.length, 60);
});

test('makeFolder : sans nom, on retombe sur le repli fourni', () => {
  assert.equal(makeFolder({ profileId: 'work', fallbackName: 'New folder' }).name, 'New folder');
  assert.equal(makeFolder({ profileId: 'work', name: '   ' }).name, 'Dossier');
});

test('normalizeFolderName : accepte les valeurs non textuelles sans planter', () => {
  assert.equal(normalizeFolderName(undefined), 'Dossier');
  assert.equal(normalizeFolderName(42, 'New folder'), 'New folder');
});

test('folderId : préfixe reconnaissable et graine injectable', () => {
  assert.equal(folderId(1700000000000), 'fld-1700000000000');
  assert.equal(folderId(1700000000000, 'b'), 'fld-1700000000000b');
});

test('foldersFor : ne garde que le profil demandé, dans l’ordre', () => {
  const list = [
    { id: 'b', profileId: 'work', order: 1 },
    { id: 'a', profileId: 'work', order: 0 },
    { id: 'p', profileId: 'perso', order: 0 },
  ];
  assert.deepEqual(foldersFor(list, 'work').map((f) => f.id), ['a', 'b']);
  assert.deepEqual(foldersFor(list, 'perso').map((f) => f.id), ['p']);
  assert.deepEqual(foldersFor(undefined, 'work'), []);
});

test('groupByFolder : range les apps, garde l’ordre, isole les libres', () => {
  const folders = [folder('f1'), folder('f2')];
  const apps = [
    app('mail', { folderId: 'f1', order: 0 }),
    app('libre', { order: 1 }),
    app('chat', { folderId: 'f1', order: 2 }),
    app('notes', { folderId: 'f2', order: 3 }),
  ];
  const { groups, loose } = groupByFolder(apps, folders);
  assert.deepEqual(
    groups.map((g) => [g.folder.id, g.apps.map((a) => a.id)]),
    [
      ['f1', ['mail', 'chat']],
      ['f2', ['notes']],
    ]
  );
  assert.deepEqual(loose.map((a) => a.id), ['libre']);
});

test('groupByFolder : un dossier vide n’est pas affiché', () => {
  const { groups, loose } = groupByFolder([app('a')], [folder('f1')]);
  assert.deepEqual(groups, []);
  assert.deepEqual(loose.map((a) => a.id), ['a']);
});

test('groupByFolder : un folderId orphelin rend l’app libre (jamais perdue)', () => {
  const { groups, loose } = groupByFolder([app('a', { folderId: 'disparu' })], [folder('f1')]);
  assert.deepEqual(groups, []);
  assert.deepEqual(loose.map((a) => a.id), ['a']);
});

test('groupByFolder : entrées nulles traversées sans planter', () => {
  const { groups, loose } = groupByFolder([null, app('a')], [null, folder('f1')]);
  assert.deepEqual(groups, []);
  assert.deepEqual(loose.map((a) => a.id), ['a']);
});

test('reorderIdsByDrop : glisser avant/après la cible, y compris la ligne voisine', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(reorderIdsByDrop(order, 'a', 'b', 'after'), ['b', 'a', 'c']);
  assert.deepEqual(reorderIdsByDrop(order, 'c', 'b', 'before'), ['a', 'c', 'b']);
  assert.deepEqual(reorderIdsByDrop(order, 'b', 'b', 'after'), order);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('pruneEmptyFolders : retire les dossiers sans app', () => {
  const folders = [folder('f1'), folder('f2')];
  const kept = pruneEmptyFolders(folders, [app('a', { folderId: 'f1' })]);
  assert.deepEqual(kept.map((f) => f.id), ['f1']);
});

test('pruneEmptyFolders : rien à retirer → même référence (pas de re-rendu)', () => {
  const folders = [folder('f1')];
  const apps = [app('a', { folderId: 'f1' })];
  assert.equal(pruneEmptyFolders(folders, apps), folders);
});

test('folderAppIds : renvoie les apps du dossier demandé', () => {
  const apps = [app('a', { folderId: 'f1' }), app('b'), app('c', { folderId: 'f1' })];
  assert.deepEqual(folderAppIds(apps, 'f1'), ['a', 'c']);
  assert.deepEqual(folderAppIds(apps, 'inconnu'), []);
});

test('withoutFolderId : retire le champ au lieu de le poser à undefined', () => {
  const sorted = withoutFolderId(app('a', { folderId: 'f1', name: 'A' }));
  assert.equal('folderId' in sorted, false, 'le champ ne doit plus traîner dans les données');
  assert.equal(sorted.name, 'A');
});

test('withoutFolderId : une app déjà libre est renvoyée telle quelle', () => {
  const free = app('a');
  assert.equal(withoutFolderId(free), free, 'pas de copie inutile (aucun re-rendu)');
  assert.equal(withoutFolderId(null), null);
});

test('countUnread : totalise les non-lus, ignore le reste', () => {
  assert.equal(countUnread([app('a', { unread: 3 }), app('b'), app('c', { unread: 2 })]), 5);
  assert.equal(countUnread([]), 0);
  assert.equal(countUnread(undefined), 0);
});

// --- Sélection multiple ----------------------------------------------------

test('toggleId : ajoute puis retire sans muter la liste reçue', () => {
  const start = ['a'];
  const added = toggleId(start, 'b');
  assert.deepEqual(added, ['a', 'b']);
  assert.deepEqual(toggleId(added, 'a'), ['b']);
  assert.deepEqual(start, ['a'], 'la liste d’origine ne doit pas être modifiée');
  assert.deepEqual(toggleId(undefined, 'a'), ['a']);
});

test('isToggleClick : Ctrl ou Cmd seulement', () => {
  assert.equal(isToggleClick({ ctrlKey: true }), true);
  assert.equal(isToggleClick({ metaKey: true }), true);
  assert.equal(isToggleClick({ shiftKey: true }), false);
  assert.equal(isToggleClick(null), false);
});

test('selectRange : plage inclusive, dans les deux sens', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(selectRange(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'c', 'c'), ['c']);
});

test('selectRange : sans ancre ou cible inconnue, on ne renvoie pas du vide', () => {
  assert.deepEqual(selectRange(['a', 'b'], null, 'b'), ['b']);
  assert.deepEqual(selectRange(['a', 'b'], 'disparu', 'b'), ['b']);
  assert.deepEqual(selectRange(['a', 'b'], 'a', 'disparu'), ['disparu']);
});
