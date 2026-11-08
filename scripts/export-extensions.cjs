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
const crypto = require('crypto');
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
      const zipPath = path.join(OUT, name);
      const bytes = fs.readFileSync(zipPath);
      return {
        file: name,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        nativeApp: manifest.orbit?.nativeApp || null,
        size: bytes.length,
        // Empreinte OBLIGATOIRE côté application : les archives ne voyagent
        // plus dans Orbit, elles sont téléchargées. C'est elle qui distingue
        // l'archive publiée de celle qu'un intermédiaire aurait remplacée —
        // une entrée sans empreinte est refusée par le magasin.
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    })
    .filter(Boolean);

  // Deux archives pour la MÊME extension : le magasin les afficherait toutes
  // les deux, et son suivi « installée / à mettre à jour » se fait par NOM —
  // il désignerait donc l'une au hasard. C'est arrivé : le script nomme le ZIP
  // d'après le dossier source, et deux dossiers portaient un nom différent de
  // leur archive déjà publiée. On refuse d'écrire un tel catalogue.
  const byName = new Map();
  for (const entry of extensions) {
    const seen = byName.get(entry.name);
    if (seen) {
      console.error(
        `✖ deux archives pour « ${entry.name} » : ${seen.file} et ${entry.file}.\n` +
          '  Renommez le dossier source pour qu\'il porte le nom de l\'archive publiée\n' +
          '  (l\'URL de téléchargement doit rester stable), puis supprimez l\'archive en trop.'
      );
      process.exitCode = 1;
      return;
    }
    byName.set(entry.name, entry);
  }

  const catalog = { version: 1, generatedAt: new Date().toISOString(), extensions };
  const outFile = path.join(OUT, 'catalog.json');
  fs.writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`✔ catalogue : ${extensions.length} extension(s) → ${path.relative(ROOT, outFile)}`);
}

// Les archives publiées disent-elles la même chose que les sources ?
//
// Le piège attrapé ici : une source corrigée, un ZIP jamais réexporté, et la
// même version de part et d'autre — le correctif n'arrive jamais chez
// personne, et rien ne le signale. Seules les extensions dont les SOURCES sont
// dans le dépôt sont vérifiables (`.gitignore` n'en suit qu'une partie).
function checkSources() {
  let drifted = 0;
  for (const name of listSourceExtensions()) {
    const zipPath = path.join(OUT, `${name}.zip`);
    if (!fs.existsSync(zipPath)) {
      console.error(`✖ ${name} : aucune archive ${name}.zip — lancez l'export.`);
      drifted += 1;
      continue;
    }
    const published = new AdmZip(zipPath);
    const inZip = new Map(
      published
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => [e.entryName, e.getData()])
    );
    const sources = walk(path.join(SRC, name));
    const diffs = [];
    for (const file of sources) {
      const current = fs.readFileSync(file.full);
      const archived = inZip.get(file.rel);
      if (!archived) diffs.push(`${file.rel} (absent de l'archive)`);
      else if (!archived.equals(current)) diffs.push(file.rel);
      inZip.delete(file.rel);
    }
    for (const left of inZip.keys()) diffs.push(`${left} (plus dans les sources)`);
    if (diffs.length) {
      drifted += 1;
      console.error(`✖ ${name} : l'archive publiée diffère des sources — ${diffs.join(', ')}`);
    } else {
      console.log(`✔ ${name} : archive conforme aux sources`);
    }
  }
  if (drifted) {
    console.error(
      `\n${drifted} extension(s) à réexporter : \`npm run export:extensions\`.\n` +
        'Pensez à incrémenter la version du manifeste, sinon le magasin considère\n' +
        'la version déjà installée comme à jour et le correctif n\'arrive chez personne.'
    );
    process.exitCode = 1;
  }
}

function listSourceExtensions() {
  return fs
    .readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SRC, e.name, 'manifest.json')))
    .map((e) => e.name);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Aucun dossier de sources : ${path.relative(ROOT, SRC)}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // `--catalog-only` : reconstruire le catalogue à partir des ZIP présents,
  // sans réexporter les sources. C'est ce qu'il faut quand on veut rafraîchir
  // les empreintes sans republier d'archive — et ce que fait la publication.
  if (process.argv.includes('--catalog-only')) {
    writeCatalog();
    return;
  }

  // `--check` : ne rien écrire, dire seulement si une archive publiée a pris
  // du retard sur ses sources. C'est ce que lance la publication.
  if (process.argv.includes('--check')) {
    checkSources();
    return;
  }

  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const available = listSourceExtensions();

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
