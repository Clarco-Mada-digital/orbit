#!/usr/bin/env node
// Release en une commande :
//
//   npm run release 1.6.0
//
// Ce que ça fait :
//   1. Vérifie que le dépôt est propre, que la version n'existe pas déjà et
//      qu'elle a bien ses notes dans CHANGELOG.md
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
import { sectionFor } from './changelog.js';

const run = (cmd) => {
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    // Affiche l'erreur git réelle au lieu d'une trace Node illisible
    if (e.stderr) process.stderr.write(e.stderr.toString());
    process.exit(1);
  }
};
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

// --- Notes de version --------------------------------------------------------
// Avant tout le reste : une release sans notes est une release qu'on ne peut
// plus documenter après coup sans réécrire l'historique. Le même texte servira
// à l'onglet « À propos » et au corps de la release GitHub.
const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
let notes = null;
try {
  notes = sectionFor(readFileSync(changelogPath, 'utf8'), version);
} catch {
  console.error('✗ CHANGELOG.md introuvable à la racine du dépôt.');
  process.exit(1);
}
if (!notes) {
  const today = new Date().toISOString().slice(0, 10);
  console.error(
    `✗ Aucune note de version pour ${version} dans CHANGELOG.md.\n\n` +
      `  Ajoute la section suivante en haut du fichier, puis relance :\n\n` +
      `    ## [${version}] — ${today}\n\n` +
      `    ### Ajouté\n    - …\n\n` +
      `    ### Corrigé\n    - …\n`
  );
  process.exit(1);
}
console.log(`✓ Notes de version trouvées pour ${version} :\n`);
console.log(
  notes
    .split('\n')
    .map((l) => '  │ ' + l)
    .join('\n')
);
console.log('');

// --- Bump de version --------------------------------------------------------
const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version === version) {
  console.log(`✓ package.json est déjà en version ${version} — pas de bump nécessaire.`);
} else {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✓ package.json → version ${version}`);
}

// --- Build de vérification ---------------------------------------------------
console.log('→ Génération des icônes…');
run('npm run icons');

console.log('→ Build du front…');
run('npm run build');

// --- Commit + tag + push -----------------------------------------------------
console.log(`→ Commit, tag ${tag} et push…`);
// Commit seulement si le bump a modifié quelque chose (sinon « nothing to
// commit » ferait échouer le script).
if (quiet('git status --porcelain package.json')) {
  run('git add package.json');
  run(`git commit -m "chore(release): ${tag}"`);
} else {
  console.log('  (rien à committer — version déjà à jour)');
}
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
