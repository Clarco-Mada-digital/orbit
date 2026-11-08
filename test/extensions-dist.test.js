// ---------------------------------------------------------------------------
// Le catalogue PUBLIÉ décrit-il les archives réellement publiées ?
//
// Depuis que les archives sont téléchargées au lieu d'être embarquées, c'est
// le catalogue qui fait foi : Orbit refuse une archive dont l'empreinte ne
// correspond pas. Un `catalog.json` commité sans avoir été régénéré après un
// réexport rendrait donc l'extension INSTALLABLE NULLE PART — et le message
// d'erreur parlerait d'empreinte, loin de la cause.
//
// Aucune dépendance : `fs` et `crypto` suffisent (voir la règle du projet, les
// tests tournent sans `node_modules`).
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeCatalog } from '../src/lib/extensionCatalog.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'extensions-dist');
const catalogPath = path.join(DIST, 'catalog.json');

test('catalog.json : chaque entrée décrit une archive présente', () => {
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(raw.extensions) && raw.extensions.length, 'catalogue vide');
  for (const entry of raw.extensions) {
    const zipPath = path.join(DIST, entry.file);
    assert.ok(fs.existsSync(zipPath), `${entry.file} annoncé mais absent de extensions-dist/`);
    const bytes = fs.readFileSync(zipPath);
    assert.equal(bytes.length, entry.size, `${entry.file} : taille du catalogue périmée`);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      entry.sha256,
      `${entry.file} : empreinte du catalogue périmée — relancez ` +
        '`npm run export:extensions -- --catalog-only`'
    );
  }
});

test('catalog.json : aucune archive présente n’est oubliée', () => {
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const described = new Set(raw.extensions.map((e) => e.file));
  const onDisk = fs.readdirSync(DIST).filter((name) => name.toLowerCase().endsWith('.zip'));
  for (const file of onDisk) {
    assert.ok(described.has(file), `${file} est publié mais absent du catalogue`);
  }
});

test('catalog.json : une seule archive par extension', () => {
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const seen = new Map();
  for (const entry of raw.extensions) {
    const previous = seen.get(entry.name);
    assert.equal(
      previous,
      undefined,
      `« ${entry.name} » est publié deux fois (${previous} et ${entry.file}) : ` +
        'le magasin suit les installations par NOM et ne saurait pas laquelle désigner'
    );
    seen.set(entry.name, entry.file);
  }
});

test('catalog.json : le catalogue publié passe la validation de l’application', () => {
  // Ce que fait Orbit en recevant le fichier. Une entrée écartée ici serait
  // une extension invisible dans le magasin, sans aucun message.
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const validated = normalizeCatalog(raw);
  assert.equal(
    validated.extensions.length,
    raw.extensions.length,
    `entrées refusées : ${raw.extensions
      .filter((r) => !validated.extensions.some((v) => v.file === r.file))
      .map((r) => r.file)
      .join(', ')}`
  );
});
