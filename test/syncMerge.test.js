import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot,
  isValidSnapshot,
  mergeSnapshots,
  mergeTombstones,
  hasIncomingChanges,
  reconcileLocal,
  summarize,
  TOMBSTONE_TTL_MS,
  SYNC_FORMAT,
} from '../src/lib/syncMerge.js';

// La fusion décide quelle version de la configuration survit. Une erreur ici
// fait disparaître des apps ou ressuscite des suppressions — c'est le code le
// plus dangereux de la synchronisation, d'où la densité de ces tests.

const T0 = 1_700_000_000_000; // référence stable
const app = (id, over = {}) => ({
  id, profileId: 'work', name: id, homeUrl: `https://${id}.test`,
  icon: '📦', color: '#000000', order: 0, updatedAt: T0, ...over,
});
const state = (over = {}) => ({
  profiles: [{ id: 'work', name: 'Travail', emoji: '💼', color: '#6366f1', updatedAt: T0 }],
  apps: [], containers: [], workspaces: [],
  settings: { theme: 'dark' }, settingsUpdatedAt: T0, tombstones: {}, ...over,
});

// --- Instantané -----------------------------------------------------------

test('buildSnapshot : ne retient que les champs synchronisables', () => {
  const snap = buildSnapshot(
    state({ apps: [app('gmail', { unread: 12, sleeping: true, url: 'https://mail.test/secret' })] }),
    { deviceId: 'd1', deviceName: 'Fixe', now: T0 }
  );
  const a = snap.apps[0];
  // L'état transitoire ne voyage pas
  assert.equal(a.unread, undefined);
  assert.equal(a.sleeping, undefined);
  // La page courante NON PLUS : sinon l'onglet se téléporterait d'un poste
  // à l'autre en pleine lecture.
  assert.equal(a.url, undefined);
  // Mais l'URL « maison » et l'identité, oui
  assert.equal(a.homeUrl, 'https://gmail.test');
  assert.equal(a.id, 'gmail');
  assert.equal(snap.deviceId, 'd1');
  assert.equal(snap.orbitSync, SYNC_FORMAT);
});

test('buildSnapshot : horodate les entités qui n’en ont pas', () => {
  const snap = buildSnapshot(state({ apps: [{ id: 'x', name: 'X' }] }), { now: T0 });
  assert.equal(snap.apps[0].updatedAt, T0);
});

test('isValidSnapshot : rejette tout ce qui n’est pas un instantané exploitable', () => {
  assert.equal(isValidSnapshot(buildSnapshot(state(), { now: T0 })), true);
  assert.equal(isValidSnapshot(null), false);
  assert.equal(isValidSnapshot({}), false);
  assert.equal(isValidSnapshot('du texte'), false);
  // Version future : on refuse plutôt que d'interpréter de travers
  assert.equal(isValidSnapshot({ ...buildSnapshot(state(), { now: T0 }), orbitSync: 99 }), false);
  // Fichier tronqué par une synchro cloud interrompue
  const partial = buildSnapshot(state(), { now: T0 });
  delete partial.apps;
  assert.equal(isValidSnapshot(partial), false);
});

// --- Première synchronisation --------------------------------------------

test('mergeSnapshots : sans distant, l’état local est publié tel quel', () => {
  const { snapshot, changes } = mergeSnapshots(state({ apps: [app('a')] }), null, { now: T0 });
  assert.equal(changes.first, true);
  assert.equal(snapshot.apps.length, 1);
  assert.equal(hasIncomingChanges(changes), false);
});

// --- Union et arbitrage ---------------------------------------------------

test('mergeSnapshots : les apps des deux machines sont réunies', () => {
  const local = state({ apps: [app('gmail')] });
  const remote = buildSnapshot(state({ apps: [app('slack')] }), { now: T0 });
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 1000 });
  assert.deepEqual(snapshot.apps.map((a) => a.id).sort(), ['gmail', 'slack']);
  assert.equal(changes.collections.apps.added, 1);
  assert.equal(hasIncomingChanges(changes), true);
});

test('mergeSnapshots : la modification la plus récente gagne', () => {
  // Renommée localement à T0, renommée à distance PLUS TARD → le distant gagne
  const local = state({ apps: [app('gmail', { name: 'Local', updatedAt: T0 })] });
  const remote = buildSnapshot(
    state({ apps: [app('gmail', { name: 'Distant', updatedAt: T0 + 5000 })] }),
    { now: T0 }
  );
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 9000 });
  assert.equal(snapshot.apps[0].name, 'Distant');
  assert.equal(changes.collections.apps.updated, 1);
});

test('mergeSnapshots : une modification locale plus récente n’est pas écrasée', () => {
  const local = state({ apps: [app('gmail', { name: 'Local', updatedAt: T0 + 5000 })] });
  const remote = buildSnapshot(
    state({ apps: [app('gmail', { name: 'Distant', updatedAt: T0 })] }),
    { now: T0 }
  );
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 9000 });
  assert.equal(snapshot.apps[0].name, 'Local');
  assert.equal(changes.collections.apps.updated, 0);
  assert.equal(hasIncomingChanges(changes), false);
});

test('mergeSnapshots : l’entité gagnante arrive en bloc, sans panachage', () => {
  // Le distant a renommé ET changé l'icône : on ne doit pas hériter du
  // nouveau nom avec l'ancienne icône.
  const local = state({ apps: [app('gmail', { name: 'Ancien', icon: '📧', updatedAt: T0 })] });
  const remote = buildSnapshot(
    state({ apps: [app('gmail', { name: 'Nouveau', icon: '✉️', updatedAt: T0 + 100 })] }),
    { now: T0 }
  );
  const { snapshot } = mergeSnapshots(local, remote, { now: T0 + 200 });
  assert.equal(snapshot.apps[0].name, 'Nouveau');
  assert.equal(snapshot.apps[0].icon, '✉️');
});

// --- Suppressions ---------------------------------------------------------

test('mergeSnapshots : une suppression distante retire l’app locale', () => {
  const local = state({ apps: [app('gmail', { updatedAt: T0 })] });
  const remote = buildSnapshot(state({ tombstones: { gmail: T0 + 1000 } }), { now: T0 });
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 2000 });
  assert.deepEqual(snapshot.apps, []);
  assert.equal(changes.collections.apps.removed, 1);
});

test('mergeSnapshots : une app RECRÉÉE après sa suppression survit', () => {
  // Le scénario qui casse les synchros naïves : supprimée à T0+1000, puis
  // réinstallée à T0+2000 sous le même id. La pierre tombale ne doit PAS la
  // faire disparaître à nouveau.
  const local = state({ apps: [app('gmail', { updatedAt: T0 + 2000 })] });
  const remote = buildSnapshot(state({ tombstones: { gmail: T0 + 1000 } }), { now: T0 });
  const { snapshot } = mergeSnapshots(local, remote, { now: T0 + 3000 });
  assert.equal(snapshot.apps.length, 1);
});

test('mergeSnapshots : une suppression locale se propage au distant', () => {
  const local = state({ apps: [], tombstones: { slack: T0 + 1000 } });
  const remote = buildSnapshot(state({ apps: [app('slack', { updatedAt: T0 })] }), { now: T0 });
  const { snapshot } = mergeSnapshots(local, remote, { now: T0 + 2000 });
  assert.deepEqual(snapshot.apps, []);
  // La pierre tombale reste publiée, pour les autres machines
  assert.equal(snapshot.tombstones.slack, T0 + 1000);
});

test('mergeTombstones : garde la date la plus récente et purge les périmées', () => {
  const now = T0 + TOMBSTONE_TTL_MS + 10_000;
  const merged = mergeTombstones(
    { a: T0, b: now - 1000 },      // `a` a dépassé sa durée de vie
    { b: now - 5000, c: now - 2000 },
    now
  );
  assert.equal(merged.a, undefined, 'pierre tombale périmée non purgée');
  assert.equal(merged.b, now - 1000, 'la date la plus récente doit gagner');
  assert.equal(merged.c, now - 2000);
});

// --- Réglages -------------------------------------------------------------

test('mergeSnapshots : les réglages suivent le dernier écrivain, en bloc', () => {
  const local = state({ settings: { theme: 'dark', accentColor: '#111111' }, settingsUpdatedAt: T0 });
  const remote = buildSnapshot(
    state({ settings: { theme: 'light', accentColor: '#ffffff' }, settingsUpdatedAt: T0 + 1000 }),
    { now: T0 }
  );
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 2000 });
  assert.equal(snapshot.settings.theme, 'light');
  assert.equal(snapshot.settings.accentColor, '#ffffff');
  assert.equal(changes.settings, true);
});

test('mergeSnapshots : des réglages distants plus anciens sont ignorés', () => {
  const local = state({ settings: { theme: 'dark' }, settingsUpdatedAt: T0 + 5000 });
  const remote = buildSnapshot(
    state({ settings: { theme: 'light' }, settingsUpdatedAt: T0 }),
    { now: T0 }
  );
  const { snapshot, changes } = mergeSnapshots(local, remote, { now: T0 + 9000 });
  assert.equal(snapshot.settings.theme, 'dark');
  assert.equal(changes.settings, false);
});

// --- Convergence ----------------------------------------------------------

test('la fusion converge : deux machines finissent identiques', () => {
  // A ajoute Gmail, B ajoute Slack et supprime une app commune.
  const commune = app('notion', { updatedAt: T0 });
  const A = state({ apps: [commune, app('gmail', { updatedAt: T0 + 100 })] });
  const B = state({ apps: [commune, app('slack', { updatedAt: T0 + 200 })], tombstones: { notion: T0 + 300 } });

  // A publie, B fusionne et republie, A refusionne
  const pubA = mergeSnapshots(A, null, { now: T0 + 400 }).snapshot;
  const pubB = mergeSnapshots(B, pubA, { now: T0 + 500 }).snapshot;
  const finalA = mergeSnapshots(A, pubB, { now: T0 + 600 }).snapshot;

  const ids = (s) => s.apps.map((a) => a.id).sort();
  assert.deepEqual(ids(finalA), ['gmail', 'slack'], 'A n’a pas convergé');
  assert.deepEqual(ids(pubB), ['gmail', 'slack'], 'B n’a pas convergé');
});

test('fusionner deux fois de suite ne change rien (idempotence)', () => {
  const local = state({ apps: [app('gmail')] });
  const remote = buildSnapshot(state({ apps: [app('slack')] }), { now: T0 });
  const once = mergeSnapshots(local, remote, { now: T0 + 100 }).snapshot;
  const twice = mergeSnapshots(once, remote, { now: T0 + 200 }).snapshot;
  assert.deepEqual(once.apps.map((a) => a.id).sort(), twice.apps.map((a) => a.id).sort());
  assert.equal(hasIncomingChanges(mergeSnapshots(once, remote, { now: T0 + 300 }).changes), false);
});

// --- Robustesse -----------------------------------------------------------

test('mergeSnapshots : un instantané distant corrompu ne détruit rien', () => {
  const local = state({ apps: [app('gmail')] });
  for (const bad of [null, undefined, {}, 'texte', { orbitSync: 99 }, { orbitSync: 1 }]) {
    const { snapshot, changes } = mergeSnapshots(local, bad, { now: T0 });
    assert.equal(snapshot.apps.length, 1, `le distant « ${JSON.stringify(bad)} » a écrasé le local`);
    assert.equal(changes.first, true);
  }
});

test('mergeSnapshots : entités sans id ignorées, pas de plantage', () => {
  const local = state({ apps: [app('ok'), { name: 'sans id' }] });
  const remote = buildSnapshot(state({ apps: [{ name: 'sans id non plus' }] }), { now: T0 });
  const { snapshot } = mergeSnapshots(local, remote, { now: T0 + 100 });
  assert.deepEqual(snapshot.apps.map((a) => a.id), ['ok']);
});

// --- Réconciliation avant application ------------------------------------

test('reconcileLocal : une synchro n’efface PAS l’état local des apps', () => {
  // Régression vécue : l'instantané ne transporte que les champs synchronisés.
  // Appliqué tel quel, il remplaçait les apps locales par ces versions
  // amputées — chaque synchronisation effaçait la page courante, les non-lus,
  // les icônes téléversées et l'état de veille de TOUTES les apps.
  const local = [
    {
      id: 'gmail', name: 'Gmail', profileId: 'work',
      // Champs LOCAUX, absents de tout instantané :
      url: 'https://mail.test/inbox/42', unread: 7, sleeping: true,
      favicon: 'https://icon.test/gmail.png', iconImage: 'data:image/png;base64,AAA',
      signedOut: false,
    },
  ];
  const fromSnapshot = [{ id: 'gmail', name: 'Gmail Pro', profileId: 'perso', updatedAt: T0 }];

  const [out] = reconcileLocal(local, fromSnapshot);
  // Le distant gagne sur ce qui voyage…
  assert.equal(out.name, 'Gmail Pro');
  assert.equal(out.profileId, 'perso');
  // …et le local garde tout le reste
  assert.equal(out.url, 'https://mail.test/inbox/42');
  assert.equal(out.unread, 7);
  assert.equal(out.sleeping, true);
  assert.equal(out.favicon, 'https://icon.test/gmail.png');
  assert.equal(out.iconImage, 'data:image/png;base64,AAA');
});

test('reconcileLocal : une app venue d’une autre machine arrive telle quelle', () => {
  const [out] = reconcileLocal([], [{ id: 'neuve', name: 'Neuve', updatedAt: T0 }]);
  assert.equal(out.name, 'Neuve');
  assert.equal(out.url, undefined);
});

test('reconcileLocal : les entités absentes de l’instantané disparaissent', () => {
  // C'est voulu : l'instantané fait foi sur la COMPOSITION des collections
  // (les suppressions y ont déjà été arbitrées par mergeSnapshots).
  const out = reconcileLocal([{ id: 'a' }, { id: 'b' }], [{ id: 'a', updatedAt: T0 }]);
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

test('reconcileLocal : entrées vides tolérées', () => {
  assert.deepEqual(reconcileLocal(null, null), []);
  assert.deepEqual(reconcileLocal(undefined, []), []);
});

test('summarize : agrège toutes les collections', () => {
  const local = state({ apps: [app('a')], containers: [] });
  const remote = buildSnapshot(
    state({ apps: [app('b')], containers: [{ id: 'c1', name: 'C', color: '#fff', updatedAt: T0 }] }),
    { now: T0 }
  );
  const { changes } = mergeSnapshots(local, remote, { now: T0 + 100 });
  const total = summarize(changes);
  assert.equal(total.added, 2); // 1 app + 1 conteneur
  assert.equal(total.removed, 0);
});
