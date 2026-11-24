// ---------------------------------------------------------------------------
// Réseau privé : moteurs Tor et VPN (WireGuard) d'Orbit.
//
// Chaque moteur est un exécutable OFFICIEL téléchargé à la demande, vérifié
// par empreinte SHA-256 (net-engines.json), qui expose un proxy SOCKS5 sur
// 127.0.0.1. Le processus principal y branche ensuite les sessions des apps
// (règles `orbit:tor` / `orbit:vpn`, voir src/lib/privateNetwork.js).
//
// Rien ne s'installe dans le système, aucun droit administrateur : tout vit
// dans le dossier de données d'Orbit et s'arrête avec lui.
// ---------------------------------------------------------------------------
import { session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import netmod from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import * as secureStore from './secure-store.js';
import {
  buildTorrc,
  parseBootstrap,
  readPtConfig,
  parseBridgeLines,
  parseWireguardConf,
  buildWireproxyConfig,
  enginePlatformKey,
  parseTorCheck,
  guessVpnProvider,
  resolveNetworkRule,
  NETWORK_RULES,
} from '../src/lib/privateNetwork.js';

const require = createRequire(import.meta.url);
const ENGINES = require('./net-engines.json');
const WINDOWS = process.platform === 'win32';
const CHECK_URL = 'https://check.torproject.org/api/ip';

const state = {
  root: null,
  config: { torBridges: 'none', customBridges: '', autoStart: true, warnings: true, vpn: null },
  tor: { status: 'off', progress: 0, summary: '', port: 0, controlPort: 0, error: '', proc: null, log: [] },
  vpn: { status: 'off', port: 0, error: '', proc: null, log: [] },
  install: { tor: null, wireproxy: null },
  onChange: () => {},
};

// --- Persistance ----------------------------------------------------------------

const configFile = () => path.join(state.root, 'config.json');

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    state.config = {
      torBridges: ['none', 'snowflake', 'obfs4', 'meek', 'custom'].includes(c.torBridges) ? c.torBridges : 'none',
      customBridges: typeof c.customBridges === 'string' ? c.customBridges.slice(0, 20000) : '',
      autoStart: c.autoStart !== false,
      warnings: c.warnings !== false,
      vpn: c.vpn && typeof c.vpn.enc === 'string' ? c.vpn : null,
    };
  } catch {
    /* première utilisation */
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(state.root, { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(state.config, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[réseau privé] réglages non sauvegardés :', err.message);
  }
}

export function init(userDataPath, { onChange } = {}) {
  state.root = path.join(userDataPath, 'private-network');
  if (onChange) state.onChange = onChange;
  loadConfig();
}

function emit() {
  try {
    state.onChange(getState());
  } catch {
    /* fenêtre fermée */
  }
}

// Vue pour l'interface : jamais la configuration WireGuard elle-même.
export function getState() {
  const key = enginePlatformKey(process.platform, process.arch);
  const vpn = state.config.vpn;
  return {
    platformSupported: Boolean(key && ENGINES.tor.files[platformFileKey(key)]),
    tor: {
      installed: isInstalled('tor'),
      version: ENGINES.tor.version,
      torVersion: ENGINES.tor.torVersion,
      status: state.tor.status,
      progress: state.tor.progress,
      summary: state.tor.summary,
      error: state.tor.error,
      bridges: state.config.torBridges,
      customBridges: state.config.customBridges,
      install: state.install.tor,
    },
    vpn: {
      installed: isInstalled('wireproxy'),
      version: ENGINES.wireproxy.version,
      status: state.vpn.status,
      error: state.vpn.error,
      configured: Boolean(vpn),
      name: vpn?.name || '',
      provider: vpn?.provider || '',
      summary: vpn?.summary || null,
      install: state.install.wireproxy,
    },
    autoStart: state.config.autoStart,
    warnings: state.config.warnings,
  };
}

export function warningsEnabled() {
  return state.config.warnings !== false;
}

export function setWarnings(on) {
  state.config.warnings = Boolean(on);
  saveConfig();
  emit();
  return { success: true };
}

// Ports des moteurs PRÊTS (sinon absents : règle « fail-closed »).
export function getPorts() {
  return {
    tor: state.tor.status === 'ready' ? state.tor.port : 0,
    vpn: state.vpn.status === 'ready' ? state.vpn.port : 0,
  };
}

export function resolveRule(rule) {
  return resolveNetworkRule(rule, getPorts());
}

// --- Installation des moteurs ------------------------------------------------

// Windows ARM : pas d'archive dédiée, la version x86_64 tourne en émulation.
function platformFileKey(key) {
  return key === 'windows-aarch64' ? 'windows-x86_64' : key;
}

function engineSpec(name) {
  const key = platformFileKey(enginePlatformKey(process.platform, process.arch) || '');
  const engine = ENGINES[name];
  const file = engine?.files?.[key];
  if (!file) throw new Error(`Pas de version de ${name} pour ${process.platform}/${process.arch}.`);
  return { version: engine.version, ...file };
}

const engineDir = (name) => path.join(state.root, 'engines', `${name}-${ENGINES[name].version}`);
const isInstalled = (name) => fs.existsSync(path.join(engineDir(name), '.verified'));

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('trop de redirections'));
    const req = https.get(url, { headers: { 'User-Agent': 'Orbit' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).href, dest, onProgress, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`le serveur a répondu ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      const hash = crypto.createHash('sha256');
      const file = fs.createWriteStream(dest);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        onProgress?.(received, total);
      });
      res.pipe(file);
      res.on('error', reject);
      file.on('error', reject);
      file.on('finish', () => file.close(() => resolve(hash.digest('hex'))));
    });
    req.setTimeout(60000, () => req.destroy(new Error('délai réseau dépassé')));
    req.on('error', reject);
  });
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: opts.timeout || 120000, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') })
    );
  });
}

export async function installEngine(name) {
  if (!['tor', 'wireproxy'].includes(name)) return { success: false, error: 'moteur inconnu' };
  if (isInstalled(name)) return { success: true };
  if (state.install[name]?.busy) return { success: false, error: 'installation déjà en cours' };
  let spec;
  try {
    spec = engineSpec(name);
  } catch (err) {
    return { success: false, error: err.message };
  }
  const dir = engineDir(name);
  const tmp = path.join(state.root, 'engines', `.${name}-${Date.now()}.tar.gz`);
  state.install[name] = { busy: true, received: 0, total: 0 };
  emit();
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    let last = 0;
    const sha = await download(spec.url, tmp, (received, total) => {
      state.install[name] = { busy: true, received, total };
      if (Date.now() - last > 250) {
        last = Date.now();
        emit();
      }
    });
    // L'archive reçue doit être EXACTEMENT celle qui a été vérifiée : sinon
    // elle est effacée, jamais extraite ni exécutée.
    if (sha !== spec.sha256) throw new Error('Empreinte du fichier téléchargé incorrecte : téléchargement rejeté.');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const res = await run('tar', ['-xzf', tmp, '-C', dir]);
    if (!res.ok) throw new Error(`extraction impossible : ${res.stderr.slice(0, 200)}`);
    if (!WINDOWS) {
      for (const bin of [torBinary(), wireproxyBinary()].filter((b) => b && b.startsWith(dir) && fs.existsSync(b))) fs.chmodSync(bin, 0o755);
    }
    if (!fs.existsSync(name === 'tor' ? torBinary() : wireproxyBinary())) throw new Error('exécutable introuvable dans l’archive');
    fs.writeFileSync(path.join(dir, '.verified'), `${spec.sha256}\n`);
    // Anciennes versions : supprimées (un Tor trop vieux est refusé par le réseau).
    for (const entry of fs.readdirSync(path.join(state.root, 'engines'))) {
      if (entry.startsWith(`${name}-`) && entry !== path.basename(dir)) fs.rmSync(path.join(state.root, 'engines', entry), { recursive: true, force: true });
    }
    state.install[name] = null;
    emit();
    return { success: true };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    state.install[name] = { busy: false, error: err.message };
    emit();
    return { success: false, error: err.message };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const torDir = () => path.join(engineDir('tor'), 'tor');
const torBinary = () => path.join(torDir(), WINDOWS ? 'tor.exe' : 'tor');
const wireproxyBinary = () => path.join(engineDir('wireproxy'), WINDOWS ? 'wireproxy.exe' : 'wireproxy');

// --- Utilitaires réseau -------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = netmod.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = netmod.connect({ host: '127.0.0.1', port }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });
}

function pushLog(target, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    target.log.push(line.slice(0, 300));
    if (target.log.length > 60) target.log.shift();
  }
}

// --- Tor ------------------------------------------------------------------------

function bridgeLinesFor(pt) {
  const mode = state.config.torBridges;
  if (mode === 'none') return [];
  if (mode === 'custom') return parseBridgeLines(state.config.customBridges).map((b) => b.line);
  return pt.bridges[mode] || [];
}

export async function startTor({ byUser = false } = {}) {
  if (byUser) pausedByUser.tor = false;
  if (state.tor.proc) return { success: true };
  if (!isInstalled('tor')) {
    const inst = await installEngine('tor');
    if (!inst.success) return inst;
  }
  const work = path.join(state.root, 'tor');
  const dataDir = path.join(work, 'data');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dataDir, 0o700); // Tor refuse un dossier de données lisible par d'autres
  } catch {
    /* Windows */
  }
  let pt = { plugins: [], bridges: {} };
  try {
    const ptDir = path.join(torDir(), 'pluggable_transports');
    pt = readPtConfig(JSON.parse(fs.readFileSync(path.join(ptDir, 'pt_config.json'), 'utf8')), ptDir, path.sep);
  } catch {
    /* archive sans transports : ponts personnalisés « vanilla » seulement */
  }
  const bridges = bridgeLinesFor(pt);
  if (state.config.torBridges !== 'none' && bridges.length === 0) {
    return { success: false, error: 'Aucun pont utilisable : collez des lignes de pont valides ou choisissez Snowflake.' };
  }
  const [socksPort, controlPort] = [await freePort(), await freePort()];
  const dataRoot = path.join(engineDir('tor'), 'data');
  const torrc = buildTorrc({
    socksPort,
    controlPort,
    dataDir,
    geoip: fs.existsSync(path.join(dataRoot, 'geoip')) ? path.join(dataRoot, 'geoip') : '',
    geoip6: fs.existsSync(path.join(dataRoot, 'geoip6')) ? path.join(dataRoot, 'geoip6') : '',
    bridges,
    plugins: bridges.length ? pt.plugins : [],
    ownerPid: process.pid,
  });
  const torrcPath = path.join(work, 'torrc');
  fs.writeFileSync(torrcPath, torrc, { mode: 0o600 });

  Object.assign(state.tor, { status: 'starting', progress: 0, summary: 'Démarrage…', error: '', port: socksPort, controlPort, log: [] });
  emit();
  const env = { ...process.env };
  // Bibliothèques livrées à côté de tor (libevent, OpenSSL).
  if (process.platform === 'linux') env.LD_LIBRARY_PATH = [torDir(), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  const proc = spawn(torBinary(), ['-f', torrcPath], { cwd: torDir(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.tor.proc = proc;
  const onData = (chunk) => {
    pushLog(state.tor, chunk);
    for (const line of String(chunk).split(/\r?\n/)) {
      const b = parseBootstrap(line);
      if (b) {
        state.tor.progress = b.percent;
        state.tor.summary = b.summary;
        if (b.percent >= 100) state.tor.status = 'ready';
        emit();
      } else if (/\[err\]|\[warn\].*(Problem bootstrapping|Could not)/i.test(line)) {
        state.tor.summary = line.replace(/^.*\[(?:err|warn)\]\s*/, '').slice(0, 160);
        emit();
      }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (err) => {
    state.tor.error = err.message;
  });
  proc.on('exit', (code) => {
    const wasReady = state.tor.status === 'ready';
    state.tor.proc = null;
    state.tor.status = state.tor.stopping ? 'off' : 'error';
    if (!state.tor.stopping) state.tor.error = state.tor.error || `Tor s’est arrêté (code ${code}). ${state.tor.log.slice(-2).join(' ')}`.trim();
    state.tor.stopping = false;
    state.tor.progress = 0;
    emit();
    if (wasReady) state.onPorts?.();
  });
  // Attente de l'amorçage (jusqu'à 2 min : réseau lent ou ponts).
  const ready = await new Promise((resolve) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (state.tor.status === 'ready') {
        clearInterval(tick);
        resolve(true);
      } else if (!state.tor.proc || Date.now() - t0 > 120000) {
        clearInterval(tick);
        resolve(false);
      }
    }, 300);
  });
  if (!ready) {
    if (state.tor.proc) {
      state.tor.error = `Tor n’a pas pu se connecter au réseau (${state.tor.progress} %). Essayez un pont (Snowflake).`;
      stopTor();
    }
    return { success: false, error: state.tor.error };
  }
  state.onPorts?.();
  return { success: true };
}

// `byUser` : arrêt demandé par l'utilisateur → la connexion automatique ne
// relance PAS le moteur (sinon « Arrêter » ne tiendrait pas une seconde quand
// une app réglée sur Tor est ouverte). Un démarrage manuel lève la pause.
const pausedByUser = { tor: false, vpn: false };

function waitExit(proc) {
  return new Promise((resolve) => {
    if (!proc) return resolve();
    proc.once('exit', resolve);
    setTimeout(resolve, 4000);
  });
}

export function stopTor({ byUser = false } = {}) {
  if (byUser) pausedByUser.tor = true;
  if (!state.tor.proc) return { success: true };
  state.tor.stopping = true;
  state.tor.proc.kill();
  return { success: true };
}

// Nouvelle identité : nouveaux circuits pour les connexions suivantes.
export async function newIdentity() {
  if (state.tor.status !== 'ready') return { success: false, error: 'Tor n’est pas connecté.' };
  const cookie = fs.readFileSync(path.join(state.root, 'tor', 'data', 'control_auth_cookie')).toString('hex');
  const reply = await new Promise((resolve) => {
    let buf = '';
    const s = netmod.connect({ host: '127.0.0.1', port: state.tor.controlPort }, () => {
      s.write(`AUTHENTICATE ${cookie}\r\nSIGNAL NEWNYM\r\nQUIT\r\n`);
    });
    s.on('data', (d) => (buf += d));
    s.on('close', () => resolve(buf));
    s.on('error', () => resolve(buf));
    s.setTimeout(5000, () => s.destroy());
  });
  const ok = (reply.match(/^250 /gm) || []).length >= 2;
  return ok ? { success: true } : { success: false, error: 'Tor a refusé la demande.' };
}

export async function setTorBridges({ mode, custom } = {}) {
  const before = `${state.config.torBridges}\n${state.config.customBridges}`;
  if (['none', 'snowflake', 'obfs4', 'meek', 'custom'].includes(mode)) state.config.torBridges = mode;
  if (typeof custom === 'string') state.config.customBridges = custom.slice(0, 20000);
  saveConfig();
  emit();
  const valid = parseBridgeLines(state.config.customBridges).length;
  // Tor connecté : on se reconnecte tout de suite avec les nouveaux ponts.
  if (state.tor.proc && before !== `${state.config.torBridges}\n${state.config.customBridges}`) {
    const proc = state.tor.proc;
    stopTor();
    await waitExit(proc);
    startTor().catch(() => {});
  }
  return { success: true, valid };
}

// --- VPN (WireGuard via wireproxy) -------------------------------------------

export async function importVpn({ text, name } = {}) {
  const parsed = parseWireguardConf(text);
  if (!parsed.ok) return { success: false, error: parsed.error };
  if (!(await secureStore.isAvailable())) {
    // La configuration contient une clé privée : pas d'écriture en clair.
    return { success: false, error: 'Le trousseau du système est indisponible : la clé privée ne peut pas être protégée.' };
  }
  const wasRunning = Boolean(state.vpn.proc);
  if (wasRunning) await stopVpnAndWait();
  state.config.vpn = {
    enc: await secureStore.encryptToBase64(String(text)),
    name: String(name || '').replace(/\.conf$/i, '').slice(0, 60) || 'WireGuard',
    provider: guessVpnProvider(parsed.summary.endpoint),
    summary: parsed.summary,
    importedAt: Date.now(),
  };
  saveConfig();
  emit();
  if (wasRunning) await startVpn();
  return { success: true, warnings: parsed.warnings };
}

export async function removeVpn() {
  await stopVpnAndWait();
  state.config.vpn = null;
  saveConfig();
  emit();
  return { success: true };
}

export async function startVpn({ byUser = false } = {}) {
  if (byUser) pausedByUser.vpn = false;
  if (state.vpn.proc) return { success: true };
  if (!state.config.vpn) return { success: false, error: 'Importez d’abord une configuration WireGuard.' };
  if (!isInstalled('wireproxy')) {
    const inst = await installEngine('wireproxy');
    if (!inst.success) return inst;
  }
  const runDir = path.join(state.root, 'vpn');
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const wgPath = path.join(runDir, 'wg.conf');
  const cfgPath = path.join(runDir, 'wireproxy.conf');
  const port = await freePort();
  // Configuration en clair le temps du démarrage seulement (wireproxy la lit
  // une fois), puis effacée.
  fs.writeFileSync(wgPath, await secureStore.decryptFromBase64(state.config.vpn.enc), { mode: 0o600 });
  fs.writeFileSync(cfgPath, buildWireproxyConfig({ wgConfPath: wgPath, socksPort: port }), { mode: 0o600 });
  Object.assign(state.vpn, { status: 'starting', port, error: '', log: [] });
  emit();
  const proc = spawn(wireproxyBinary(), ['-c', cfgPath], { cwd: runDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.vpn.proc = proc;
  proc.stdout.on('data', (c) => pushLog(state.vpn, c));
  proc.stderr.on('data', (c) => pushLog(state.vpn, c));
  proc.on('error', (err) => {
    state.vpn.error = err.message;
  });
  proc.on('exit', (code) => {
    const wasReady = state.vpn.status === 'ready';
    state.vpn.proc = null;
    state.vpn.status = state.vpn.stopping ? 'off' : 'error';
    if (!state.vpn.stopping) state.vpn.error = state.vpn.error || `Le VPN s’est arrêté (code ${code}). ${state.vpn.log.slice(-2).join(' ')}`.trim();
    state.vpn.stopping = false;
    emit();
    if (wasReady) state.onPorts?.();
  });
  let open = false;
  for (let i = 0; i < 40 && state.vpn.proc && !open; i++) {
    await new Promise((r) => setTimeout(r, 250));
    open = await portOpen(port);
  }
  for (const f of [wgPath, cfgPath]) fs.rmSync(f, { force: true });
  if (!open) {
    if (state.vpn.proc) stopVpn();
    state.vpn.error = state.vpn.error || 'Le VPN n’a pas démarré.';
    return { success: false, error: state.vpn.error };
  }
  state.vpn.status = 'ready';
  emit();
  state.onPorts?.();
  return { success: true };
}

export function stopVpn({ byUser = false } = {}) {
  if (byUser) pausedByUser.vpn = true;
  if (!state.vpn.proc) return { success: true };
  state.vpn.stopping = true;
  state.vpn.proc.kill();
  return { success: true };
}

function stopVpnAndWait() {
  const proc = state.vpn.proc;
  stopVpn();
  return waitExit(proc);
}

export function setAutoStart(on) {
  state.config.autoStart = Boolean(on);
  saveConfig();
  emit();
  return { success: true };
}

export function onPortsChange(fn) {
  state.onPorts = fn;
}

// Un moteur est demandé par une règle : on le démarre si l'utilisateur l'a
// permis (« démarrer à la demande »).
export function ensure(network) {
  if (!state.config.autoStart || pausedByUser[network]) return;
  if (network === 'tor' && !state.tor.proc && isInstalled('tor')) startTor().catch(() => {});
  if (network === 'vpn' && !state.vpn.proc && state.config.vpn && isInstalled('wireproxy')) startVpn().catch(() => {});
}

// Vérification : adresse vue par Internet À TRAVERS le moteur, demandée au
// Tor Project (qui dit aussi si la connexion sort bien par Tor).
export async function check(network) {
  const rule = network === 'tor' ? NETWORK_RULES.tor : NETWORK_RULES.vpn;
  const ses = session.fromPartition(`orbit-netcheck-${network}`);
  await ses.setProxy({ proxyRules: resolveRule(rule) });
  await ses.closeAllConnections();
  try {
    const res = await ses.fetch(CHECK_URL, { cache: 'no-store' });
    const info = parseTorCheck(await res.json());
    if (!info) return { success: false, error: 'Réponse inattendue.' };
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: `Aucune connexion par ce moteur (${err.message}).` };
  }
}

export function stopAll() {
  stopTor();
  stopVpn();
}
