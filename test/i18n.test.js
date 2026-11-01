import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr, en, MODULES } from '../src/lib/i18n.dict.js';

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

// Le dictionnaire est découpé par domaine (src/lib/i18n/) puis assemblé par
// étalement d'objets. Un étalement laisse gagner la DERNIÈRE occurrence : une
// clé définie dans deux modules verrait l'une des deux traductions disparaître
// sans un mot. Ce test refuse ce cas.
test('aucune clé définie dans deux modules du dictionnaire', () => {
  for (const lang of ['fr', 'en']) {
    const seen = new Map(); // clé → module qui l'a déjà définie
    const duplicates = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      for (const key of Object.keys(mod[lang])) {
        if (seen.has(key)) duplicates.push(`${lang}/${key} (${seen.get(key)} + ${name})`);
        else seen.set(key, name);
      }
    }
    assert.deepEqual(duplicates, [], 'clés en double entre modules');
    // Et l'assemblage ne doit rien perdre en route.
    assert.equal(seen.size, Object.keys(lang === 'fr' ? fr : en).length);
  }
});

test('chaque module du dictionnaire est équilibré fr/en', () => {
  // Vérifier la parité seulement sur l'objet assemblé laisserait passer une
  // clé rangée dans le module français d'un domaine et dans le module anglais
  // d'un autre : le total serait juste, le découpage faux.
  for (const [name, mod] of Object.entries(MODULES)) {
    const F = Object.keys(mod.fr);
    const E = Object.keys(mod.en);
    assert.deepEqual(F.filter((k) => !(k in mod.en)), [], `${name} : sans traduction anglaise`);
    assert.deepEqual(E.filter((k) => !(k in mod.fr)), [], `${name} : sans traduction française`);
  }
});
