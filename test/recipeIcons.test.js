import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recipes } from '../src/lib/recipes.js';

const index = JSON.parse(fs.readFileSync(new URL('../src/lib/recipeIconIndex.json', import.meta.url), 'utf8'));
const dir = new URL('../public/recipe-icons/', import.meta.url);

test('chaque app de la boutique a son icône embarquée', () => {
  const missing = Object.keys(recipes).filter((id) => !index.includes(id) || !fs.existsSync(new URL(`${id}.webp`, dir)));
  assert.deepEqual(missing, [], `lancez : node scripts/fetch-recipe-icons.mjs ${missing.join(' ')}`);
});

test('icônes embarquées : WebP légers, aucun fichier orphelin', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir.pathname, f));
    assert.equal(buf.subarray(8, 12).toString(), 'WEBP', f);
    assert.ok(buf.length < 40000, `${f} trop lourd (${buf.length} o)`);
    assert.ok(recipes[f.replace(/\.webp$/, '')], `${f} ne correspond à aucune app`);
  }
});
