import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBinaryContent,
  detectDelimiter,
  parseDelimited,
  prettyJson,
  textStats,
  formatBytes,
} from '../src/lib/documents.js';

// La visionneuse reçoit des fichiers quelconques : un CSV mal cité, un JSON
// tronqué ou un « .txt » qui est en réalité une image ne doivent jamais casser
// l'affichage — au pire, un message clair.

test('hasBinaryContent : distingue le texte du binaire', () => {
  assert.equal(hasBinaryContent('bonjour\nà tous\ttabulation\r\n'), false);
  assert.equal(hasBinaryContent('{"clé": "valeur accentuée"}'), false);
  assert.equal(hasBinaryContent(''), false);
  // Octet NUL : signature d'un fichier binaire, même renommé en .txt
  assert.equal(hasBinaryContent('PK\u0000\u0004contenu'), true);
  // Suite de caractères de contrôle = décodage raté
  assert.equal(hasBinaryContent('\u0001'.repeat(50) + 'texte'), true);
  // Un texte normal avec quelques caractères de remplacement reste lisible
  assert.equal(hasBinaryContent('a'.repeat(100) + '\ufffd'), false);
});

test('detectDelimiter : choisit le séparateur des données, pas la virgule', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  // Aucun séparateur : on retombe sur la virgule
  assert.equal(detectDelimiter('juste une ligne'), ',');
  assert.equal(detectDelimiter(''), ',');
});

test('parseDelimited : cellules citées, séparateur interne, guillemet échappé', () => {
  const csv = 'nom,ville\n"Ada, la","Paris ""intra-muros"""\n';
  const { rows, delimiter, columns } = parseDelimited(csv);
  assert.equal(delimiter, ',');
  assert.equal(columns, 2);
  assert.deepEqual(rows[1], ['Ada, la', 'Paris "intra-muros"']);
});

test('parseDelimited : saut de ligne final ignoré, lignes vides conservées au milieu', () => {
  const { rows } = parseDelimited('a,b\n\nc,d\n\n');
  assert.deepEqual(rows, [['a', 'b'], [''], ['c', 'd']]);
});

test('parseDelimited : garde-fou sur le nombre de lignes', () => {
  const big = Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n');
  const { rows, truncated } = parseDelimited(big, { maxRows: 10 });
  assert.equal(rows.length, 10);
  assert.equal(truncated, true);
  const small = parseDelimited('a\nb');
  assert.equal(small.truncated, false);
});

test('prettyJson : indente le JSON valide, explique l’invalide', () => {
  const ok = prettyJson('{"a":1,"b":[1,2]}');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  const ko = prettyJson('{"a":');
  assert.equal(ko.ok, false);
  assert.equal(ko.text, '{"a":');
  assert.match(ko.error, /JSON|position|Unexpected|fin/i);
});

test('textStats : lignes, mots, caractères', () => {
  assert.deepEqual(textStats('deux mots\nencore un\n'), { lines: 3, words: 4, chars: 20 });
  assert.deepEqual(textStats(''), { lines: 0, words: 0, chars: 0 });
});

test('formatBytes : unités françaises', () => {
  assert.equal(formatBytes(0), '0 o');
  assert.equal(formatBytes(512), '512 o');
  assert.equal(formatBytes(2048), '2.0 Ko');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 Mo');
});
