#!/usr/bin/env node
// Release en une commande :
//
//   npm run release 1.6.0
//
// Ce que ça fait :
//   1. Vérifie que le dépôt est propre et que la version n'existe pas déjà
//   2. Bump « version » dans package.json
//   3. Génère les icônes + build le front (vérification que tout compile)
//   4. Commit « chore(release): vX.Y.Z », crée le tag vXYZ et pousse
//   5. GitHub Actions (.github/workflows/release.yml) construit alors la
//      release COMPLÈTE (AppImage, .deb, .exe Windows, .dmg macOS) et la
//      publie — sans token à fournir localement.
//
// Le numéro de version est obligatoire (avec ou sans « v »).

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const quiet = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// --- Argument -------------------------------------------------------------
const raw = process.argv[2];
if (!raw) {
  console.error('✗ Usage : npm run release <version>   (ex. npm run release 1.6.0)');
  process.exit(1);
}
const version = raw.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`✗ Version invalide : « ${raw} » (attendu : X.Y.Z, ex. 1.6.0)`);
  process.exit(1);
}
const tag = `v${version}`;

// --- Garde-fous ------------------------------------------------------------
try {
  const status = quiet('git status --porcelain');
  if (status) {
    console.error('✗ Le dépôt contient des modifications non commitées.\n' +
      '  Committe-les d’abord (ou stash), puis relance : npm run release ' + version);
    process.exit(1);
  }
} catch {
  console.error('✗ Pas un dépôt git ?');
  process.exit(1);
}

const existingTags = quiet('git tag -l');
if (existingTags.split('\n').includes(tag)) {
  console.error(`✗ Le tag ${tag} existe déjà. Choisis une autre version.`);
  process.exit(1);
}

// --- Bump de version --------------------------------------------------------
const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json → version ${version}`);

// --- Build de vérification ---------------------------------------------------
console.log('→ Génération des icônes…');
run('npm run icons');

console.log('→ Build du front…');
run('npm run build');

// --- Commit + tag + push -----------------------------------------------------
console.log(`→ Commit, tag ${tag} et push…`);
run('git add package.json');
run(`git commit -m "chore(release): ${tag}"`);
run(`git tag ${tag}`);
run('git push origin HEAD');
run(`git push origin ${tag}`);

console.log(`
✓ Tag ${tag} poussé !
  GitHub Actions construit maintenant la release complète
  (Linux + Windows + macOS). Suivi :
  https://github.com/Clarco-Mada-digital/orbit/actions

  La release apparaîtra ici (~15 min) :
  https://github.com/Clarco-Mada-digital/orbit/releases/tag/${tag}
`);
