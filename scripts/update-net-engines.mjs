#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Mise à jour des moteurs du réseau privé (electron/net-engines.json).
//
// Le réseau Tor REFUSE les versions trop anciennes de Tor (fin octobre 2026,
// les clients 0.4.8 ont été rejetés) : Orbit doit suivre les versions stables.
// Ce script :
//   1. trouve la dernière version stable du Tor Expert Bundle pour ordinateur ;
//   2. télécharge sha256sums-signed-build.txt et sa signature ;
//   3. VÉRIFIE la signature avec gpg, contre l'empreinte figée ci-dessous de la
//      clé « Tor Browser Developers » — sans signature valide, rien n'est écrit ;
//   4. relève les empreintes des archives wireproxy de la dernière version ;
//   5. réécrit net-engines.json.
//
// Usage : node scripts/update-net-engines.mjs   (nécessite gpg)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'electron', 'net-engines.json');
const TOR_KEY = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';
const DIST = 'https://dist.torproject.org/torbrowser/';
const KEYS = ['linux-x86_64', 'linux-aarch64', 'macos-x86_64', 'macos-aarch64', 'windows-x86_64', 'windows-i686'];
const WIREPROXY = { 'linux-x86_64': 'linux_amd64', 'linux-aarch64': 'linux_arm64', 'macos-x86_64': 'darwin_amd64', 'macos-aarch64': 'darwin_arm64', 'windows-x86_64': 'windows_amd64', 'windows-i686': 'windows_386' };

const text = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'Orbit-maintenance' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
};

// 1. Versions stables (x.y ou x.y.z, sans « a » d'alpha), de la plus récente
//    à la plus ancienne ; on retient la première qui a les archives ordinateur
//    (certaines versions ne concernent qu'Android).
const versions = [...(await text(DIST)).matchAll(/href="(\d+\.\d+(?:\.\d+)?)\/"/g)]
  .map((m) => m[1])
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
let tor = null;
for (const v of versions) {
  const sums = await text(`${DIST}${v}/sha256sums-signed-build.txt`).catch(() => '');
  if (!sums.includes(`tor-expert-bundle-linux-x86_64-${v}.tar.gz`)) continue;
  tor = { version: v, sums };
  break;
}
if (!tor) throw new Error('aucune version stable avec les archives ordinateur');

// 2-3. Signature.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-tor-'));
const gnupg = path.join(tmp, 'gnupg');
fs.mkdirSync(gnupg, { mode: 0o700 });
fs.writeFileSync(path.join(tmp, 'sums.txt'), tor.sums);
fs.writeFileSync(path.join(tmp, 'sums.txt.asc'), await text(`${DIST}${tor.version}/sha256sums-signed-build.txt.asc`));
fs.writeFileSync(path.join(tmp, 'key.asc'), await text(`https://keys.openpgp.org/vks/v1/by-fingerprint/${TOR_KEY}`));
const gpg = (args) => execFileSync('gpg', ['--homedir', gnupg, '--batch', ...args], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
gpg(['--import', path.join(tmp, 'key.asc')]);
let status = '';
try {
  status = execFileSync('gpg', ['--homedir', gnupg, '--batch', '--status-fd', '1', '--verify', path.join(tmp, 'sums.txt.asc'), path.join(tmp, 'sums.txt')], {
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  status = String(err.stdout || '');
}
// VALIDSIG <empreinte de la sous-clé> … <empreinte de la clé PRINCIPALE>
const valid = /^\[GNUPG:\] VALIDSIG .* ([0-9A-F]{40})$/m.exec(status);
if (!valid || valid[1] !== TOR_KEY) {
  fs.rmSync(tmp, { recursive: true, force: true });
  throw new Error('signature des empreintes Tor INVALIDE : net-engines.json inchangé');
}
fs.rmSync(tmp, { recursive: true, force: true });

const files = {};
for (const key of KEYS) {
  const name = `tor-expert-bundle-${key}-${tor.version}.tar.gz`;
  const m = new RegExp(`^([0-9a-f]{64})\\s+${name.replace(/\./g, '\\.')}$`, 'm').exec(tor.sums);
  if (m) files[key] = { url: `${DIST}${tor.version}/${name}`, sha256: m[1] };
}
// Version de « tor » lui-même : lue dans la page de téléchargement officielle.
const page = await text('https://www.torproject.org/download/tor/').catch(() => '');
const torVersion = new RegExp(`${tor.version.replace(/\./g, '\\.')}[^\\n]{0,200}?\\(tor (\\d+\\.\\d+\\.\\d+\\.\\d+)\\)`).exec(page)?.[1];

// 4. wireproxy : empreintes publiées par GitHub pour chaque archive.
const rel = await (await fetch('https://api.github.com/repos/windtf/wireproxy/releases/latest', { headers: { 'user-agent': 'Orbit-maintenance' } })).json();
const wp = {};
for (const [key, suffix] of Object.entries(WIREPROXY)) {
  const asset = rel.assets.find((a) => a.name === `wireproxy_${suffix}.tar.gz`);
  if (asset?.digest?.startsWith('sha256:')) wp[key] = { url: asset.browser_download_url, sha256: asset.digest.slice(7) };
}

const previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const next = {
  ...previous,
  tor: { version: tor.version, torVersion: torVersion || previous.tor.torVersion, verifiedAt: today, files },
  wireproxy: { version: rel.tag_name.replace(/^v/, ''), verifiedAt: today, files: wp },
};
fs.writeFileSync(OUT, `${JSON.stringify(next, null, 2)}\n`);
console.log(`✔ Tor ${tor.version} (signature valide, ${Object.keys(files).length} archives) · wireproxy ${next.wireproxy.version} (${Object.keys(wp).length} archives)`);
