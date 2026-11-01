import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldText,
  groupPath,
  totpOf,
  entryToRow,
  isUsableRow,
  collectRows,
  categoriesFrom,
} from '../electron/kdbx-entries.js';

// Lire le fichier .kdbx est la seule voie COMPLÈTE : le protocole navigateur
// ne rend les mots de passe que site par site, donc une entrée sans URL lui
// échappe. Ces tests verrouillent la conversion, sans kdbxweb (la suite tourne
// sans `node_modules`) : on imite la forme des objets qu'il produit.

// kdbxweb rend les champs sensibles comme des valeurs protégées.
const protege = (texte) => ({ getText: () => texte });
const entree = (champs) => ({ fields: new Map(Object.entries(champs)) });
const groupe = (name, entries = [], groups = [], uuid = name) => ({ name, entries, groups, uuid });

test('un champ protégé est lu comme du texte, jamais comme un objet', () => {
  assert.equal(fieldText(protege('secret')), 'secret');
  assert.equal(fieldText('clair'), 'clair');
  assert.equal(fieldText(null), '');
  assert.equal(fieldText(undefined), '');
  // Le piège que ce helper existe pour éviter :
  assert.notEqual(fieldText(protege('secret')), '[object Object]');
});

test('une entrée devient une ligne d’import complète', () => {
  const row = entryToRow(
    entree({
      Title: 'Webmail',
      URL: 'https://mail.test',
      UserName: 'ada',
      Password: protege('s3cret'),
      Notes: 'compte principal',
    }),
    ['Base', 'Travail']
  );
  assert.deepEqual(row, {
    title: 'Webmail',
    url: 'https://mail.test',
    username: 'ada',
    password: 's3cret',
    totp: '',
    notes: 'compte principal',
    category: 'Travail',
  });
});

test('le TOTP est accepté sous ses deux formes', () => {
  const uri = 'otpauth://totp/X?secret=JBSWY3DPEHPK3PXP';
  assert.equal(totpOf(new Map([['otp', uri]])), uri);
  // Ancien greffon KeeOtp : la graine seule
  assert.equal(totpOf(new Map([['TOTP Seed', protege('JBSWY3DPEHPK3PXP')]])), 'JBSWY3DPEHPK3PXP');
  assert.equal(totpOf(new Map()), '');
});

test('le nom de la base ne devient pas une catégorie', () => {
  // La racine porte le nom du fichier : elle n'apprend rien.
  assert.equal(groupPath(['Ma base']), '');
  assert.equal(groupPath(['Ma base', 'Banque']), 'Banque');
  assert.equal(groupPath(['Ma base', 'Travail', 'Clients']), 'Travail / Clients');
});

test('une entrée sans identifiant NI mot de passe est écartée', () => {
  // Une base contient souvent des notes ou des pièces jointes seules.
  assert.equal(isUsableRow({ title: 'Note', username: '', password: '' }), false);
  assert.equal(isUsableRow({ username: 'ada', password: '' }), true);
  assert.equal(isUsableRow({ username: '', password: 'x' }), true);
  assert.equal(isUsableRow(null), false);
});

test('l’arbre complet est parcouru, corbeille exclue', () => {
  const corbeille = groupe('Corbeille', [
    entree({ Title: 'Jeté', UserName: 'vieux', Password: protege('x') }),
  ], [], 'uuid-corbeille');
  const racine = groupe(
    'Ma base',
    [
      entree({ Title: 'Sans URL', UserName: 'bryan', Password: protege('0000') }),
      entree({ Title: 'Note seule' }),
    ],
    [
      groupe('Banque', [
        entree({ Title: 'Compte', URL: 'https://banque.test', UserName: 'b', Password: protege('y') }),
      ]),
      corbeille,
    ]
  );

  const { rows, skipped } = collectRows(racine, { recycleBinUuid: 'uuid-corbeille' });
  assert.deepEqual(rows.map((r) => r.title), ['Sans URL', 'Compte']);
  // L'entrée SANS URL est bien là : c'est tout l'intérêt de lire le fichier.
  assert.equal(rows[0].url, '');
  assert.equal(rows[1].category, 'Banque');
  assert.deepEqual(skipped, { empty: 1, recycled: 1 });
});

test('sans corbeille déclarée, rien n’est exclu à tort', () => {
  const racine = groupe('Ma base', [], [
    groupe('Corbeille', [entree({ Title: 'X', UserName: 'a', Password: protege('b') })]),
  ]);
  const { rows, skipped } = collectRows(racine, { recycleBinUuid: null });
  assert.equal(rows.length, 1, 'un groupe nommé « Corbeille » n’est pas LA corbeille');
  assert.equal(skipped.recycled, 0);
});

test('les groupes deviennent des catégories, sans doublon', () => {
  const cats = categoriesFrom([
    { category: 'Banque' },
    { category: 'Banque' },
    { category: '' },
    { category: 'Travail / Clients' },
  ]);
  assert.deepEqual(cats.map((c) => c.name), ['Banque', 'Travail / Clients']);
  assert.deepEqual(cats.map((c) => c.id), ['kdbx-banque', 'kdbx-travail-clients']);
});

test('une base vide ou absente ne fait rien planter', () => {
  assert.deepEqual(collectRows(null).rows, []);
  assert.deepEqual(collectRows(groupe('Vide')).rows, []);
  assert.deepEqual(categoriesFrom([]), []);
});
