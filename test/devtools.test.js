import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSql, statementAt, toCsv } from '../src/lib/sqlStatements.js';
import {
  parseHttpFile, substitute, buildFinalRequest, parseCurl, toCurl,
  importOpenApi, importPostman, splitUrlParams, joinUrlParams, toHttpFile, importAny,
} from '../src/lib/httpRequests.js';
import {
  buildUpdate, buildDelete, buildBrowse, buildInsert, isReadOnlySql, quoteIdent, toCell,
} from '../electron/db-sql.js';

test('splitSql : chaînes, commentaires, dollar-quoting, DELIMITER', () => {
  const sql = `-- entête
SELECT 'a;b' AS x;
/* ; */ INSERT INTO t VALUES ("c;d");
CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql;
DELIMITER //
CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//
DELIMITER ;
SELECT 3`;
  const list = splitSql(sql);
  assert.equal(list.length, 5);
  assert.equal(list[0].text, "SELECT 'a;b' AS x");
  assert.equal(list[0].line, 2);
  assert.match(list[2].text, /\$\$ BEGIN RETURN 1; END \$\$/);
  assert.match(list[3].text, /SELECT 1; SELECT 2; END$/);
  assert.equal(list[4].text, 'SELECT 3');
});

test('statementAt : requête sous le curseur', () => {
  const sql = 'SELECT 1;\nSELECT 2;\n';
  assert.equal(statementAt(sql, 3).text, 'SELECT 1');
  assert.equal(statementAt(sql, 12).text, 'SELECT 2');
});

test('toCsv échappe guillemets et séparateurs', () => {
  assert.equal(toCsv(['a', 'b'], [['x,y', 'z"w'], [null, 1]]), 'a,b\r\n"x,y","z""w"\r\n,1');
});

test('SQL généré : valeurs en paramètres, noms entre guillemets', () => {
  const u = buildUpdate('postgres', { schema: 'public', table: 'us"er', key: { id: 4 }, changes: { name: 'x', age: 3 } });
  assert.equal(u.sql, 'UPDATE "public"."us""er" SET "name" = $1, "age" = $2 WHERE "id" = $3');
  assert.deepEqual(u.params, ['x', 3, 4]);
  const d = buildDelete('mysql', { table: 't', key: { a: 1, b: null } });
  assert.equal(d.sql, 'DELETE FROM `t` WHERE `a` = ? AND `b` IS NULL');
  assert.throws(() => buildDelete('mysql', { table: 't', key: {} }), /clé primaire/);
  assert.equal(buildInsert('mssql', { schema: 'dbo', table: 't', values: { x: 1 } }).sql, 'INSERT INTO [dbo].[t] ([x]) VALUES (@p1)');
  assert.match(buildBrowse('mssql', { schema: 'dbo', table: 't', limit: 10 }).sql, /ORDER BY \(SELECT NULL\) OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY$/);
  assert.equal(quoteIdent('mssql', 'a]b'), '[a]]b]');
});

test('mode lecture seule', () => {
  assert.equal(isReadOnlySql('  -- x\n select * from t'), true);
  assert.equal(isReadOnlySql("SELECT 'delete'"), true);
  assert.equal(isReadOnlySql('WITH x AS (SELECT 1) DELETE FROM t'), false);
  assert.equal(isReadOnlySql('PRAGMA journal_mode = WAL'), false);
  assert.equal(isReadOnlySql('UPDATE t SET a=1'), false);
});

test('toCell : types non transportables', () => {
  assert.equal(toCell(10n), '10');
  assert.deepEqual(toCell(new Uint8Array([1, 2])), { $binary: true, size: 2, preview: '0102' });
});

test('fichier .http façon REST Client', () => {
  const text = `@host = https://api.test
@token = abc

### Connexion
# @name login
POST {{host}}/login HTTP/1.1
Content-Type: application/json

{"user": "a"}

###
GET {{host}}/me
  ?full=1
  &lang=fr
Authorization: Bearer {{login.response.body.$.token}}
`;
  const { variables, requests } = parseHttpFile(text);
  assert.deepEqual(variables, { host: 'https://api.test', token: 'abc' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestName, 'login');
  assert.equal(requests[0].body.kind, 'json');
  assert.equal(requests[0].line, 6);
  assert.equal(requests[1].url, '{{host}}/me?full=1&lang=fr');
  const responses = { login: { response: { body: '{"token":"T1"}', headers: [] } } };
  const final = buildFinalRequest(requests[1], { vars: variables, responses });
  assert.equal(final.url, 'https://api.test/me?full=1&lang=fr');
  assert.deepEqual(final.headers, [['Authorization', 'Bearer T1']]);
  assert.match(toHttpFile(requests, variables), /^@host = https:\/\/api\.test/);
});

test('variables système et inconnues', () => {
  assert.match(substitute('{{$guid}}'), /^[0-9a-f-]{36}$/);
  assert.equal(substitute('{{$timestamp}}', { now: new Date(5000) }), '5');
  assert.equal(substitute('{{inconnue}}'), '{{inconnue}}');
  assert.equal(substitute('{{a}}', { vars: { a: '{{b}}', b: 'ok' } }), 'ok');
});

test('authentification', () => {
  const f = buildFinalRequest({ method: 'get', url: 'x.io', auth: { type: 'basic', username: 'u', password: 'p' } });
  assert.equal(f.url, 'https://x.io');
  assert.deepEqual(f.headers, [['Authorization', 'Basic dTpw']]);
  const q = buildFinalRequest({ url: 'https://x.io/a?b=1', auth: { type: 'apikey', key: 'k', value: 'v', in: 'query' } });
  assert.equal(q.url, 'https://x.io/a?b=1&k=v');
});

test('cURL aller-retour (copie de Chrome)', () => {
  const r = parseCurl(`curl 'https://api.x.io/v1/items?x=1' \\
  -H 'accept: application/json' \\
  -H 'sec-fetch-mode: cors' \\
  --data-raw '{"a":1}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.body.kind, 'json');
  assert.equal(r.headers.length, 1);
  const back = toCurl(buildFinalRequest(r));
  assert.match(back, /^curl -X POST 'https:\/\/api\.x\.io\/v1\/items\?x=1'/);
  const f = parseCurl('curl -u me:pw -d a=1 -d b=2 https://h.io');
  assert.equal(f.body.kind, 'form');
  assert.equal(f.auth.type, 'basic');
});

test('paramètres d’URL', () => {
  const { base, params } = splitUrlParams('https://a.io/p?x=1&y=a%20b');
  assert.equal(base, 'https://a.io/p');
  assert.deepEqual(params.map((p) => p.value), ['1', 'a b']);
  assert.equal(joinUrlParams(base, [{ key: 'q', value: '{{v}}' }]), 'https://a.io/p?q={{v}}');
});

test('import OpenAPI et Postman', () => {
  const api = importOpenApi({
    openapi: '3.0.0',
    info: { title: 'Zoo' },
    servers: [{ url: 'https://zoo.io/v1/' }],
    paths: {
      '/pets/{id}': {
        put: {
          summary: 'Modifier',
          parameters: [{ name: 'id', in: 'path', example: 7 }],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        },
      },
    },
    components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } },
  });
  assert.equal(api.variables.baseUrl, 'https://zoo.io/v1');
  assert.equal(api.variables.id, '7');
  assert.equal(api.requests[0].url, '{{baseUrl}}/pets/{{id}}');
  assert.deepEqual(JSON.parse(api.requests[0].body.text), { name: 'string' });

  const pm = importPostman({
    info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tk}}' }] },
    item: [{ name: 'Dossier', item: [{ name: 'Liste', request: { method: 'GET', url: { raw: '{{u}}/l' } } }] }],
  });
  assert.equal(pm.requests[0].folder, 'Dossier');
  assert.equal(pm.requests[0].auth.token, '{{tk}}');
  assert.equal(importAny('curl https://a.io').requests.length, 1);
});
