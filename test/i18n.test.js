import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr, en } from '../src/lib/i18n.dict.js';

// `translate()` retombe sur la clé brute quand une traduction manque : rien ne
// plante, mais l'interface affiche « common.nextMonth » à l'écran. Ces tests
// sont le garde-fou — ils échouent AVANT que ça n'arrive à l'utilisateur.

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(name) ? [full] : [];
  });
}

// Clés appelées littéralement : t('x.y'). Les appels dynamiques (t(`x.${id}`),
// t(variable)) sont ignorés — impossible à résoudre statiquement.
function literalKeysUsed() {
  const keys = new Set();
  for (const file of sourceFiles(SRC)) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)'/g)) {
      keys.add(m[1]);
    }
  }
  return keys;
}

test('fr et en ont exactement les mêmes clés', () => {
  const F = Object.keys(fr);
  const E = Object.keys(en);
  const missingEn = F.filter((k) => !(k in en));
  const missingFr = E.filter((k) => !(k in fr));
  assert.deepEqual(missingEn, [], 'clés sans traduction anglaise');
  assert.deepEqual(missingFr, [], 'clés sans traduction française');
  assert.equal(F.length, E.length);
});

test('toute clé appelée dans le code existe dans le dictionnaire', () => {
  const used = [...literalKeysUsed()];
  assert.ok(used.length > 500, `seulement ${used.length} clés détectées : le scan est cassé`);
  const missing = used.filter((k) => !(k in fr));
  assert.deepEqual(missing, [], 'clés utilisées mais jamais traduites');
});

test('aucune traduction vide', () => {
  for (const [lang, dict] of [['fr', fr], ['en', en]]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${lang}/${k} n’est pas une chaîne`);
      assert.notEqual(v.trim(), '', `${lang}/${k} est vide`);
    }
  }
});

test('les variables {x} d’une clé sont les mêmes en fr et en en', () => {
  // Une variable oubliée dans la traduction anglaise afficherait « {count} »
  // littéralement à l'écran.
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(fr)) {
    if (!(k in en)) continue;
    assert.deepEqual(vars(en[k]), vars(fr[k]), `variables divergentes pour ${k}`);
  }
});
