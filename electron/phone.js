// ---------------------------------------------------------------------------
// Téléphone — pont natif (adb + scrcpy) pour l'app « Téléphone » d'Orbit.
//
// POURQUOI CE MODULE
//
// Orbit n'a aucune raison de dépendre du scrcpy de la distribution : beaucoup
// de systèmes livrent encore une 1.25, qui ne connaît ni `--list-apps` ni les
// écrans virtuels. On installe donc NOTRE moteur (et son `adb`, livré dans la
// même archive officielle) dans les données de l'application, et on peut le
// mettre à jour depuis l'interface.
//
// Découpage :
//   • `src/lib/phone.js` — logique pure (parsers, réglages, argumentaires) ;
//   • `phone-icons.cjs`  — extraction des icônes depuis les APK (adapté d'Aura) ;
//   • ici                — le matériel : processus adb/scrcpy, réseau, disque.
//
// Sécurité : rien ne passe par un shell côté hôte (`execFile` + tableau
// d'arguments). Du côté de l'appareil, les valeurs interpolées dans un
// `adb shell` sont validées ou échappées (paquets, adresses, texte).
// ---------------------------------------------------------------------------

import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  parseAdbDevices,
  parseForegroundPackage,
  parseScrcpyApps,
  parseScrcpyVersion,
  compareVersions,
  scrcpyCapabilities,
  deviceAddressValid,
  packageValid,
  encodeInputText,
  buildMirrorArgs,
  normalizePhoneSettings,
  parseAndroidNotifications,
  notificationSnoozeCommand,
  pngSize,
  scaledSize,
  virtualDisplaySize,
} from '../src/lib/phone.js';

const require = createRequire(import.meta.url);
const { IconStore } = require('./phone-icons.cjs');

const SCRCPY_REPO = 'Genymobile/scrcpy';
const RELEASE_API = `https://api.github.com/repos/${SCRCPY_REPO}/releases/latest`;
const WINDOWS = process.platform === 'win32';
const EXE = WINDOWS ? '.exe' : '';

// Archive officielle par couple système/architecture. scrcpy ne publie rien
// pour Linux ARM : l'interface doit le dire au lieu de proposer un bouton mort.
const ASSETS = {
  'linux-x64': { re: /^scrcpy-linux-x86_64-v([\d.]+)\.tar\.gz$/i, kind: 'tar' },
  'win32-x64': { re: /^scrcpy-win64-v([\d.]+)\.zip$/i, kind: 'zip' },
  'win32-ia32': { re: /^scrcpy-win32-v([\d.]+)\.zip$/i, kind: 'zip' },
  'darwin-arm64': { re: /^scrcpy-macos-aarch64-v([\d.]+)\.tar\.gz$/i, kind: 'tar' },
  'darwin-x64': { re: /^scrcpy-macos-x86_64-v([\d.]+)\.tar\.gz$/i, kind: 'tar' },
};

export function engineTargetKey() {
  const key = `${process.platform}-${process.arch}`;
  return ASSETS[key] ? key : null;
}

// --- Dossiers ---------------------------------------------------------------

function phoneRoot() {
  return path.join(app.getPath('userData'), 'phone');
}
function engineRoot() {
  return path.join(phoneRoot(), 'engine');
}
function iconsRoot() {
  return path.join(phoneRoot(), 'icons');
}
function settingsFile() {
  return path.join(phoneRoot(), 'settings.json');
}
function appsCacheFile(serial) {
  return path.join(phoneRoot(), `apps-${sanitize(serial)}.json`);
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitize(value) {
  return String(value || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'default';
}

// --- Réglages ---------------------------------------------------------------

let settingsCache = null;

export function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = normalizePhoneSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    settingsCache = normalizePhoneSettings({});
  }
  return settingsCache;
}

export function setSettings(patch) {
  const next = normalizePhoneSettings({ ...getSettings(), ...(patch || {}) });
  settingsCache = next;
  try {
    ensureDir(phoneRoot());
    const tmp = `${settingsFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, settingsFile());
  } catch {
    /* le réglage vit en mémoire : l'écriture est un confort, pas un préalable */
  }
  return next;
}

// --- Exécution --------------------------------------------------------------

// Environnement rendu propre au fils : une AppImage préfixe `LD_LIBRARY_PATH`
// et `PATH` avec ses propres dossiers, et un scrcpy hérité peut alors charger
// les bibliothèques d'Electron au lieu des siennes — puis mourir sans rien
// afficher. On retire donc les chemins de l'AppImage.
function childEnv() {
  const env = { ...process.env };
  const appdir = env.APPDIR;
  if (!appdir) return env;
  for (const key of ['LD_LIBRARY_PATH', 'PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR', 'LD_PRELOAD', 'GTK_PATH', 'GDK_PIXBUF_MODULE_FILE']) {
    const value = env[key];
    if (!value) continue;
    const kept = value.split(path.delimiter).filter((part) => part && !part.startsWith(appdir));
    if (kept.length) env[key] = kept.join(path.delimiter);
    else delete env[key];
  }
  delete env.APPDIR;
  delete env.APPIMAGE;
  return env;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeout === 0 ? 0 : opts.timeout || 30000,
        encoding: opts.encoding || 'utf8',
        env: childEnv(),
      },
      (err, stdout, stderr) =>
        resolve({
          ok: !err,
          code: err ? err.code : 0,
          stdout: stdout || '',
          stderr: (stderr && stderr.toString()) || '',
        })
    );
  });
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    } catch {
      /* fenêtre en cours de fermeture */
    }
  }
}

// --- Moteur (scrcpy + adb) --------------------------------------------------

let engineCache; // { path, version, source } | null | undefined
let latestRelease; // { version, assets } | undefined
let latestAt = 0;

export function resetEngineCache() {
  engineCache = undefined;
}

function engineCandidates() {
  const root = engineRoot();
  const list = [];
  const chosen = getSettings().enginePath;
  if (chosen) list.push(chosen);
  list.push(path.join(root, `scrcpy${EXE}`));
  try {
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry);
      if (fs.statSync(dir).isDirectory()) list.push(path.join(dir, `scrcpy${EXE}`));
    }
  } catch {
    /* pas encore installé */
  }
  list.push(`scrcpy${EXE}`);
  return list.filter(Boolean);
}

function findNamed(root, name) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        return full;
      }
    }
  }
  return null;
}

export async function resolveEngine() {
  if (engineCache !== undefined) return engineCache;
  const rejected = [];
  for (const candidate of engineCandidates()) {
    const out = await run(candidate, ['--version'], { timeout: 8000 });
    const version = parseScrcpyVersion(out.stdout.trim() || out.stderr);
    if (!version) continue;
    if (version.major >= 2) {
      const source = candidate === `scrcpy${EXE}` ? 'system' : 'orbit';
      engineCache = { path: candidate, version, source };
      return engineCache;
    }
    rejected.push({ path: candidate, version });
  }
  engineCache = null;
  if (rejected.length) {
    engineCache = { path: rejected[0].path, version: rejected[0].version, source: 'system', outdated: true };
    return engineCache;
  }
  return null;
}

export function adbPath() {
  const chosen = getSettings().enginePath;
  if (chosen) {
    const sibling = path.join(path.dirname(chosen), `adb${EXE}`);
    if (fs.existsSync(sibling)) return sibling;
  }
  for (const candidate of engineCandidates()) {
    const sibling = path.join(path.dirname(candidate), `adb${EXE}`);
    if (fs.existsSync(sibling)) return sibling;
  }
  return `adb${EXE}`;
}

async function fetchJson(url) {
  const body = await httpGet(url, 20000);
  return JSON.parse(body.toString('utf8'));
}

function httpGet(url, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('trop de redirections'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Orbit-Phone', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpGet(res.headers.location, timeoutMs, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`le serveur a répondu ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('délai réseau dépassé')));
    req.on('error', reject);
  });
}

async function latestScrcpyRelease() {
  const now = Date.now();
  if (latestRelease && now - latestAt < 6 * 60 * 60 * 1000) return latestRelease;
  const data = await fetchJson(RELEASE_API);
  const version = String(data.tag_name || '').replace(/^v/, '');
  if (!version) throw new Error('version introuvable dans la réponse GitHub');
  const assets = (data.assets || []).map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
  }));
  latestRelease = { version, assets };
  latestAt = now;
  return latestRelease;
}

function pickAsset(release) {
  const key = engineTargetKey();
  if (!key) throw new Error(`aucune archive officielle de scrcpy pour ${process.platform}/${process.arch}`);
  const spec = ASSETS[key];
  const asset = release.assets.find((a) => spec.re.test(a.name));
  if (!asset) throw new Error(`l'archive ${key} est absente de la version ${release.version}`);
  return { asset, spec };
}

async function downloadAsset(asset, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const follow = (url, redirects = 0) => {
      if (redirects > 6) return reject(new Error('trop de redirections'));
      https
        .get(url, { headers: { 'User-Agent': 'Orbit-Phone' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            follow(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`le serveur a répondu ${res.statusCode}`));
            return;
          }
          const total = Number(res.headers['content-length']) || asset.size || 0;
          res.on('data', (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            if (onProgress) onProgress({ received, total });
          });
          res.pipe(file);
          res.on('error', reject);
        })
        .on('error', reject);
    };
    file.on('finish', () => file.close(() => resolve(hash.digest('hex'))));
    file.on('error', reject);
    follow(asset.url);
  });
}

// L'empreinte publiée par scrcpy (`SHA256SUMS.txt`) est comparée à celle du
// fichier reçu : un téléchargement altéré est effacé plutôt qu'exécuté.
async function expectedSha(release, assetName) {
  const sums = release.assets.find((a) => /SHA256SUMS\.txt$/i.test(a.name));
  if (!sums) return null;
  const text = (await httpGet(sums.url, 15000)).toString('utf8');
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === assetName) return m[1].toLowerCase();
  }
  return null;
}

async function extractArchive(archivePath, destDir, kind) {
  ensureDir(destDir);
  if (kind === 'tar') {
    const res = await run('tar', ['-xf', archivePath, '-C', destDir], { timeout: 120000 });
    if (!res.ok) throw new Error(`extraction échouée : ${res.stderr || res.stdout}`);
    return;
  }
  // ZIP : `tar` de Windows 10+ (bsdtar) sait les lire. PowerShell prend le
  // relais sur une machine plus ancienne.
  const first = await run('tar', ['-xf', archivePath, '-C', destDir], { timeout: 120000 });
  if (first.ok) return;
  if (!WINDOWS) throw new Error(`extraction ZIP échouée : ${first.stderr || first.stdout}`);
  const ps = await run(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { timeout: 120000 }
  );
  if (!ps.ok) throw new Error(`extraction ZIP échouée : ${ps.stderr || ps.stdout}`);
}

export async function installEngine() {
  const release = await latestScrcpyRelease();
  const { asset, spec } = pickAsset(release);
  const dir = path.join(engineRoot(), release.version);
  ensureDir(dir);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-scrcpy-'));
  const archive = path.join(work, asset.name);
  broadcast('phone:engine-progress', { phase: 'download', received: 0, total: asset.size });
  try {
    const sha = await downloadAsset(asset, archive, (p) =>
      broadcast('phone:engine-progress', { phase: 'download', ...p })
    );
    const expected = await expectedSha(release, asset.name).catch(() => null);
    if (expected && expected !== sha) {
      throw new Error("l'empreinte du téléchargement ne correspond pas à celle publiée");
    }
    broadcast('phone:engine-progress', { phase: 'extract' });
    await extractArchive(archive, dir, spec.kind);
    const binary = findNamed(dir, `scrcpy${EXE}`);
    if (!binary) throw new Error('scrcpy est introuvable dans l\'archive extraite');
    if (!WINDOWS) {
      try {
        fs.chmodSync(binary, 0o755);
      } catch {
        /* droits déjà bons */
      }
    }
    setSettings({ enginePath: binary });
    resetEngineCache();
    broadcast('phone:engine-progress', { phase: 'done', version: release.version });
    return { success: true, version: release.version, path: binary };
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* dossier temporaire déjà parti */
    }
  }
}

export async function engineStatus({ checkUpdate = false } = {}) {
  const found = await resolveEngine();
  // Pas de réseau par défaut : `phone:status` est appelé à chaque ouverture de
  // l'app et doit répondre même hors ligne. Seul l'onglet Réglages demande
  // explicitement une vérification.
  let latest = latestRelease?.version || null;
  if (checkUpdate) {
    try {
      latest = (await latestScrcpyRelease()).version;
    } catch {
      latest = latestRelease?.version || null;
    }
  }
  return {
    found: found ? { path: found.path, version: found.version.release, source: found.source, outdated: !!found.outdated } : null,
    latest,
    updateAvailable: !!(found && latest && compareVersions(latest, found.version.release) > 0),
    targetAvailable: !!engineTargetKey(),
    supportedPlatform: `${process.platform}/${process.arch}`,
    directory: engineRoot(),
  };
}

// --- ADB --------------------------------------------------------------------

async function adb(serial, args, opts) {
  const full = serial ? ['-s', serial, ...args] : args;
  return run(adbPath(), full, opts);
}

export async function adbStartServer() {
  return run(adbPath(), ['start-server'], { timeout: 20000 });
}

// `adb shell` reçoit UNE chaîne de commande : elle est construite à partir de
// valeurs validées/échappées en amont, jamais concaténée librement.
async function deviceShell(serial, command, opts) {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(String(serial || ''))) {
    return { ok: false, code: -1, stdout: '', stderr: 'numéro de série invalide' };
  }
  return adb(serial, ['shell', command], opts);
}

export async function listDevices() {
  await adbStartServer();
  const out = await adb(null, ['devices'], { timeout: 20000 });
  const devices = parseAdbDevices(out.stdout);
  const enriched = await Promise.all(
    devices.map(async (d) => {
      if (d.state !== 'device') return d;
      const info = await deviceInfo(d.serial).catch(() => null);
      return { ...d, ...(info || {}) };
    })
  );
  return enriched;
}

export async function deviceInfo(serial) {
  const [model, android, battery] = await Promise.all([
    deviceShell(serial, 'getprop ro.product.model', { timeout: 8000 }),
    deviceShell(serial, 'getprop ro.build.version.release', { timeout: 8000 }),
    deviceShell(serial, 'dumpsys battery', { timeout: 8000 }),
  ]);
  const level = /^\s*level:\s*(\d+)/m.exec(battery.stdout);
  const status = /^\s*status:\s*(\d+)/m.exec(battery.stdout);
  const charging = status ? status[1] === '2' || status[1] === '5' : false;
  return {
    serial,
    model: model.stdout.trim() || serial,
    android: android.stdout.trim(),
    battery: level ? Number(level[1]) : null,
    charging,
  };
}

const homeCache = new Map(); // serial → { package, at }

// Paquet du lanceur (écran d'accueil). Résolu une fois par appareil : c'est
// ce qui permet au bouton Retour de reconnaître « on est revenu au bureau »
// plutôt que de confondre avec une autre application ouverte volontairement.
async function homePackage(serial) {
  const cached = homeCache.get(serial);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.package;
  const out = await deviceShell(
    serial,
    'cmd package resolve-activity --brief -c android.intent.category.HOME',
    { timeout: 10000 }
  );
  const component = out.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('/'))
    .pop();
  const pkg = component ? component.split('/')[0] : null;
  homeCache.set(serial, { package: pkg, at: Date.now() });
  return pkg;
}

export async function foregroundPackage({ serial } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil' };
  const out = await deviceShell(serial, 'dumpsys activity activities', { timeout: 12000 });
  let top = out.ok ? parseForegroundPackage(out.stdout) : null;
  if (!top) {
    const win = await deviceShell(serial, 'dumpsys window windows', { timeout: 12000 });
    top = parseForegroundPackage(win.stdout);
  }
  const home = top?.package ? top.package === (await homePackage(serial)) : false;
  return {
    success: true,
    package: top?.package || null,
    component: top?.component || null,
    home,
  };
}

export async function connectDevice(address) {
  const value = String(address || '').trim();
  if (!deviceAddressValid(value)) return { success: false, error: 'adresse invalide (hôte ou hôte:port)' };
  const out = await adb(null, ['connect', value], { timeout: 20000 });
  const text = `${out.stdout}${out.stderr}`.trim();
  const ok = out.ok && !/failed|cannot|refused/i.test(text);
  if (!ok) return { success: false, output: text };
  // « connected » ne suffit pas : l'appareil peut être `unauthorized` tant que
  // l'empreinte RSA n'a pas été acceptée sur le téléphone.
  const list = parseAdbDevices((await adb(null, ['devices'], { timeout: 10000 })).stdout);
  const entry = list.find((d) => d.serial === value) || list.find((d) => d.wireless && d.serial.endsWith(value));
  if (entry?.state === 'unauthorized') {
    return {
      success: false,
      output: text,
      error: "Appareil détecté mais non autorisé : acceptez « Autoriser le débogage USB » sur le téléphone.",
    };
  }
  setSettings({ serial: entry?.serial || value });
  return { success: true, output: text };
}

export async function pairDevice({ address, code } = {}) {
  const value = String(address || '').trim();
  const pairing = String(code || '').trim();
  if (!deviceAddressValid(value)) return { success: false, error: 'adresse invalide' };
  if (!/^\d{4,8}$/.test(pairing)) return { success: false, error: 'code d\'appairage invalide' };
  const out = await adb(null, ['pair', value, pairing], { timeout: 30000 });
  const text = `${out.stdout}${out.stderr}`.trim();
  const ok = out.ok && /successfully paired/i.test(text);
  return { success: ok, output: text };
}

export async function disconnectDevice(serial) {
  const value = String(serial || '').trim();
  if (!value) return { success: false, error: 'aucun appareil' };
  if (/:\d+$/.test(value)) await adb(null, ['disconnect', value], { timeout: 15000 });
  else await deviceShell(value, 'echo disconnect', { timeout: 8000 });
  if (getSettings().serial === value) setSettings({ serial: null });
  return { success: true };
}

// --- Applications -----------------------------------------------------------

const appsCache = new Map(); // serial → { apps, at }

function guessName(pkg) {
  const last = String(pkg).split('.').filter(Boolean).pop() || pkg;
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function listApps({ serial, refresh = false } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil sélectionné' };
  const cached = appsCache.get(serial);
  if (!refresh && cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return { success: true, apps: cached.apps, cached: true };
  }
  if (!refresh) {
    try {
      const disk = JSON.parse(fs.readFileSync(appsCacheFile(serial), 'utf8'));
      if (Array.isArray(disk.apps) && Date.now() - Number(disk.at || 0) < 24 * 60 * 60 * 1000) {
        appsCache.set(serial, { apps: disk.apps, at: Number(disk.at) });
        return { success: true, apps: disk.apps, cached: true };
      }
    } catch {
      /* pas de cache disque */
    }
  }

  const engine = await resolveEngine();
  if (engine && scrcpyCapabilities(engine.version).listApps && !engine.outdated) {
    const args = ['--serial', serial, '--list-apps'];
    const out = await run(engine.path, args, { timeout: 150000 });
    const apps = parseScrcpyApps(`${out.stdout}\n${out.stderr}`);
    if (apps.length) {
      const sorted = apps.sort((a, b) => (a.system === b.system ? a.name.localeCompare(b.name, 'fr') : a.system ? 1 : -1));
      appsCache.set(serial, { apps: sorted, at: Date.now() });
      try {
        ensureDir(phoneRoot());
        fs.writeFileSync(appsCacheFile(serial), JSON.stringify({ at: Date.now(), apps: sorted }));
      } catch {
        /* cache disque facultatif */
      }
      return { success: true, apps: sorted, cached: false };
    }
  }

  // Repli sans scrcpy : les noms localisés n'existent pas dans `pm`, on
  // fabrique un libellé lisible depuis le dernier segment du paquet.
  //
  // `--user 0` n'est pas décoratif : sur un appareil avec un profil
  // professionnel (utilisateur secondaire), un `pm list packages` sans
  // utilisateur échoue avec « Shell does not have permission to access user
  // 150 ». On essaie donc l'utilisateur principal d'abord, puis `cmd package`,
  // puis la forme historique.
  const userOnly = getSettings().showSystemApps ? '' : '-3';
  const attempts = [
    `pm list packages --user 0 ${userOnly}`.trim(),
    `cmd package list packages --user 0 ${userOnly}`.trim(),
    `pm list packages ${userOnly}`.trim(),
  ];
  const apps = [];
  const seen = new Set();
  let lastError = '';
  for (const command of attempts) {
    const out = await deviceShell(serial, command, { timeout: 30000 });
    if (!out.ok) {
      lastError = out.stderr || out.stdout || 'adb a échoué';
      continue;
    }
    for (const line of out.stdout.split('\n')) {
      const m = /^package:(.+)$/.exec(line.trim());
      if (!m) continue;
      const pkg = m[1].trim();
      if (!packageValid(pkg) || seen.has(pkg)) continue;
      seen.add(pkg);
      apps.push({ package: pkg, name: guessName(pkg), system: false });
    }
    if (apps.length) break;
    lastError = out.stderr || 'aucune application listée';
  }
  if (!apps.length) {
    if (/permission|user \d+/i.test(lastError)) {
      lastError =
        "Le téléphone refuse la liste des applications (utilisateur ou profil restreint). " +
        "Déverrouillez le téléphone, puis installez le moteur scrcpy depuis les réglages.";
    }
    return { success: false, error: lastError || 'impossible de lister les applications' };
  }
  apps.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  appsCache.set(serial, { apps, at: Date.now() });
  return { success: true, apps, cached: false, fallback: true };
}

const iconStores = new Map();
function iconStore(serial) {
  let store = iconStores.get(serial);
  if (!store) {
    store = new IconStore({
      adbPath: adbPath(),
      serial,
      dir: path.join(iconsRoot(), sanitize(serial)),
    });
    iconStores.set(serial, store);
  }
  return store;
}

export async function getIcon({ serial, package: pkg } = {}) {
  if (!serial || !packageValid(pkg)) return { success: false, error: 'paquet invalide' };
  try {
    const icon = await iconStore(serial).icon(pkg);
    if (!icon) return { success: true, icon: null };
    return { success: true, icon: `data:${icon.mime};base64,${icon.data}` };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

export function clearIconCache(serial) {
  const store = iconStores.get(serial);
  if (store) store.clear();
  appsCache.delete(serial);
  try {
    fs.rmSync(appsCacheFile(serial), { force: true });
  } catch {
    /* déjà absent */
  }
}

export async function launchApp({ serial, package: pkg } = {}) {
  if (!serial || !packageValid(pkg)) return { success: false, error: 'paquet invalide' };
  // La commande `monkey` est le moyen le plus portable de lancer une
  // application sans connaître son activité. Si elle échoue, `am start` avec
  // l'activité résolue prend le relais.
  const monkey = await deviceShell(
    serial,
    `monkey --user 0 -p ${pkg} -c android.intent.category.LAUNCHER 1`,
    { timeout: 15000 }
  );
  if (monkey.ok && !/No activities found|monkey aborted/i.test(`${monkey.stdout}${monkey.stderr}`)) {
    return { success: true };
  }
  const resolved = await deviceShell(serial, `cmd package resolve-activity --brief --user 0 -c android.intent.category.LAUNCHER ${pkg}`, { timeout: 10000 });
  const component = resolved.stdout.split('\n').map((l) => l.trim()).filter((l) => l.includes('/')).pop();
  if (!component) return { success: false, error: `${pkg} ne se lance pas` };
  const started = await deviceShell(serial, `am start --user 0 -n ${component}`, { timeout: 15000 });
  if (!started.ok || /Error|Exception/i.test(started.stdout)) {
    return { success: false, error: `${pkg} ne se lance pas` };
  }
  return { success: true };
}

// Adresse tapée dans la recherche : elle s'ouvre SUR le téléphone (le geste
// attendu quand on a le hub sous les yeux et le mobile à portée de main).
export async function openUrlOnDevice({ serial, url } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil' };
  const value = String(url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return { success: false, error: 'adresse invalide' };
  const out = await deviceShell(serial, `am start --user 0 -a android.intent.action.VIEW -d ${encodeInputText(value)}`, {
    timeout: 15000,
  });
  const ok = out.ok && !/Error|Exception/i.test(out.stdout);
  return { success: ok, error: ok ? undefined : 'le téléphone a refusé d\'ouvrir ce lien' };
}

// --- Notifications ----------------------------------------------------------

// Les clés seules : le dump complet pèse plus d'un mégaoctet et coûte ~0,3 s,
// alors que cette liste tient en quelques centaines d'octets. Le sondage
// régulier passe par ici et ne demande le détail que si l'ensemble a bougé.
export async function listNotificationKeys({ serial } = {}) {
  if (!serial) return [];
  const out = await deviceShell(serial, 'cmd notification list', { timeout: 8000 });
  if (!out.ok) return [];
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|'));
}

export async function listNotifications({ serial } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil', items: [] };
  const out = await deviceShell(serial, 'dumpsys notification --noredact', { timeout: 20000 });
  if (!out.ok) {
    return { success: false, error: 'notifications illisibles sur cet appareil', items: [] };
  }
  try {
    return { success: true, items: parseAndroidNotifications(out.stdout) };
  } catch (err) {
    return { success: false, error: String(err.message || err), items: [] };
  }
}

export async function dismissNotification({ serial, key } = {}) {
  const value = String(key || '').trim();
  if (!serial || !value) return { success: false, error: 'notification inconnue' };
  const out = await deviceShell(serial, notificationSnoozeCommand(value), { timeout: 10000 });
  const ok = out.ok && /snooz/i.test(`${out.stdout}${out.stderr}`);
  return { success: ok, error: ok ? undefined : 'le téléphone a refusé d\'écarter la notification' };
}

export async function dismissNotifications({ serial, keys } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil', count: 0 };
  const list = (Array.isArray(keys) ? keys : []).slice(0, 64).map((k) => String(k));
  let count = 0;
  for (const key of list) {
    const res = await dismissNotification({ serial, key });
    if (res.success) count += 1;
  }
  return { success: true, count };
}

// Réveille l'écran et ouvre le volet des notifications SUR le téléphone :
// l'utilisateur voit la notification dans son contexte, avec ses actions.
export async function expandNotificationShade({ serial } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil' };
  const out = await deviceShell(serial, 'cmd statusbar expand-notifications', { timeout: 8000 });
  return { success: out.ok };
}

// --- Capture et entrée ------------------------------------------------------

export async function captureScreen({ serial, maxWidth, displayId } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil' };
  const display = Number(displayId);
  const screencap = Number.isInteger(display) && display >= 0 ? `screencap -p -d ${display}` : 'screencap -p';
  const out = await adb(serial, ['exec-out', screencap], {
    timeout: 20000,
    encoding: 'buffer',
  });
  if (!out.ok || !out.stdout || !out.stdout.length) {
    return { success: false, error: 'capture d\'écran impossible' };
  }
  const raw = Buffer.from(out.stdout);
  const size = pngSize(raw);
  if (!size) return { success: false, error: 'capture illisible' };

  // Chemin RAPIDE : l'image demandée est au moins aussi large que l'écran du
  // téléphone. On transmet alors le PNG tel qu'adb l'a produit. Décoder puis
  // ré-encoder en PNG (nativeImage.toDataURL) coûtait l'essentiel du temps
  // d'une capture (~100 ms sur un écran 1080p) pour un résultat identique.
  // Le renderer réduit lui-même à l'affichage, sans perte.
  const target = scaledSize(size.width, size.height, maxWidth || 540);
  if (target.width === size.width) {
    return {
      success: true,
      dataUrl: `data:image/png;base64,${raw.toString('base64')}`,
      width: size.width,
      height: size.height,
      deviceWidth: size.width,
      deviceHeight: size.height,
      passthrough: true,
    };
  }

  // Chemin RÉDUIT : la fenêtre d'Orbit est plus étroite que le téléphone. On
  // décode une seule fois et on ne ré-encode QUE l'image réduite.
  let image = nativeImage.createFromBuffer(raw);
  if (image.isEmpty()) return { success: false, error: 'capture illisible' };
  image = image.resize({ width: target.width, quality: 'good' });
  const finalSize = image.getSize();
  return {
    success: true,
    dataUrl: image.toDataURL(),
    // `width`/`height` : dimensions de l'image envoyée. `deviceWidth`/
    // `deviceHeight` : dimensions réelles de l'écran, indispensables pour
    // convertir un clic sur l'aperçu (souvent réduit) en coordonnées de l'adb.
    width: finalSize.width,
    height: finalSize.height,
    deviceWidth: size.width,
    deviceHeight: size.height,
  };
}

const ALLOWED_KEYS = {
  back: 4,
  home: 3,
  recents: 187,
  power: 26,
  wakeup: 224,
  volume_up: 24,
  volume_down: 25,
  enter: 66,
  menu: 82,
  camera: 27,
  play_pause: 85,
  mute: 164,
  // Navigation clavier : les flèches du clavier d'Orbit pilotent l'app ouverte
  // sur l'écran virtuel, comme sur un vrai bureau.
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
  backspace: 67,
  delete: 112,
  tab: 61,
  page_up: 92,
  page_down: 93,
  move_home: 122,
  move_end: 123,
  space: 62,
};

// Sur un écran virtuel, les gestes doivent viser CE display : sans `-d`, ils
// partent sur l'écran principal du téléphone (l'app ne réagit pas).
function inputCommand(displayId, tail) {
  const display = Number(displayId);
  const prefix = Number.isInteger(display) && display >= 0 ? `-d ${display} ` : '';
  return `input ${prefix}${tail}`;
}

export async function sendKey({ serial, key, displayId } = {}) {
  const code = ALLOWED_KEYS[String(key || '').toLowerCase()];
  if (!serial || code === undefined) return { success: false, error: 'touche inconnue' };
  const out = await deviceShell(serial, inputCommand(displayId, `keyevent ${code}`), { timeout: 8000 });
  return { success: out.ok };
}

export async function sendTap({ serial, x, y, displayId } = {}) {
  const px = Math.max(0, Math.round(Number(x) || 0));
  const py = Math.max(0, Math.round(Number(y) || 0));
  if (!serial) return { success: false, error: 'aucun appareil' };
  const out = await deviceShell(serial, inputCommand(displayId, `tap ${px} ${py}`), { timeout: 8000 });
  return { success: out.ok };
}

export async function sendSwipe({ serial, x1, y1, x2, y2, duration, displayId } = {}) {
  const args = [x1, y1, x2, y2, duration || 220].map((v) => Math.max(0, Math.round(Number(v) || 0)));
  if (!serial) return { success: false, error: 'aucun appareil' };
  const out = await deviceShell(serial, inputCommand(displayId, `swipe ${args.join(' ')}`), { timeout: 10000 });
  return { success: out.ok };
}

export async function sendText({ serial, text, displayId } = {}) {
  const value = String(text || '');
  if (!serial || !value) return { success: false, error: 'texte vide' };
  if (value.length > 500) return { success: false, error: 'texte trop long (500 caractères max)' };
  const out = await deviceShell(serial, inputCommand(displayId, `text ${encodeInputText(value)}`), {
    timeout: 10000,
  });
  return { success: out.ok };
}

// --- Écran virtuel par application -----------------------------------------
//
// Afficher un écran de téléphone en portrait dans une fenêtre large laisse
// forcément des bandes noires. Pour qu'une app REMPLISSE la zone d'Orbit, on
// lui donne un écran virtuel à l'aspect de cette zone (scrcpy ≥ 3.0,
// Android 11+). scrcpy ne sert ici qu'à maintenir l'écran en vie : `--no-playback`
// évite sa propre fenêtre, et les gestes passent par `adb shell input -d`.
//
// Si l'appareil refuse (surcouche, écran verrouillé, scrcpy ancien), on
// retombe proprement sur l'écran principal avec `launchApp`.
let appSession = null;

function killAppSession() {
  if (appSession?.child && appSession.child.exitCode === null) {
    try {
      appSession.child.kill();
    } catch {
      /* déjà mort */
    }
  }
  appSession = null;
}

export function appSessionStatus() {
  return {
    running: !!appSession,
    package: appSession?.package || null,
    displayId: appSession?.displayId ?? null,
    width: appSession?.width || null,
    height: appSession?.height || null,
  };
}

export function stopAppSession() {
  killAppSession();
  return { success: true };
}

export async function startAppSession({ serial, package: pkg, width, height } = {}) {
  killAppSession();
  if (!serial) return { success: false, error: 'aucun appareil' };
  if (!packageValid(pkg)) return { success: false, error: 'paquet invalide' };
  const engine = await resolveEngine();
  if (!engine) {
    return { success: false, error: "scrcpy n'est pas installé", fallback: true };
  }
  if (!scrcpyCapabilities(engine.version).virtualDisplay) {
    return {
      success: false,
      error: 'écrans virtuels : scrcpy 3.0+ requis',
      fallback: true,
    };
  }

  const size = virtualDisplaySize(
    width || getSettings().appDisplayWidth,
    height || getSettings().appDisplayHeight
  );
  const args = [
    '--serial',
    serial,
    `--new-display=${size.width}x${size.height}/${size.dpi}`,
    `--start-app=${pkg}`,
    '--no-audio',
    '--no-playback',
    '--video-codec=h264',
    `--max-fps=${Math.min(30, getSettings().mirrorFps)}`,
  ];

  const child = spawn(engine.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(),
    detached: false,
  });

  const displayId = await new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 12000);
    const onData = (chunk) => {
      output = (output + chunk).slice(-8000);
      const match = /\(id=(\d+)\)/.exec(output);
      if (match) finish(Number(match[1]));
      // L'écran existe mais l'app n'a pas démarré : autant le dire tout de
      // suite et laisser l'interface basculer sur l'écran principal, plutôt
      // que d'afficher un écran virtuel noir.
      if (/Activity not started|Unable to resolve|does not exist/i.test(output)) finish(null);
    };
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
  });

  if (displayId === null) {
    try {
      child.kill();
    } catch {
      /* déjà mort */
    }
    return {
      success: false,
      error:
        "écran virtuel refusé par l'appareil (Android 11+ et écran déverrouillé requis)",
      fallback: true,
    };
  }

  // L'écran est créé : on laisse les tuyaux se vider (un tampon plein
  // bloquerait scrcpy) sans garder les lignes en mémoire.
  child.stdout?.resume?.();
  child.stderr?.resume?.();

  appSession = {
    child,
    serial,
    package: pkg,
    displayId,
    width: size.width,
    height: size.height,
  };
  child.on('exit', () => {
    if (appSession?.child === child) appSession = null;
  });
  return { success: true, displayId, width: size.width, height: size.height };
}

// --- Miroir (fenêtre scrcpy dédiée) ----------------------------------------

let mirrorChild = null;
let mirrorSerial = null;

export function mirrorStatus() {
  return {
    running: !!(mirrorChild && !mirrorChild.killed && mirrorChild.exitCode === null),
    serial: mirrorSerial,
  };
}

export async function startMirror({ serial, title, package: pkg } = {}) {
  if (!serial) return { success: false, error: 'aucun appareil' };
  const engine = await resolveEngine();
  if (!engine) {
    return { success: false, error: "scrcpy n'est pas installé. Installez le moteur depuis les réglages." };
  }
  stopMirror();
  const args = buildMirrorArgs({ serial, title: title || 'Téléphone', packageName: pkg, settings: getSettings() });
  // Une 1.25 système ne connaît pas `--no-audio` : elle refuserait de démarrer.
  if (!scrcpyCapabilities(engine.version).audio) {
    const i = args.indexOf('--no-audio');
    if (i >= 0) args.splice(i, 1);
  }
  const child = spawn(engine.path, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: childEnv(),
    detached: false,
  });
  mirrorChild = child;
  mirrorSerial = serial;
  child.stderr?.setEncoding?.('utf8');
  let tail = '';
  child.stderr?.on('data', (chunk) => {
    tail = (tail + chunk).slice(-2000);
  });
  child.on('exit', (code) => {
    if (mirrorChild === child) {
      mirrorChild = null;
      mirrorSerial = null;
    }
    broadcast('phone:mirror-stopped', { serial, code, detail: tail.trim() });
  });
  child.on('error', (err) => {
    broadcast('phone:mirror-stopped', { serial, code: -1, detail: err.message });
  });
  return { success: true };
}

export function stopMirror() {
  if (mirrorChild && mirrorChild.exitCode === null) {
    try {
      mirrorChild.kill();
    } catch {
      /* déjà mort */
    }
  }
  mirrorChild = null;
  mirrorSerial = null;
  return { success: true };
}

export function cleanup() {
  stopMirror();
  killAppSession();
}
