#!/usr/bin/env node
// Exporte l'extension Fake Data Filler (Manifest V3) en ZIP installable.
// Utilisation : npm run export:fake-data
// Sortie :
//   - extensions-dist/fake-data-filler-orbit.zip (pour distribution, suivi git)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'electron', 'extensions', 'fake-data-sources');
const distZipDir = path.join(rootDir, 'extensions-dist');
const distZipPath = path.join(distZipDir, 'fake-data-filler-orbit.zip');

if (!fs.existsSync(srcDir)) {
  console.error('ERROR: Extension Fake Data introuvable:', srcDir);
  process.exit(1);
}

// Creer extensions-dist/ si inexistant
if (!fs.existsSync(distZipDir)) {
  fs.mkdirSync(distZipDir, { recursive: true });
}

// Creer le ZIP
console.log('Export vers:', distZipPath);
let cmd;
if (process.platform === 'win32') {
  cmd = `powershell -Command "Compress-Archive -Path '${srcDir.replace(/'/g, "''")}/*' -DestinationPath '${distZipPath.replace(/'/g, "''")}' -Force"`;
} else {
  cmd = `cd '${srcDir}' && zip -r '${distZipPath}' . -x '*.git*' '*.DS_Store*'`;
}

try {
  execSync(cmd, { stdio: 'inherit' });
  const stat = fs.statSync(distZipPath);
  const sizeKB = (stat.size / 1024).toFixed(1);
  console.log(`\nSUCCESS: ZIP cree dans extensions-dist/: (${sizeKB} Ko)\n`);
  console.log('Fichier distribuable: extensions-dist/fake-data-filler-orbit.zip');
  console.log('\nCe fichier est suivi en git (extensions-dist/)');
  console.log('Pour installer manuellement:');
  console.log('  1. Ouvrir chrome://extensions');
  console.log('  2. Activer le mode developpeur');
  console.log('  3. Charger l\'extension depaquetee depuis electron/extensions/fake-data-sources');
  console.log('  4. Ou glisser-deposer le ZIP dans Firefox\n');
} catch (err) {
  console.error('ERROR: Echec de la creation du ZIP:', err.message);
  process.exit(1);
}
