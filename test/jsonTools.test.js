import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonDocument, pathToJsonPath, pathToJs, flattenVisible, pathKey, searchJson, queryJson,
  setAt, deleteAt, renameKey, addChild, sortKeysDeep, jsonStats, findRecordArrays, analyzeRecords,
  aggregateRecords, inferSchema, recordsToCsv, parseEditedValue, containerPaths,
} from '../src/lib/jsonTools.js';

const DATA = {
  store: {
    name: 'Orbit',
    'clé spéciale': 1,
    users: [
      { id: 1, name: 'Rakoto', age: 34, city: 'Tana', tags: ['a'], address: { zip: '101' } },
      { id: 2, name: 'Rabe', age: 27, city: 'Paris', tags: [] },
      { id: 3, name: 'Soa', age: 41, city: 'Tana', active: true },
    ],
  },
};

test('lecture : JSON, JSON Lines, erreur située', () => {
  assert.equal(parseJsonDocument('{"a":1}').value.a, 1);
  const jl = parseJsonDocument('{"a":1}\n{"a":2}\n');
  assert.equal(jl.format, 'jsonl');
  assert.equal(jl.value.length, 2);
  const bad = parseJsonDocument('{\n  "a": 1,\n  "b": \n}');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.position, { line: 4, col: 1 }, JSON.stringify(bad));
  assert.deepEqual(parseJsonDocument('[1, 2,, 3]').position, { line: 1, col: 7 });
  assert.match(parseJsonDocument('{"a": tru}').error, /inattendu|attendu/);
});

test('chemins JSONPath et JavaScript', () => {
  assert.equal(pathToJsonPath(['store', 'users', 0, 'name']), '$.store.users[0].name');
  assert.equal(pathToJsonPath(['store', 'clé spéciale']), "$.store['clé spéciale']");
  assert.equal(pathToJs(['store', 'clé spéciale']), 'data.store["clé spéciale"]');
});

test('arbre aplati : seuls les nœuds dépliés sont parcourus', () => {
  const rows = flattenVisible(DATA, new Set([pathKey(['store'])]));
  assert.deepEqual(rows.map((r) => r.key), [null, 'store', 'name', 'clé spéciale', 'users']);
  const capped = flattenVisible({ a: Array.from({ length: 10 }, (_, i) => i) }, new Set([pathKey(['a'])]), { limitChildren: 4 });
  assert.equal(capped[capped.length - 1].more, 6);
  assert.ok(containerPaths(DATA).length >= 6);
});

test('recherche dans les clés et les valeurs', () => {
  const hits = searchJson(DATA, 'tana');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0].path, ['store', 'users', 0, 'city']);
  assert.equal(searchJson(DATA, 'zip')[0].key, true);
});

test('requêtes JSONPath (sans eval)', () => {
  const names = (q) => queryJson(DATA, q).map((r) => r.value);
  assert.deepEqual(names('$.store.users[*].name'), ['Rakoto', 'Rabe', 'Soa']);
  assert.deepEqual(names('$.store.users[?(@.age > 30)].name'), ['Rakoto', 'Soa']);
  assert.deepEqual(names("$.store.users[?(@.city == 'Tana' && @.age < 40)].id"), [1]);
  assert.deepEqual(names('$.store.users[?(@.active)].name'), ['Soa']);
  assert.deepEqual(names('$.store.users[?(@.name =~ /^ra/i)].id'), [1, 2]);
  assert.deepEqual(names('$..zip'), ['101']);
  assert.deepEqual(names('$.store.users[-1:].name'), ['Soa']);
  assert.deepEqual(names('$.store.users[0,2].id'), [1, 3]);
  assert.deepEqual(names("$.store['clé spéciale']"), [1]);
  assert.equal(names('$..name').length, 4);
  assert.throws(() => queryJson(DATA, 'store.users'), /commence par \$/);
  assert.throws(() => queryJson(DATA, '$.a[?(@.x ~~ 3)]'), /Condition illisible/);
});

test('édition immuable', () => {
  const a = setAt(DATA, ['store', 'users', 1, 'age'], 28);
  assert.equal(a.store.users[1].age, 28);
  assert.equal(DATA.store.users[1].age, 27, 'l’original ne bouge pas');
  assert.equal(deleteAt(DATA, ['store', 'users', 0]).store.users.length, 2);
  const r = renameKey(DATA, ['store', 'name'], 'titre');
  assert.deepEqual(Object.keys(r.store), ['titre', 'clé spéciale', 'users']);
  assert.throws(() => renameKey(DATA, ['store', 'name'], 'users'), /existe déjà/);
  assert.equal(addChild(DATA, ['store', 'users'], null, { id: 4 }).store.users.length, 4);
  assert.deepEqual(Object.keys(sortKeysDeep({ b: 1, a: { d: 1, c: 2 } }).a), ['c', 'd']);
  assert.equal(parseEditedValue('42'), 42);
  assert.equal(parseEditedValue('bonjour'), 'bonjour');
});

test('analyse, agrégation, schéma, CSV', () => {
  const s = jsonStats(DATA);
  assert.equal(s.arrays, 3);
  const arrays = findRecordArrays(DATA);
  assert.deepEqual(arrays[0].path, ['store', 'users']);
  const users = DATA.store.users;
  const an = analyzeRecords(users);
  const age = an.fields.find((f) => f.name === 'age');
  assert.equal(age.numeric, true);
  assert.equal(age.min, 27);
  assert.ok(an.fields.some((f) => f.name === 'address.zip'));
  const agg = aggregateRecords(users, { x: ['city'], agg: 'count' });
  assert.deepEqual(agg.points.map((p) => [p.label, p.value]), [['Tana', 2], ['Paris', 1]]);
  assert.equal(aggregateRecords(users, { x: ['city'], y: ['age'], agg: 'avg' }).points[0].value, 37.5);
  const schema = inferSchema(DATA);
  const item = schema.properties.store.properties.users.items;
  assert.deepEqual(item.required, ['id', 'name', 'age', 'city']);
  assert.equal(item.properties.age.type, 'integer');
  const csv = recordsToCsv(users);
  assert.match(csv.split('\r\n')[0], /^id,name,age,city,tags,address\.zip,active$/);
});
