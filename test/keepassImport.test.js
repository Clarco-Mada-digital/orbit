import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeUrl,
  uniqueUrls,
  entriesWithoutUrl,
  buildImportRows,
  chooseScanUrls,
} from '../electron/keepass-import.js';

test('urls without a scheme are presented in https (KeePassXC compares schemes)', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizeUrl('  https://example.com/login  '), 'https://example.com/login');
  assert.equal(normalizeUrl('mailto:ada@example.com'), '');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(undefined), '');
});

test('one request per distinct url, whatever the case', () => {
  const urls = uniqueUrls([
    { url: 'https://example.com' },
    { url: 'https://EXAMPLE.com' },
    { url: 'example.com' },
    { url: 'https://other.example' },
    { url: '' },
  ]);
  assert.deepEqual(urls, ['https://example.com', 'https://other.example']);
});

test('entries without a url are reported by title, never dropped silently', () => {
  assert.deepEqual(
    entriesWithoutUrl([
      { title: 'Code de la valise', url: '' },
      { title: 'Compte bancaire', url: 'https://banque.example' },
      { url: 'mailto:ada@example.com' },
    ]),
    ['Code de la valise', 'Sans titre']
  );
});

test('rows carry every account returned for a site', () => {
  const dbEntries = [{ title: 'Example', url: 'https://example.com' }];
  const logins = new Map([
    [
      'https://example.com',
      [
        { login: 'ada', password: 's3cret', name: 'Example — perso' },
        { login: 'ada.pro', password: 'other', name: 'Example — boulot', totp: 'JBSWY3DPEHPK3PXP' },
      ],
    ],
  ]);

  assert.deepEqual(buildImportRows(dbEntries, logins), [
    {
      title: 'Example — perso',
      url: 'https://example.com',
      username: 'ada',
      password: 's3cret',
      totp: '',
      notes: '',
    },
    {
      title: 'Example — boulot',
      url: 'https://example.com',
      username: 'ada.pro',
      password: 'other',
      totp: 'JBSWY3DPEHPK3PXP',
      notes: '',
    },
  ]);
});

test('rows fall back to the database title when KeePassXC returns no name', () => {
  const rows = buildImportRows(
    [{ title: 'Titre de la base', url: 'example.com' }],
    new Map([['https://example.com', [{ login: 'ada', password: 's3cret' }]]])
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Titre de la base');
  assert.equal(rows[0].url, 'https://example.com');
});

test('the same account seen twice for a site yields one row', () => {
  const rows = buildImportRows(
    [{ title: 'Example', url: 'https://example.com' }],
    new Map([
      [
        'https://example.com',
        [
          { login: 'ada', password: 's3cret', name: 'Example' },
          { login: 'ada', password: 's3cret', name: 'Example' },
        ],
      ],
    ])
  );
  assert.equal(rows.length, 1);
});

test('empty credentials are skipped', () => {
  const rows = buildImportRows(
    [{ title: 'Example', url: 'https://example.com' }],
    new Map([['https://example.com', [{ login: '', password: '' }, null]]])
  );
  assert.deepEqual(rows, []);
});

// --- Que faut-il interroger ? ---------------------------------------------
// `get-database-entries` n'existe que depuis KeePassXC 2.8. Sur 2.7.x — la
// version la plus répandue — il répond « action incorrecte ». Le rapatriement
// retombe alors sur les adresses des apps d'Orbit, que `get-logins` sait
// interroger sur toutes les versions.

test('base énumérable : on interroge ses URLs', () => {
  const plan = chooseScanUrls(
    { success: true, entries: [{ url: 'https://a.test' }, { url: 'a.test' }, { url: '' }] },
    ['https://ignore.test']
  );
  assert.equal(plan.mode, 'database');
  assert.deepEqual(plan.urls, ['https://a.test']);
  // Les URLs d'apps ne servent PAS quand la base répond : on importerait moins.
  assert.equal(plan.urls.includes('https://ignore.test'), false);
});

test('version trop ancienne : repli sur les sites des apps', () => {
  const plan = chooseScanUrls({ success: false, error: 'unsupported-action' }, [
    'https://mail.test',
    'mail.test',
    'https://chat.test',
  ]);
  assert.equal(plan.mode, 'apps');
  assert.deepEqual(plan.urls, ['https://mail.test', 'https://chat.test']);
  // La raison est conservée : l'écran explique pourquoi l'import est partiel.
  assert.equal(plan.reason, 'unsupported-action');
  // Et aucune entrée de base n'est inventée.
  assert.deepEqual(plan.entries, []);
});

test('sans base ni app à interroger, l’erreur doit remonter', () => {
  // Rendre `null` fait propager l'erreur d'origine au lieu de prétendre
  // avoir importé zéro identifiant.
  assert.equal(chooseScanUrls({ success: false, error: 'not-associated' }, []), null);
  assert.equal(chooseScanUrls({ success: false, error: 'x' }, ['']), null);
  assert.equal(chooseScanUrls(undefined, []), null);
});
