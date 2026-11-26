#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Catalogue des thèmes de la communauté
//
//   node scripts/export-themes.mjs          → écrit themes-dist/catalog.json
//   node scripts/export-themes.mjs --check  → vérifie sans rien écrire
//
// Chaque thème partagé est UN fichier JSON dans themes-dist/ (format décrit
// dans docs/guide-themes.md). Ce script les valide avec le MÊME code que
// l'import dans Orbit (src/lib/customTheme.js), puis écrit le catalogue lu par
// Réglages → Apparence → Thèmes de la communauté.
//
// Exigences du catalogue, plus strictes qu'un import personnel :
//   • le nom du fichier est l'identifiant du thème (ocean.json → "ocean") ;
//   • aucun avertissement de lisibilité : un thème partagé doit être lisible
//     par tout le monde — même règle que pour les thèmes livrés avec Orbit ;
//   • un auteur est indiqué ;
//   • identifiants uniques.
// Chaque entrée porte la taille et l'empreinte SHA-256 du fichier : Orbit
// refuse un fichier qui ne correspond pas à ce que le catalogue annonce.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseTheme } from '../src/lib/customTheme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'themes-dist');
const CHECK = process.argv.includes('--check');

// Quatre couleurs par ambiance suffisent pour un aperçu fidèle dans le
// sélecteur, sans télécharger le thème.
const PREVIEW_KEYS = ['bgPrimary', 'bgElevated', 'textPrimary', 'accent'];

export function buildThemeCatalog(dir = DIR) {
  const errors = [];
  const themes = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'catalog.json')
    .sort();
  const seen = new Set();
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file));
    const result = parseTheme(bytes.toString('utf8'));
    const where = `themes-dist/${file}`;
    if (!result.ok) {
      errors.push(`${where} : ${result.errors.join(' ; ')}`);
      continue;
    }
    const { theme } = result;
    if (`${theme.id}.json` !== file) errors.push(`${where} : le fichier doit s'appeler ${theme.id}.json`);
    if (seen.has(theme.id)) errors.push(`${where} : identifiant « ${theme.id} » déjà utilisé`);
    seen.add(theme.id);
    if (!theme.author) errors.push(`${where} : indiquez un « author »`);
    if (result.warnings.length) errors.push(`${where} : ${result.warnings.join(' ; ')}`);
    const preview = {};
    for (const mode of ['dark', 'light']) {
      if (theme[mode]) preview[mode] = Object.fromEntries(PREVIEW_KEYS.map((k) => [k, theme[mode][k]]));
    }
    themes.push({
      id: theme.id,
      name: theme.name,
      author: theme.author || '',
      description: theme.description || '',
      file,
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      modes: Object.keys(preview),
      preview,
    });
  }
  return { errors, catalog: { version: 1, themes } };
}

function main() {
  const { errors, catalog } = buildThemeCatalog();
  if (errors.length) {
    console.error('✗ Thèmes refusés :\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  const out = path.join(DIR, 'catalog.json');
  const text = `${JSON.stringify(catalog, null, 2)}\n`;
  if (CHECK) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (current !== text) {
      console.error('✗ themes-dist/catalog.json n’est pas à jour : lancez « npm run export:themes ».');
      process.exit(1);
    }
    console.log(`✔ catalogue des thèmes à jour (${catalog.themes.length})`);
    return;
  }
  fs.writeFileSync(out, text);
  console.log(`✔ catalogue : ${catalog.themes.length} thème(s) → themes-dist/catalog.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
