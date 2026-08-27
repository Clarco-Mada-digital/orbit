#!/usr/bin/env node
// Extrait d'un CHANGELOG.md la section d'une version.
//
//   node scripts/changelog.js 1.7.3        → écrit les notes sur la sortie standard
//   node scripts/changelog.js 1.7.3 --check → vérifie seulement qu'elles existent
//
// Utilisé par npm run release (garde-fou avant de taguer) ET par la CI, qui
// s'en sert comme corps de la release GitHub. Le même texte des deux côtés.

import { readFileSync } from 'node:fs';

const CHANGELOG = new URL('../CHANGELOG.md', import.meta.url);

export function sectionFor(markdown, version) {
  const lines = String(markdown).split('\n');
  const isHead = (l) => /^##\s+\[?\d+\.\d+\.\d+/.test(l);
  const wanted = String(version).replace(/^v/, '');

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+\[?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/);
    if (m && m[1] === wanted) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHead(lines[i])) {
      end = i;
      break;
    }
  }

  // On retire le titre (la release GitHub porte déjà le numéro de version) et
  // la ligne de séparation finale éventuelle.
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/\n*^---\s*$[\s\S]*/m, '')
    .trim();

  return body || null;
}

// Exécution directe (pas un import)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const version = process.argv[2];
  if (!version) {
    console.error('✗ Usage : node scripts/changelog.js <version> [--check]');
    process.exit(1);
  }
  let md;
  try {
    md = readFileSync(CHANGELOG, 'utf8');
  } catch {
    console.error('✗ CHANGELOG.md introuvable.');
    process.exit(1);
  }
  const body = sectionFor(md, version);
  if (!body) {
    console.error(
      `✗ Aucune note de version pour ${version} dans CHANGELOG.md.\n` +
        `  Ajoute une section :\n\n` +
        `    ## [${String(version).replace(/^v/, '')}] — ${new Date().toISOString().slice(0, 10)}\n\n` +
        `    ### Corrigé\n    - …\n`
    );
    process.exit(1);
  }
  if (!process.argv.includes('--check')) process.stdout.write(body + '\n');
}
