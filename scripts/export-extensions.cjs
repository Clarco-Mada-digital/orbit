#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// Exporte les extensions SOURCES vers `extensions-dist/`.
//
// Les ZIP présents jusqu'ici dans `extensions-dist/` n'avaient pas de sources :
// impossible de les régénérer après une correction. Chaque dossier de
// `extensions-src/` contenant un `manifest.json` devient ici un ZIP dont le
// manifeste est à la RACINE (forme attendue par « Installer un ZIP »).
//
// Usage :
//   node scripts/export-extensions.cjs            (toutes les extensions)
//   node scripts/export-extensions.cjs orbit-phone (une seule)
//
// Les entrées reçoivent une date fixe : relancer l'export sans changement
// produit un ZIP identique (pratique pour vérifier une livraison).
//
// Un `catalog.json` est écrit à côté des ZIP : Orbit embarquera ces archives
// (extensions OPTIONNELLES, rien n'est actif tant qu'elles ne sont pas
// installées) et s'en sert pour proposer l'installation en un clic. Le
// catalogue est reconstruit à partir des ZIP eux-mêmes — y compris ceux dont
// les sources ne sont pas dans le dépôt.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'electron/extensions');
const OUT = path.join(ROOT, 'extensions-dist');
const FIXED_TIME = new Date('2023-01-01T00:00:00Z');
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', '.git', 'node_modules']);

function walk(dir, base = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, rel));
    else if (entry.isFile()) files.push({ full, rel });
  }
  return files;
}

function exportOne(name) {
  const dir = path.join(SRC, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${name} : manifest.json introuvable`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`${name} : manifest.json illisible (${err.message})`);
  }
  if (!manifest.name || !manifest.version) {
    throw new Error(`${name} : name/version obligatoires`);
  }

  const zip = new AdmZip();
  for (const file of walk(dir)) {
    const entry = zip.addFile(file.rel, fs.readFileSync(file.full));
    // Timestamp figé : pas de diff binaire inutile entre deux exports.
    entry.header.time = FIXED_TIME;
  }

  const outFile = path.join(OUT, `${name}.zip`);
  zip.writeZip(outFile);
  const size = fs.statSync(outFile).size;
  console.log(
    `✔ ${manifest.name} v${manifest.version} → ${path.relative(ROOT, outFile)} (${(size / 1024).toFixed(1)} Ko)`
  );
  return outFile;
}

function readManifestFromZip(file) {
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntry('manifest.json');
    if (!entry) return null;
    return JSON.parse(zip.readAsText(entry));
  } catch (err) {
    console.warn(`⚠ manifeste illisible dans ${path.basename(file)} : ${err.message}`);
    return null;
  }
}

// Catalogue des archives disponibles. Lecture des manifestes DANS les ZIP :
// certaines extensions de `extensions-dist/` n'ont pas (encore) de sources.
function writeCatalog() {
  const extensions = fs
    .readdirSync(OUT)
    .filter((name) => name.toLowerCase().endsWith('.zip'))
    .sort()
    .map((name) => {
      const manifest = readManifestFromZip(path.join(OUT, name));
      if (!manifest?.name || !manifest?.version) return null;
      return {
        file: name,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        nativeApp: manifest.orbit?.nativeApp || null,
        size: fs.statSync(path.join(OUT, name)).size,
      };
    })
    .filter(Boolean);

  const catalog = { version: 1, extensions };
  const outFile = path.join(OUT, 'catalog.json');
  fs.writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`✔ catalogue : ${extensions.length} extension(s) → ${path.relative(ROOT, outFile)}`);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Aucun dossier de sources : ${path.relative(ROOT, SRC)}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const available = fs
    .readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SRC, e.name, 'manifest.json')))
    .map((e) => e.name);

  if (!available.length) {
    console.error('Aucune extension source avec manifest.json.');
    process.exit(1);
  }

  const selected = wanted.length ? wanted : available;
  const unknown = selected.filter((n) => !available.includes(n));
  if (unknown.length) {
    console.error(`Extension(s) inconnue(s) : ${unknown.join(', ')}`);
    console.error(`Disponibles : ${available.join(', ')}`);
    process.exit(1);
  }

  let failed = 0;
  for (const name of selected) {
    try {
      exportOne(name);
    } catch (err) {
      failed += 1;
      console.error(`✖ ${err.message}`);
    }
  }
  // Reconstruit même après un échec partiel : le catalogue doit refléter ce qui
  // est réellement présent sur le disque, pas ce qu'on espérait exporter.
  writeCatalog();
  if (failed) process.exit(1);
}

main();
