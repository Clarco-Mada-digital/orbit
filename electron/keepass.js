// ---------------------------------------------------------------------------
// Pont natif Orbit ↔ KeePassXC
//
// Implémente le protocole keepassxc-browser (celui de l'extension Chrome) :
//   - Les messages transitent par le SOCKET LOCAL de KeePassXC (2.7+)
//     — le serveur HTTP sur 127.0.0.1:19455 a été retiré dans KeePassXC 2.7.
//     Linux : $XDG_RUNTIME_DIR/app/org.keepassxc.KeePassXC/…BrowserServer
//     Windows : \\.\pipe\org.keepassxc.KeePassXC.BrowserServer_<USER>
//     macOS : $TMPDIR/org.keepassxc.KeePassXC.BrowserServer
//   - C'est exactement le chemin qu'emprunte keepassxc-proxy, mais sans
//     sous-processus : on se connecte directement au socket (JSON brut).
//   - Chiffrement NaCl box (tweetnacl) : chaque échange est chiffré avec la
//     clé publique du host (KeePassXC) + la clé secrète de session du client.
//   - change-public-keys → échange des clés publiques (session)
//   - associate → associe Orbit à une base (approbation dans KeePassXC)
//   - test-associate / get-logins → vérifie et récupère les identifiants
//
// Trois paires de clés (comme l'extension) :
//   - clés de session : régénérées à chaque lancement d'Orbit
//   - clé d'identification : permanente, persistée — c'est elle qui prouve
//     qu'Orbit est bien le client associé à la base (test-associate, get-logins)
//
// L'association et la clé d'identification sont persistées dans
// <userData>/keepass.json (la clé secrète ne quitte jamais le main process).
// ---------------------------------------------------------------------------
import { safeStorage } from 'electron';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';
import net from 'net';
import os from 'os';
import { buildImportRows, entriesWithoutUrl, chooseScanUrls } from './keepass-import.js';

// Conversions via Buffer (nacl.util n'est plus fourni par tweetnacl récent)
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (str) => new Uint8Array(Buffer.from(str, 'base64'));
const utf8 = (bytes) => Buffer.from(bytes).toString('utf8');

const state = {
  configFile: null,
  // { clientId, idKey: { publicKey, secretKey }, associations: [{ id, key }] }
  config: null,
  // Clés de SESSION (neuves à chaque lancement) — comme l'extension
  sessionKeys: null,
  // Clé publique de KeePassXC reçue via change-public-keys
  hostPublicKey: null,
  // Auto-remplissage activé (synchro depuis les réglages)
  enabled: true,
  // L'association a-t-elle été revalidée depuis le dernier échange de clés ?
  // KeePassXC réinitialise l'état « associé » du client à chaque
  // change-public-keys : il faut un test-associate pour le rétablir, sinon
  // get-logins ne retourne rien (0 entrées) sans erreur visible.
  sessionValidated: false,
};

// ---------------------------------------------------------------------------
// Socket local KeePassXC (2.7+)
// ---------------------------------------------------------------------------
function localServerPath() {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\org.keepassxc.KeePassXC.BrowserServer_' + (process.env.USERNAME || '');
  }
  if (process.platform === 'darwin') {
    return path.join(os.tmpdir(), 'org.keepassxc.KeePassXC.BrowserServer');
  }
  // Linux : socket sous XDG_RUNTIME_DIR (avec symlink legacy au cas où)
  const runtime =
    process.env.XDG_RUNTIME_DIR || path.join('/run/user', String(process.getuid ? process.getuid() : ''));
  const candidates = [
    path.join(runtime, 'app', 'org.keepassxc.KeePassXC', 'org.keepassxc.KeePassXC.BrowserServer'),
    path.join(runtime, 'org.keepassxc.KeePassXC.BrowserServer'),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      return c;
    } catch {
      /* on essaie le suivant */
    }
  }
  return candidates[0]; // → erreur ENOENT propre si KeePassXC ne tourne pas
}

// ---------------------------------------------------------------------------
// Config persistée
// ---------------------------------------------------------------------------
// Le fichier contient la clé secrète d'IDENTIFICATION : on le CHIFFRE au repos
// via le trousseau de l'OS (safeStorage) quand c'est disponible. L'ancien
// fichier en clair reste lisible (migration transparente : réécrit chiffré).
function loadConfig(file) {
  try {
    const buf = fs.readFileSync(file);
    try {
      return JSON.parse(buf.toString('utf8')); // ancien format en clair
    } catch {
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      throw new Error('config illisible');
    }
  } catch {
    return { clientId: null, idKey: null, associations: [] };
  }
}

function saveConfig() {
  if (!state.configFile) return;
  try {
    const json = JSON.stringify(state.config, null, 2);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(state.configFile, safeStorage.encryptString(json));
    } else {
      fs.writeFileSync(state.configFile, json);
    }
  } catch (err) {
    console.error('[keepass] sauvegarde config échouée:', err.message);
  }
}

export function init(userDataPath) {
  state.configFile = path.join(userDataPath, 'keepass.json');
  state.config = loadConfig(state.configFile);

  // Clés de session : neuves à chaque lancement d'Orbit
  state.sessionKeys = nacl.box.keyPair();

  // clientID : identifiant stable de ce client (24 octets)
  if (!state.config.clientId) {
    state.config.clientId = b64(nacl.randomBytes(nacl.box.nonceLength));
    saveConfig();
  }

  // Clé d'identification : permanente (générée une seule fois)
  if (!state.config.idKey?.publicKey || !state.config.idKey?.secretKey) {
    const kp = nacl.box.keyPair();
    state.config.idKey = { publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
    saveConfig();
  }
  if (!Array.isArray(state.config.associations)) {
    state.config.associations = [];
    saveConfig();
  }
}

export function setEnabled(enabled) {
  state.enabled = !!enabled;
}

export function isEnabled() {
  return state.enabled;
}

// ---------------------------------------------------------------------------
// Transport : JSON brut sur le socket local
// ---------------------------------------------------------------------------
function request(data, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(localServerPath());
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(Object.assign(new Error('KeePassXC ne répond pas (timeout)'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (!socket.destroyed) socket.destroy();
    };

    socket.on('connect', () => {
      socket.write(JSON.stringify(data));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (settled) return;
      try {
        const parsed = JSON.parse(buffer);
        settled = true;
        cleanup();
        resolve(parsed);
      } catch {
        /* JSON pas encore complet — on attend la suite */
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    socket.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Connexion à KeePassXC fermée'));
      }
    });
  });
}

// Messages d'erreur lisibles selon le type d'échec
function friendlyError(err) {
  const code = err && err.code;
  if (code === 'ENOENT' || code === 'ECONNREFUSED') {
    return new Error(
      "KeePassXC ne tourne pas (ou l'intégration navigateur est désactivée dans ses paramètres)"
    );
  }
  if (code === 'ETIMEDOUT') return new Error('KeePassXC ne répond pas (timeout)');
  if (code === 'ECONNRESET') return new Error('Connexion à KeePassXC interrompue');
  return err;
}

// Requête avec erreurs lisibles
async function requestSafe(data, timeoutMs) {
  try {
    return await request(data, timeoutMs);
  } catch (err) {
    throw friendlyError(err);
  }
}

// ---------------------------------------------------------------------------
// Chiffrement NaCl box
// ---------------------------------------------------------------------------
function encrypt(obj) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const sealed = nacl.box(
    Buffer.from(JSON.stringify(obj), 'utf8'),
    nonce,
    state.hostPublicKey,
    state.sessionKeys.secretKey
  );
  return { nonce: b64(nonce), message: b64(sealed) };
}

function decrypt(messageB64, nonceB64) {
  const opened = nacl.box.open(
    unb64(messageB64),
    unb64(nonceB64),
    state.hostPublicKey,
    state.sessionKeys.secretKey
  );
  if (!opened) {
    throw new Error("Impossible de déchiffrer la réponse de KeePassXC (clés désynchronisées ?)");
  }
  return JSON.parse(utf8(opened));
}

const isTrue = (v) => v === 'true' || v === true;

// « No logins found » (ou sa traduction) = pas d'entrée pour ce site, ce n'est
// pas une erreur : on le présente comme un succès à 0 entrée (le preload
// affiche alors le message « Aucun identifiant pour ce site »).
const isNoLoginsError = (msg) =>
  /no logins? found/i.test(String(msg || '')) || /aucun identifiant/i.test(String(msg || ''));

// ---------------------------------------------------------------------------
// Actions du protocole
// ---------------------------------------------------------------------------

// Échange des clés publiques : prouve que KeePassXC tourne et que
// l'intégration navigateur est activée dans ses paramètres.
export async function changePublicKeys() {
  const res = await requestSafe({
    action: 'change-public-keys',
    publicKey: b64(state.sessionKeys.publicKey),
    nonce: b64(nacl.randomBytes(nacl.box.nonceLength)),
    clientID: state.config.clientId,
  });
  if (!res) throw new Error('Pas de réponse de KeePassXC');
  if (res.error) throw new Error(res.error);
  if (!isTrue(res.success) || !res.publicKey) {
    throw new Error("KeePassXC a refusé l'échange de clés");
  }
  state.hostPublicKey = unb64(res.publicKey);
  // Nouvelle session côté KeePassXC → l'association doit être revalidée
  state.sessionValidated = false;
  return true;
}

// Cœur de test-associate : vérifie qu'une association est toujours reconnue
// par la base ET rétablit l'état « associé » du client chez KeePassXC
// (m_associated) — indispensable avant get-logins.
async function testAssociateCore(assoc) {
  const sealed = encrypt({
    action: 'test-associate',
    id: assoc.id,
    key: assoc.key,
  });
  const res = await requestSafe({
    action: 'test-associate',
    message: sealed.message,
    nonce: sealed.nonce,
    clientID: state.config.clientId,
  });
  if (!res) throw new Error('Pas de réponse de KeePassXC');
  if (res.error) throw new Error(res.error);
  const data = decrypt(res.message, res.nonce);
  if (!isTrue(data.success)) {
    throw new Error('Association non reconnue par KeePassXC');
  }
  return data;
}

// Revalide l'association (silencieux, aucun dialog) après un échange de clés.
// Essaie chaque association persistée jusqu'à en trouver une valide.
async function ensureValidated() {
  if (state.sessionValidated) return;
  const assocs = state.config.associations || [];
  let lastErr = null;
  for (const assoc of assocs) {
    try {
      await testAssociateCore(assoc);
      state.sessionValidated = true;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Aucune association valide');
}

// Association : demande l'approbation dans KeePassXC (dialog « Allow ? »).
// Le timeout est long : la réponse n'arrive qu'après le clic de l'utilisateur.
export async function associate() {
  if (!state.hostPublicKey) await changePublicKeys();

  const sealed = encrypt({
    action: 'associate',
    key: b64(state.sessionKeys.publicKey),
    idKey: b64(state.config.idKey.publicKey),
  });
  const res = await requestSafe(
    {
      action: 'associate',
      message: sealed.message,
      nonce: sealed.nonce,
      clientID: state.config.clientId,
    },
    120000
  );
  if (!res) throw new Error('Pas de réponse de KeePassXC');
  if (res.error) throw new Error(res.error);

  const data = decrypt(res.message, res.nonce);
  if (!isTrue(data.success) || !data.id) {
    throw new Error('Association refusée par KeePassXC');
  }

  // Associe (ou remplace) cette base : { id, clé publique d'identification }
  const assoc = { id: data.id, key: b64(state.config.idKey.publicKey) };
  state.config.associations = [
    ...(state.config.associations || []).filter((a) => a.id !== data.id),
    assoc,
  ];
  saveConfig();

  state.sessionValidated = true;
  return { success: true, id: data.id, hash: data.hash, version: data.version };
}

// Vérifie que l'association est toujours valide (test-associate)
export async function testAssociate() {
  const assocs = state.config.associations || [];
  if (assocs.length === 0) return { success: false, error: 'not-associated' };
  if (!state.hostPublicKey) await changePublicKeys();

  try {
    const data = await testAssociateCore(assocs[0]);
    state.sessionValidated = true;
    return { success: true, id: data.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Récupère les identifiants pour une URL (appelé par le preload des webviews)
export async function getLogins(url) {
  // `enabled` reflète le réglage « source des identifiants » : il gouverne
  // l'AUTO-REMPLISSAGE des pages, pas le rapatriement manuel de la base, qui
  // passe par fetchLogins (voir collectAllCredentials).
  if (!state.enabled) return { success: false, error: 'disabled' };
  return fetchLogins(url);
}

async function fetchLogins(url) {
  const assocs = state.config.associations || [];
  if (assocs.length === 0) return { success: false, error: 'not-associated' };

  const run = async (targetUrl) => {
    if (!state.hostPublicKey) {
      await changePublicKeys();
    }
    // CRUCIAL : après un échange de clés, KeePassXC ne considère plus ce
    // client comme « associé » → revalidation silencieuse (test-associate)
    // avant chaque get-logins si nécessaire.
    await ensureValidated();
    const sealed = encrypt({
      action: 'get-logins',
      url: String(targetUrl || ''),
      keys: assocs,
    });
    const res = await requestSafe({
      action: 'get-logins',
      message: sealed.message,
      nonce: sealed.nonce,
      clientID: state.config.clientId,
    });
    if (!res) throw new Error('Pas de réponse de KeePassXC');
    if (res.error) {
      if (isNoLoginsError(res.error)) return { success: true, count: 0, entries: [] };
      return { success: false, error: res.error };
    }
    const data = decrypt(res.message, res.nonce);
    // Erreur renvoyée chiffrée (ex. « No logins found ») — ne pas la
    // confondre avec un succès à 0 entrée.
    if (data && data.error) {
      if (isNoLoginsError(data.error)) return { success: true, count: 0, entries: [] };
      return { success: false, error: data.error };
    }
    return data;
  };

  let data;
  try {
    data = await run(url);
  } catch (err) {
    // KeePassXC a peut-être été redémarré (nouvelles clés de session) :
    // on rééchange les clés publiques et on réessaie une fois.
    state.hostPublicKey = null;
    try {
      data = await run(url);
    } catch {
      throw err;
    }
  }

  // Beaucoup d'entrées sont enregistrées en http:// alors que le site est en
  // https:// — KeePassXC compare le schéma par défaut. On réessaie avec
  // l'autre schéma si rien n'a été trouvé (coût : une requête de plus).
  if (data.success && (!data.entries || data.entries.length === 0)) {
    const alt =
      String(url).startsWith('https://')
        ? String(url).replace(/^https:\/\//, 'http://')
        : String(url).replace(/^http:\/\//, 'https://');
    if (alt !== String(url)) {
      try {
        const altData = await run(alt);
        if (altData.success && altData.entries && altData.entries.length > 0) {
          data = altData;
        }
      } catch {
        /* on garde le résultat initial */
      }
    }
  }

  const entries = (data.entries || []).map((e) => ({
    login: e.login || '',
    password: e.password || '',
    name: e.name || e.login || '',
  }));
  return { success: true, count: entries.length, entries };
}

// ---------------------------------------------------------------------------
// Rapatriement de toute la base vers un trousseau Orbit
// ---------------------------------------------------------------------------
// `get-database-entries` ne rend que titre + URL + UUID (jamais les mots de
// passe), et uniquement si l'utilisateur a coché, dans KeePassXC → Paramètres →
// Intégration navigateur → Avancé : « Allow limited access to all entries in
// connected databases ». Sans ce réglage, KeePassXC répond
// ERROR_KEEPASS_ACCESS_TO_ALL_ENTRIES_DENIED — on le traduit en code lisible
// pour que l'interface puisse dire quoi cocher au lieu d'afficher un sigle.
const isAllEntriesDeniedError = (msg) =>
  /access to all entries/i.test(String(msg || '')) || /denied/i.test(String(msg || ''));

// Quand la base est VERROUILLÉE (ou vide), KeePassXC ne rend pas d'erreur
// d'autorisation : il rend une liste vide, qu'il signale par
// ERROR_KEEPASS_NO_GROUPS_FOUND. Le confondre avec un refus d'accès enverrait
// l'utilisateur modifier un réglage déjà correct au lieu de déverrouiller sa
// base.
const isEmptyDatabaseError = (msg) => /no groups found/i.test(String(msg || ''));

// KeePassXC répond « Incorrect action » (traduit, d'où le test sur les deux
// langues) quand l'action lui est inconnue : `get-database-entries` n'existe
// que depuis la 2.8. Sur 2.7.x — la version encore la plus répandue — il faut
// donc passer par le repli, pas afficher un sigle incompréhensible.
const isUnknownActionError = (msg) =>
  /incorrect action/i.test(String(msg || '')) || /action incorrecte/i.test(String(msg || ''));

function mapListingError(msg) {
  if (isUnknownActionError(msg)) return 'unsupported-action';
  if (isAllEntriesDeniedError(msg)) return 'all-entries-denied';
  if (isEmptyDatabaseError(msg)) return 'database-locked-or-empty';
  return String(msg);
}

export async function getDatabaseEntries() {
  const assocs = state.config.associations || [];
  if (assocs.length === 0) return { success: false, error: 'not-associated' };

  const run = async () => {
    if (!state.hostPublicKey) await changePublicKeys();
    await ensureValidated();
    const sealed = encrypt({ action: 'get-database-entries' });
    const res = await requestSafe({
      action: 'get-database-entries',
      message: sealed.message,
      nonce: sealed.nonce,
      clientID: state.config.clientId,
    });
    if (!res) throw new Error('Pas de réponse de KeePassXC');
    if (res.error) return { success: false, error: mapListingError(res.error) };
    const data = decrypt(res.message, res.nonce);
    if (data && data.error) return { success: false, error: mapListingError(data.error) };
    return {
      success: true,
      entries: (data.entries || []).map((e) => ({
        uuid: e.uuid || '',
        title: e.title || e.name || '',
        url: e.url || '',
      })),
    };
  };

  try {
    return await run();
  } catch (err) {
    // KeePassXC a peut-être redémarré (clés de session périmées) : on rééchange
    // les clés publiques et on réessaie une fois, comme pour get-logins.
    state.hostPublicKey = null;
    try {
      return await run();
    } catch {
      throw err;
    }
  }
}

// Parcourt la base et rend des lignes d'import prêtes pour le coffre.
//
// Les requêtes sont SÉQUENTIELLES, volontairement : KeePassXC traite un seul
// message à la fois sur son socket, et chaque URL inconnue peut lui faire
// afficher une demande d'autorisation. Les paralléliser multiplierait les
// dialogues sans rien accélérer. `onProgress` permet d'afficher l'avancement
// plutôt que de laisser l'interface muette pendant une base de 300 entrées.
export async function collectAllCredentials({ fallbackUrls = [], onProgress } = {}) {
  const listing = await getDatabaseEntries();
  // Sur une version sans `get-database-entries`, on interroge les sites des
  // apps d'Orbit plutôt que d'abandonner (voir chooseScanUrls).
  const plan = chooseScanUrls(listing, fallbackUrls);
  if (!plan) return listing;

  const { urls, entries: listed, mode } = plan;
  const loginsByUrl = new Map();
  let failed = 0;
  for (let i = 0; i < urls.length; i += 1) {
    onProgress?.({ done: i, total: urls.length });
    try {
      const res = await fetchLogins(urls[i]);
      if (res.success) loginsByUrl.set(urls[i], res.entries || []);
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  onProgress?.({ done: urls.length, total: urls.length });

  return {
    success: true,
    rows: buildImportRows(listed, loginsByUrl),
    // En mode « apps », la base n'a pas été énumérée : on ne prétend pas
    // savoir combien d'entrées elle contient.
    mode,
    reason: plan.reason || null,
    scanned: listed.length,
    urls: urls.length,
    failed,
    withoutUrl: entriesWithoutUrl(listed),
  };
}

// État complet pour l'interface (Paramètres → KeePassXC)
export async function checkStatus() {
  const result = {
    enabled: state.enabled,
    associated: (state.config.associations || []).length > 0,
    associationIds: (state.config.associations || []).map((a) => a.id),
  };
  try {
    await changePublicKeys();
    result.kpRunning = true;
  } catch (err) {
    result.kpRunning = false;
    result.error = err.message;
  }
  return result;
}
