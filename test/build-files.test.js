import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `build.files` (package.json) est une LISTE BLANCHE : tout ce qui n'y figure
// pas est absent de app.asar, et le processus principal échoue au démarrage
// avec « Cannot find module .../src/lib/urls.js » — un échec qui ne se voit
// qu'à l'exécution de l'application EMPAQUETÉE, jamais en `npm run dev` ni
// sous `node --test`, puisque le dépôt contient bien le fichier.
//
// Ce test ferme précisément ce trou : chaque module de src/lib importé par le
// code du processus principal doit être dans la liste blanche.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPackageFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = pkg?.build?.files;
  assert.ok(Array.isArray(files), 'build.files doit être un tableau (liste blanche)');
  return files;
}

// Chemins de `build.files` normalisés, sans métacaractère de globs.
const packagedEntries = () =>
  readPackageFiles().map((f) => String(f).replace(/\*\*\/\*$/, '').replace(/\/\*\*$/, '').replace(/\/\*$/, ''));

// Tous les imports relatifs de electron/ vers src/lib, fichier par fichier.
// Les deux formes sont couvertes : `from '…'` (ESM) et `require('…')` — les
// preloads sont en .cjs et pourraient basculer sur l'une ou l'autre.
function libImportsFromMainProcess() {
  const dir = path.join(ROOT, 'electron');
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(m?[cj]s|js)$/.test(name)) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const match of text.matchAll(/(?:from|require\()\s+'(\.\.\/src\/lib\/[^']+)'/g)) {
      // `../src/lib/urls.js` → `src/lib/urls.js`
      found.push({ from: `electron/${name}`, spec: match[1].slice(3) });
    }
  }
  return found;
}

test('build.files : tout module src/lib importé par le processus principal est empaqueté', () => {
  const imports = libImportsFromMainProcess();
  assert.ok(imports.length >= 5, 'on attend bien plusieurs imports partagés');

  const entries = packagedEntries();
  const missing = imports.filter((i) => !entries.includes(i.spec));
  assert.deepEqual(
    missing,
    [],
    `ces modules sont importés par le processus principal mais ABSENTS de build.files :\n` +
      missing.map((i) => `  - ${i.spec} (importé par ${i.from})`).join('\n') +
      `\nL'application empaquetée planterait au démarrage.`
  );
});

test('build.files : la visionneuse a aussi ses modules partagés', () => {
  // La visionneuse vit côté rendu (embarquée par vite dans dist/), donc ce
  // test ne peut pas la voir passer par un import du processus principal. On
  // verrouille ici, nom par nom, les modules dont la visionneuse dépend — c'est
  // le même trou, invisible des deux côtés tant qu'on n'a pas lancé l'AppImage.
  const entries = packagedEntries();
  for (const mod of [
    'src/lib/fileTypes.js',
    'src/lib/documents.js',
    'src/lib/markdown.js',
    'src/lib/urls.js',
  ]) {
    assert.ok(entries.includes(mod), `${mod} doit être présent dans build.files`);
  }
});

test('build.files : dist/, electron/ et package.json sont bien inclus', () => {
  const entries = packagedEntries();
  for (const needed of ['dist/', 'electron/', 'package.json']) {
    assert.ok(
      entries.some((e) => e === needed || e === needed.replace(/\/$/, '')),
      `${needed} doit être dans la liste blanche (sinon ni le rendu ni le main ne partent)`
    );
  }
});
