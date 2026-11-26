import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildThemeCatalog } from '../scripts/export-themes.mjs';
import { normalizeThemeCatalog, themeFileUrl } from '../src/lib/themeCatalog.js';
import { parseTheme, exportTheme } from '../src/lib/customTheme.js';

test('thèmes de la communauté : tous valides, lisibles, et catalogue à jour', () => {
  const { errors, catalog } = buildThemeCatalog();
  assert.deepEqual(errors, []);
  assert.ok(catalog.themes.length >= 1);
  const committed = fs.readFileSync(new URL('../themes-dist/catalog.json', import.meta.url), 'utf8');
  assert.equal(committed, `${JSON.stringify(catalog, null, 2)}\n`, 'lancez « npm run export:themes »');
});

test('catalogue reçu : les entrées douteuses sont écartées', () => {
  const ok = { id: 'ocean', name: 'Océan', file: 'ocean.json', size: 800, sha256: 'a'.repeat(64) };
  const { themes } = normalizeThemeCatalog({
    themes: [
      ok,
      { ...ok, id: 'evil', file: '../../evil.json' },
      { ...ok, id: 'remote', file: 'https://ailleurs.test/x.json' },
      { ...ok, id: 'nosha', file: 'nosha.json', sha256: 'xyz' },
      { ...ok, id: 'big', file: 'big.json', size: 10 * 1024 * 1024 },
      { ...ok },
      { ...ok, id: 'Majuscules', file: 'Majuscules.json' },
    ],
  });
  assert.deepEqual(themes.map((t) => t.id), ['ocean']);
  assert.equal(normalizeThemeCatalog(null).themes.length, 0);
});

test('le fichier d’un thème est toujours servi à côté du catalogue', () => {
  const url = themeFileUrl({ file: 'ocean.json' }, 'https://exemple.test/orbit/themes/catalog.json');
  assert.equal(url, 'https://exemple.test/orbit/themes/ocean.json');
});

test('auteur et description : conservés, coupés, et repris à l’export', () => {
  const src = JSON.parse(fs.readFileSync(new URL('../themes-dist/ocean.json', import.meta.url), 'utf8'));
  const res = parseTheme(JSON.stringify({ ...src, description: 'x'.repeat(500) }));
  assert.equal(res.ok, true);
  assert.equal(res.theme.author, src.author);
  assert.equal(res.theme.description.length, 160);
  const again = JSON.parse(exportTheme('ocean', [res.theme]));
  assert.equal(again.author, src.author);
  assert.equal(again.id, 'ocean-copie');
});
