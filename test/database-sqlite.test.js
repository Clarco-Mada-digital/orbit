import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../electron/database.js';

// Parcours complet sur une vraie base SQLite (node:sqlite, comme dans Orbit).
test('SQLite : connexion épinglée/jetable, lecture, édition, analyse, lecture seule', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-db-'));
  const fake = { available: true, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) };
  db.init(dir, fake);
  const file = path.join(dir, 'a.sqlite');

  const { connection } = await db.upsert({ driver: 'sqlite', file, pinned: true });
  assert.equal(connection.name, 'a.sqlite');
  await db.query(connection.id, 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INT)');
  await db.insertRow(connection.id, { table: 't', values: { name: 'a', n: 1 } });
  await db.insertRow(connection.id, { table: 't', values: { name: 'b', n: 1 } });

  const tables = await db.tables(connection.id);
  assert.deepEqual(tables.tables.map((x) => x.name), ['t']);

  const page = await db.browse(connection.id, { table: 't', orderBy: 'id', limit: 1 });
  assert.equal(page.total, 2);
  assert.deepEqual(page.rows, [[1, 'a', 1]]);
  assert.equal(page.columnInfo.find((c) => c.name === 'id').pk, true);

  await db.updateRow(connection.id, { table: 't', key: { id: 1 }, changes: { name: 'z' } });
  await db.deleteRow(connection.id, { table: 't', key: { id: 2 } });
  const after = await db.query(connection.id, 'SELECT name FROM t');
  assert.deepEqual(after.rows, [['z']]);

  const stats = await db.analyze(connection.id, '', 't');
  assert.equal(stats.columns.find((c) => c.name === 'name').distinct, 1);

  // Jetable : jamais écrite sur disque.
  const tmp = await db.upsert({ driver: 'sqlite', file, pinned: false, readOnly: true });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db-connections.json'), 'utf8'));
  assert.equal(saved.connections.length, 1);
  await assert.rejects(db.query(tmp.connection.id, 'DELETE FROM t'), /lecture seule/);
  assert.equal((await db.query(tmp.connection.id, 'SELECT COUNT(*) FROM t')).rows[0][0], 1);

  await db.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
});
