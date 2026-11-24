#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pilotes SQL téléchargés à la demande (app « Base de données »).
//
// Le pilote SQL Server (`mssql` → `tedious`) tire toute la pile
// d'authentification Azure : ~72 Mo dans node_modules. L'embarquer dans Orbit
// ferait payer ce poids à TOUS les utilisateurs, extension installée ou non.
//
// On le regroupe donc en UN fichier (esbuild : seul le code réellement
// atteint est gardé, ~1,7 Mo), publié avec le catalogue d'extensions. Orbit
// le télécharge à la première connexion SQL Server et vérifie son empreinte
// SHA-256, inscrite ici dans electron/db-drivers.json — jamais lue sur le
// réseau : un serveur compromis ne peut pas faire exécuter autre chose.
//
// Usage : npm run drivers   (à relancer après une mise à jour de `mssql`)
//         npm run drivers -- --check   (vérifie que le fichier publié suit)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'extensions-dist', 'drivers');
const MANIFEST = path.join(ROOT, 'electron', 'db-drivers.json');
const require = createRequire(import.meta.url);

// Pilotes lourds ou rares : SQL Server (tedious + Azure) et Oracle (mode Thin).
const DRIVERS = { mssql: 'mssql', oracledb: 'oracledb' };

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function bundle(name, entry) {
  const version = require(`${entry}/package.json`).version;
  const file = `${name}-${version}.cjs`;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
    // Mode « Thick » d'Oracle (binaire natif) : jamais utilisé par Orbit.
    external: ['*.node'],
  });
  const code = Buffer.from(result.outputFiles[0].contents);
  return { name, version, file, code, sha256: sha256(code), size: code.length };
}

const check = process.argv.includes('--check');
const manifest = {};
for (const [name, entry] of Object.entries(DRIVERS)) {
  const out = await bundle(name, entry);
  manifest[name] = { version: out.version, file: out.file, sha256: out.sha256, size: out.size };
  const target = path.join(OUT_DIR, out.file);
  if (check) {
    const published = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
    if (published !== out.sha256) {
      console.error(`✖ ${out.file} n'est pas à jour — lancez « npm run drivers »`);
      process.exitCode = 1;
    } else console.log(`✔ ${out.file}`);
    continue;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const old of fs.readdirSync(OUT_DIR)) if (old.startsWith(`${name}-`) && old !== out.file) fs.rmSync(path.join(OUT_DIR, old));
  fs.writeFileSync(target, out.code);
  console.log(`✔ ${out.file} (${(out.size / 1024 / 1024).toFixed(2)} Mo) sha256 ${out.sha256.slice(0, 16)}…`);
}
if (!check) fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
