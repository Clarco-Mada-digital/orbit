import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoLayout, inferRelations, visibleColumns, columnAnchorY, linkedColumns, edgePath, bounds, fitView,
  CARD_W, MAX_VISIBLE, HEADER_H,
} from '../src/lib/schemaLayout.js';

const col = (name, extra = {}) => ({ name, type: 'int', ...extra });
const T = (name, cols) => ({ schema: '', name, type: 'table', columns: cols });

test('colonnes visibles : clés et colonnes reliées d’abord, le reste en « +N »', () => {
  const t = T('big', [col('a'), col('b'), col('c'), col('d'), col('e'), col('f'), col('g'), col('h'), col('i'), col('owner_id'), col('id', { pk: true })]);
  const { shown, hidden } = visibleColumns(t, new Set(['owner_id']));
  assert.equal(shown.length, MAX_VISIBLE);
  assert.equal(hidden, 3);
  assert.ok(shown.some((c) => c.name === 'id') && shown.some((c) => c.name === 'owner_id'));
  // Colonne masquée → ancrée sur la ligne « +N ».
  assert.ok(columnAnchorY(t, 'b', new Set(['owner_id'])) > HEADER_H);
  assert.equal(visibleColumns(t, new Set(), true).hidden, 0);
});

test('relations déduites des noms (client_id → clients.id), sans doublon des déclarées', () => {
  const tables = [
    T('clients', [col('id', { pk: true })]),
    T('categories', [col('id', { pk: true })]),
    T('commandes', [col('id', { pk: true }), col('client_id'), col('categoryId'), col('id_externe')]),
  ];
  const declared = [{ from: { schema: '', table: 'commandes', columns: ['client_id'] }, to: { schema: '', table: 'clients', columns: ['id'] } }];
  const inferred = inferRelations(tables, declared);
  assert.deepEqual(inferred.map((r) => `${r.from.columns[0]}→${r.to.table}`), ['categoryId→categories']);
  assert.ok(inferred[0].inferred);
});

test('placement : aucune carte ne se chevauche, la table pivot est placée', () => {
  const tables = [
    T('clients', [col('id', { pk: true })]),
    T('commandes', [col('id', { pk: true }), col('client_id')]),
    T('lignes', [col('id', { pk: true }), col('commande_id')]),
    T('isolee', [col('x')]),
  ];
  const rels = inferRelations(tables, []);
  const pos = autoLayout(tables, rels);
  assert.equal(Object.keys(pos).length, 4);
  const linked = linkedColumns(rels);
  const boxes = Object.entries(pos).map(([k, p]) => ({ k, ...p, h: 40 + 3 * 22 }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + a.h && b.y < a.y + b.h;
      assert.equal(overlap, false, `${a.k} chevauche ${b.k}`);
    }
  }
  assert.ok(linked.get('.commandes').has('client_id'));
});

test('tracé et cadrage', () => {
  assert.match(edgePath({ x: 0, y: 10, w: 100 }, { x: 400, y: 50, w: 100 }), /^M 100 10 C/);
  assert.match(edgePath({ x: 0, y: 10, w: 100, self: true }, { x: 0, y: 50, w: 100 }), /^M 100 10 C 146/);
  const b = bounds({ a: { x: 0, y: 0 }, b: { x: 300, y: 200 } }, { a: { w: 100, h: 50 }, b: { w: 100, h: 50 } });
  assert.deepEqual(b, { x: 0, y: 0, w: 400, h: 250 });
  const v = fitView(b, 800, 600);
  assert.ok(v.k > 0 && v.k <= 1.2);
});
