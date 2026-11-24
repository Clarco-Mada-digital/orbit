import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_CATEGORIES, categoriesIn, defaultSelection, describeCategory, mainFilesFor,
  mergeDbConnections, mergePermissions, portableDbConnections,
} from '../src/lib/backupCategories.js';

test('sélection par défaut : l’espace de travail toujours, l’historique au choix', () => {
  const sel = defaultSelection();
  assert.equal(sel.workspace, true);
  assert.equal(sel.history, false);
  assert.deepEqual(mainFilesFor(sel).sort(), ['dbConnections', 'permissions', 'shields']);
  assert.deepEqual(mainFilesFor({ workspace: true }), []);
  assert.ok(BACKUP_CATEGORIES.every((c) => c.label && c.detail));
});

test('catégories détectées dans un fichier (ancien et nouveau format)', () => {
  const old = { orbitBackup: 2, profiles: [], apps: [], settings: {}, extensions: [], rules: [] };
  assert.deepEqual(categoriesIn(old), ['workspace', 'automations', 'settings', 'extensions']);
  const neu = { ...old, assistantSessions: [1], history: { entries: [1, 2] }, api: { collections: [1], environments: [] }, dbUi: {}, mainFiles: { permissions: {}, dbConnections: { connections: [1, 2] } } };
  assert.deepEqual(categoriesIn(neu), ['workspace', 'automations', 'settings', 'extensions', 'assistant', 'history', 'api', 'database', 'sites']);
  assert.equal(describeCategory('history', neu), '2 page(s)');
  assert.equal(describeCategory('database', neu), '2 connexion(s)');
  assert.deepEqual(categoriesIn(null), []);
});

test('connexions : les mots de passe (liés au trousseau local) ne voyagent pas, ceux de la machine restent', () => {
  const exported = portableDbConnections({ connections: [{ id: 'a', driver: 'mysql', passwordEnc: 'SECRET', passwordUnsaved: true }] });
  assert.deepEqual(exported.connections[0], { id: 'a', driver: 'mysql' });
  const merged = mergeDbConnections(
    { connections: [{ id: 'a', driver: 'mysql', host: 'old', passwordEnc: 'LOCAL' }] },
    { connections: [{ id: 'a', driver: 'mysql', host: 'new' }, { id: 'b', driver: 'sqlite' }, { nope: 1 }] }
  );
  assert.deepEqual(merged.connections.map((c) => [c.id, c.host, c.passwordEnc]), [['a', 'new', 'LOCAL'], ['b', undefined, undefined]]);
});

test('autorisations : fusion site par site, origines invalides écartées', () => {
  const m = mergePermissions(
    { mode: 'ask', sites: { 'https://a.io': { media: 'deny', notifications: 'allow' } } },
    { mode: 'deny', sites: { 'https://a.io': { media: 'allow' }, 'javascript:x': { media: 'allow' }, 'https://b.io': { geolocation: 'deny' } } }
  );
  assert.equal(m.mode, 'deny');
  assert.deepEqual(m.sites['https://a.io'], { media: 'allow', notifications: 'allow' });
  assert.ok(!m.sites['javascript:x']);
  assert.ok(m.sites['https://b.io']);
});
