// ---------------------------------------------------------------------------
// Coffre-fort de mots de passe intégré à Orbit
//
// Alternative à KeePassXC pour qui n'utilise pas KeePassXC : les identifiants
// vivent dans des TROUSSEAUX chiffrés, chacun avec SON PROPRE mot de passe
// maître (un trousseau « Boulot », un « Perso »… qu'on ouvre indépendamment).
//
// Modèle de sécurité — ce qui est garanti et ce qui ne l'est pas :
//   • Au repos, un trousseau est un blob AES-256-GCM. La clé est dérivée du
//     mot de passe maître par scrypt (N=2^15, ~33 Mo de mémoire) : une attaque
//     par dictionnaire sur le fichier volé coûte cher. Le mot de passe maître
//     n'est JAMAIS écrit sur le disque, sous aucune forme.
//   • GCM authentifie le contenu : un fichier modifié est rejeté, pas
//     silencieusement déchiffré de travers.
//   • Les métadonnées (nom, emoji, couleur du trousseau) restent en CLAIR dans
//     l'en-tête du fichier — il faut bien afficher la liste des trousseaux
//     verrouillés. Ne mettez donc pas de secret dans le nom d'un trousseau.
//   • Une fois déverrouillé, la clé et les entrées vivent en mémoire du
//     processus principal, jamais dans le renderer ni dans une webview. Le
//     verrouillage automatique (inactivité) les efface.
//   • Ce que ça ne protège PAS : un attaquant qui exécute du code sous votre
//     compte pendant qu'un trousseau est ouvert. Aucun gestionnaire de mots de
//     passe ne protège de ça — d'où le verrouillage automatique par défaut.
//
// Le renderer ne reçoit jamais un mot de passe « en passant » : la liste des
// entrées est envoyée SANS les mots de passe, qui ne sortent que sur demande
// explicite (afficher / copier / remplir).
// ---------------------------------------------------------------------------
import { clipboard, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDomain, getHostname } from 'tldts-experimental';

// scrypt : N=32768 → ~33 Mo, environ 100 ms par dérivation sur une machine de
// bureau. Assez lent pour ruiner une attaque hors-ligne, assez rapide pour un
// déverrouillage interactif. maxmem doit être relevé (défaut Node : 32 Mo).
const KDF = { N: 32768, r: 8, p: 1, len: 32, maxmem: 96 * 1024 * 1024 };
const DEFAULT_AUTOLOCK_MINUTES = 15;

let vaultDir = null;
let ignoreFile = null;
let ignoreList = []; // domaines pour lesquels on ne propose plus d'enregistrer

// Trousseaux OUVERTS : id -> { key: Buffer, payload: {entries, categories}, timer }
// Jamais persisté, jamais transmis au renderer.
const open = new Map();

const now = () => Date.now();
const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('hex')}`;

// ---------------------------------------------------------------------------
// Fichiers
// ---------------------------------------------------------------------------
export function init(userDataPath) {
  invalidateVaultCount();
  vaultDir = path.join(userDataPath, 'vaults');
  ignoreFile = path.join(userDataPath, 'vault-ignore.json');
  try {
    fs.mkdirSync(vaultDir, { recursive: true });
  } catch (err) {
    console.error('[vault] création du dossier échouée:', err.message);
  }
  try {
    ignoreList = JSON.parse(fs.readFileSync(ignoreFile, 'utf8'));
    if (!Array.isArray(ignoreList)) ignoreList = [];
  } catch {
    ignoreList = [];
  }
}

function fileFor(id) {
  // `id` est généré par nous (hex), mais on refuse tout de même la traversée.
  if (!/^v_[a-f0-9]+$/.test(String(id || ''))) return null;
  return path.join(vaultDir, `${id}.vault`);
}

function readHeader(id) {
  const file = fileFor(id);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function allHeaders() {
  try {
    return fs
      .readdirSync(vaultDir)
      .filter((f) => f.endsWith('.vault'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(vaultDir, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter((h) => h && h.id)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Chiffrement
// ---------------------------------------------------------------------------
function deriveKey(password, saltHex) {
  return crypto.scryptSync(
    Buffer.from(String(password), 'utf8'),
    Buffer.from(saltHex, 'hex'),
    KDF.len,
    { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: KDF.maxmem }
  );
}

function seal(header, key, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  // Les métadonnées en clair sont liées au chiffré (AAD) : on ne peut pas
  // recoller l'en-tête d'un trousseau sur le contenu d'un autre.
  cipher.setAAD(Buffer.from(`${header.id}|${header.v}`, 'utf8'));
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('base64'),
  };
}

function unseal(header, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'));
  decipher.setAAD(Buffer.from(`${header.id}|${header.v}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(header.tag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(header.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

// En-tête d'un trousseau OUVERT, sans toucher au disque. Chaque écriture
// relisait puis reparsait le fichier juste avant de le réécrire ; sur le chemin
// d'enregistrement d'une entrée c'était deux allers-retours disque pour rien.
function headerOf(id) {
  return open.get(id)?.header || readHeader(id);
}

// Écrit le trousseau sur disque (écriture atomique : fichier temporaire puis
// rename — une coupure de courant ne laisse pas un coffre à moitié écrit).
function persist(header, key, payload) {
  const sealed = seal(header, key, payload);
  const next = { ...header, ...sealed, updatedAt: now() };
  const file = fileFor(header.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(tmp, file);
  // La session garde l'en-tête à jour (iv/tag/data compris) : plus aucune
  // relecture nécessaire tant que le trousseau reste ouvert.
  const session = open.get(header.id);
  if (session) session.header = next;
  return next;
}

// ---------------------------------------------------------------------------
// Verrouillage automatique
// ---------------------------------------------------------------------------
function armAutoLock(id) {
  const session = open.get(id);
  if (!session) return;
  clearTimeout(session.timer);
  const minutes = session.autoLockMinutes;
  if (!minutes) return; // 0 = jamais
  session.timer = setTimeout(() => lock(id), minutes * 60 * 1000);
  session.timer.unref?.();
}

// Toute lecture/écriture repousse le verrouillage : un trousseau qu'on utilise
// ne se ferme pas au milieu du travail.
function touch(id) {
  if (open.has(id)) armAutoLock(id);
}

export function lock(id) {
  const session = open.get(id);
  if (!session) return { success: true };
  clearTimeout(session.timer);
  session.key.fill(0); // efface la clé de la mémoire
  open.delete(id);
  return { success: true };
}

export function lockAll() {
  for (const id of [...open.keys()]) lock(id);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Cycle de vie des trousseaux
// ---------------------------------------------------------------------------
export function list() {
  return allHeaders().map((h) => {
    const session = open.get(h.id);
    return {
      id: h.id,
      name: h.name,
      icon: h.icon || '🔐',
      color: h.color || '#6366f1',
      autoLockMinutes: h.autoLockMinutes ?? DEFAULT_AUTOLOCK_MINUTES,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      unlocked: Boolean(session),
      entryCount: session ? session.payload.entries.length : null,
    };
  });
}

export function create({ name, password, icon, color, autoLockMinutes } = {}) {
  const label = String(name || '').trim();
  if (!label) return { success: false, error: 'name-required' };
  if (String(password || '').length < 8) return { success: false, error: 'weak-master' };

  const header = {
    v: 1,
    id: newId('v'),
    name: label,
    icon: icon || '🔐',
    color: color || '#6366f1',
    autoLockMinutes: autoLockMinutes ?? DEFAULT_AUTOLOCK_MINUTES,
    createdAt: now(),
    kdf: { algo: 'scrypt', salt: crypto.randomBytes(16).toString('hex'), ...KDF },
    cipher: 'aes-256-gcm',
  };
  const key = deriveKey(password, header.kdf.salt);
  const payload = { entries: [], categories: defaultCategories() };
  const saved = persist(header, key, payload);
  invalidateVaultCount();
  open.set(header.id, {
    key,
    payload,
    autoLockMinutes: saved.autoLockMinutes,
    timer: null,
  });
  armAutoLock(header.id);
  return { success: true, id: header.id };
}

function defaultCategories() {
  return [
    { id: 'work', name: 'Boulot', color: '#6366f1' },
    { id: 'personal', name: 'Perso', color: '#10b981' },
    { id: 'finance', name: 'Banque', color: '#f59e0b' },
  ];
}

export function unlock(id, password) {
  if (open.has(id)) {
    touch(id);
    return { success: true };
  }
  const header = readHeader(id);
  if (!header) return { success: false, error: 'not-found' };
  let key;
  try {
    key = deriveKey(password, header.kdf.salt);
    const payload = unseal(header, key);
    open.set(id, {
      key,
      payload,
      header,
      autoLockMinutes: header.autoLockMinutes ?? DEFAULT_AUTOLOCK_MINUTES,
      timer: null,
    });
    armAutoLock(id);
    return { success: true };
  } catch {
    // Échec d'authentification GCM = mauvais mot de passe (ou fichier abîmé).
    // On ne distingue pas les deux : ça ne renseignerait qu'un attaquant.
    if (key) key.fill(0);
    return { success: false, error: 'bad-password' };
  }
}

export function changeMasterPassword(id, current, next) {
  const header = readHeader(id);
  if (!header) return { success: false, error: 'not-found' };
  if (String(next || '').length < 8) return { success: false, error: 'weak-master' };
  let oldKey;
  let payload;
  try {
    oldKey = deriveKey(current, header.kdf.salt);
    payload = unseal(header, oldKey);
  } catch {
    return { success: false, error: 'bad-password' };
  } finally {
    oldKey?.fill(0);
  }
  // Nouveau sel : deux mots de passe successifs ne partagent jamais de clé.
  const nextHeader = {
    ...header,
    kdf: { ...header.kdf, salt: crypto.randomBytes(16).toString('hex') },
  };
  const key = deriveKey(next, nextHeader.kdf.salt);
  persist(nextHeader, key, payload);
  lock(id);
  open.set(id, {
    key,
    payload,
    header: nextHeader,
    autoLockMinutes: nextHeader.autoLockMinutes ?? DEFAULT_AUTOLOCK_MINUTES,
    timer: null,
  });
  armAutoLock(id);
  return { success: true };
}

export function updateVault(id, { name, icon, color, autoLockMinutes } = {}) {
  const header = readHeader(id);
  if (!header) return { success: false, error: 'not-found' };
  const next = { ...header };
  if (typeof name === 'string' && name.trim()) next.name = name.trim();
  if (typeof icon === 'string') next.icon = icon;
  if (typeof color === 'string') next.color = color;
  if (Number.isFinite(autoLockMinutes)) next.autoLockMinutes = Math.max(0, autoLockMinutes);
  // Réécriture de l'en-tête SANS toucher au chiffré : on garde iv/tag/data.
  const file = fileFor(id);
  fs.writeFileSync(file, JSON.stringify({ ...next, updatedAt: now() }), { mode: 0o600 });
  const session = open.get(id);
  if (session) {
    session.autoLockMinutes = next.autoLockMinutes ?? DEFAULT_AUTOLOCK_MINUTES;
    armAutoLock(id);
  }
  return { success: true };
}

// Suppression : exige le mot de passe maître. Sans ça, quiconque passe devant
// l'écran d'Orbit déverrouillé pourrait détruire un trousseau fermé.
export function remove(id, password) {
  const header = readHeader(id);
  if (!header) return { success: false, error: 'not-found' };
  let key;
  try {
    key = deriveKey(password, header.kdf.salt);
    unseal(header, key);
  } catch {
    return { success: false, error: 'bad-password' };
  } finally {
    key?.fill(0);
  }
  lock(id);
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    return { success: false, error: 'delete-failed' };
  }
  invalidateVaultCount();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------
function requireOpen(id) {
  const session = open.get(id);
  if (!session) return null;
  touch(id);
  return session;
}

// Vue « sûre » d'une entrée : tout sauf le mot de passe et le secret TOTP.
// C'est ce que voit le renderer tant qu'il ne demande pas explicitement mieux.
function publicEntry(e) {
  return {
    id: e.id,
    title: e.title,
    url: e.url,
    extraUrls: e.extraUrls || [],
    username: e.username,
    notes: e.notes,
    category: e.category,
    favorite: Boolean(e.favorite),
    hasPassword: Boolean(e.password),
    hasTotp: Boolean(e.totp),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    passwordUpdatedAt: e.passwordUpdatedAt,
    passwordLength: e.password ? e.password.length : 0,
  };
}

export function listEntries(id) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  return {
    success: true,
    entries: session.payload.entries.map(publicEntry),
    categories: session.payload.categories || [],
  };
}

export function saveEntry(id, entry) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  const list = session.payload.entries;
  const idx = entry.id ? list.findIndex((e) => e.id === entry.id) : -1;
  const prev = idx >= 0 ? list[idx] : null;

  const next = {
    id: prev?.id || newId('e'),
    title: String(entry.title || '').trim() || hostLabel(entry.url) || 'Sans titre',
    url: String(entry.url || '').trim(),
    extraUrls: Array.isArray(entry.extraUrls) ? entry.extraUrls.filter(Boolean) : prev?.extraUrls || [],
    username: String(entry.username || ''),
    // Mot de passe absent du payload = « ne pas changer » (le formulaire
    // d'édition ne reçoit jamais le mot de passe existant).
    password: entry.password === undefined ? prev?.password || '' : String(entry.password),
    totp: entry.totp === undefined ? prev?.totp || '' : normalizeTotpSecret(entry.totp),
    notes: String(entry.notes || ''),
    category: entry.category || prev?.category || '',
    favorite: entry.favorite ?? prev?.favorite ?? false,
    createdAt: prev?.createdAt || now(),
    updatedAt: now(),
    passwordUpdatedAt: prev?.passwordUpdatedAt || now(),
    history: prev?.history || [],
  };

  // Historique : on garde les 5 derniers mots de passe remplacés, pour
  // récupérer un compte quand un site refuse le nouveau.
  if (prev && prev.password && next.password && prev.password !== next.password) {
    next.history = [{ password: prev.password, at: prev.passwordUpdatedAt || prev.updatedAt }, ...next.history].slice(0, 5);
    next.passwordUpdatedAt = now();
  }

  if (idx >= 0) list[idx] = next;
  else list.push(next);

  persist(headerOf(id), session.key, session.payload);
  return { success: true, id: next.id };
}

export function deleteEntry(id, entryId) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  const before = session.payload.entries.length;
  session.payload.entries = session.payload.entries.filter((e) => e.id !== entryId);
  if (session.payload.entries.length === before) return { success: false, error: 'not-found' };
  persist(headerOf(id), session.key, session.payload);
  return { success: true };
}

export function setCategories(id, categories) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  session.payload.categories = (categories || []).map((c) => ({
    id: c.id || newId('c'),
    name: String(c.name || '').trim() || 'Sans nom',
    color: c.color || '#6b7280',
  }));
  persist(headerOf(id), session.key, session.payload);
  return { success: true, categories: session.payload.categories };
}

// Révélation explicite d'un secret (bouton « œil » de l'interface).
export function revealSecret(id, entryId, field = 'password') {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  const entry = session.payload.entries.find((e) => e.id === entryId);
  if (!entry) return { success: false, error: 'not-found' };
  if (field === 'totp') return { success: true, value: entry.totp || '' };
  return { success: true, value: entry.password || '' };
}

// Copie côté PROCESSUS PRINCIPAL : le mot de passe ne transite pas par le
// renderer. Le presse-papiers est vidé après 30 s — sauf si l'utilisateur a
// copié autre chose entre-temps (on ne détruit pas son travail).
export function copySecret(id, entryId, field = 'password') {
  const res = revealSecret(id, entryId, field === 'totp' ? 'totp' : 'password');
  if (!res.success) return res;
  const value = field === 'totp' ? totpCode(res.value).code : res.value;
  if (!value) return { success: false, error: 'empty' };
  clipboard.writeText(value);
  const timer = setTimeout(() => {
    if (clipboard.readText() === value) clipboard.clear();
  }, 30000);
  timer.unref?.();
  return { success: true, clearedInSeconds: 30 };
}

// ---------------------------------------------------------------------------
// Correspondance site ↔ entrées
// ---------------------------------------------------------------------------
// On compare le DOMAINE ENREGISTRABLE (example.co.uk, pas www.example.co.uk) :
// une entrée saisie pour « mail.google.com » doit servir sur
// « accounts.google.com ». Comparer l'hôte exact raterait la moitié des cas ;
// comparer le suffixe seul ferait correspondre google.com à evil-google.com.
function domainOf(url) {
  try {
    return getDomain(String(url)) || getHostname(String(url)) || '';
  } catch {
    return '';
  }
}

function hostLabel(url) {
  try {
    return getHostname(String(url)) || '';
  } catch {
    return '';
  }
}

function entryMatches(entry, domain) {
  if (!domain) return false;
  const urls = [entry.url, ...(entry.extraUrls || [])];
  return urls.some((u) => u && domainOf(u) === domain);
}

// Identifiants de TOUS les trousseaux ouverts pour une URL. Les trousseaux
// verrouillés sont comptés (`lockedVaults`) sans être ouverts : la page peut
// alors afficher « déverrouillez votre trousseau » au lieu de « rien trouvé ».
// Chemin CHAUD : appelé à chaque fois qu'un champ de connexion reçoit le focus,
// dans le processus principal. Il ne doit donc toucher au disque en aucun cas —
// il lisait auparavant l'en-tête de chaque trousseau ouvert PUIS reparsait tous
// les fichiers de trousseau pour compter les verrouillés, en synchrone, ce qui
// gelait l'interface le temps des entrées/sorties.
export function findLogins(url) {
  const domain = domainOf(url);
  const entries = [];
  for (const [id, session] of open) {
    touch(id);
    for (const e of session.payload.entries) {
      if (!entryMatches(e, domain)) continue;
      entries.push({
        login: e.username || '',
        password: e.password || '',
        name: e.title || e.username || '',
        source: 'vault',
        vaultId: id,
        vaultName: session.header?.name || '',
        entryId: e.id,
      });
    }
  }
  return {
    success: true,
    entries,
    lockedVaults: Math.max(0, vaultCount() - open.size),
    openVaults: open.size,
  };
}

// Nombre de trousseaux existants, sans ouvrir ni parser les fichiers. Le
// contenu du dossier ne change que lorsque NOUS créons ou supprimons un
// trousseau : le compte est donc mis en cache et invalidé à ces deux moments.
let cachedVaultCount = null;

function vaultCount() {
  if (cachedVaultCount !== null) return cachedVaultCount;
  try {
    cachedVaultCount = fs.readdirSync(vaultDir).filter((f) => f.endsWith('.vault')).length;
  } catch {
    cachedVaultCount = 0;
  }
  return cachedVaultCount;
}

function invalidateVaultCount() {
  cachedVaultCount = null;
}

// Le site a-t-il déjà cet identifiant enregistré (dans un trousseau ouvert) ?
// Sert à ne PAS proposer « enregistrer ce mot de passe » pour un compte connu
// dont le mot de passe n'a pas changé.
export function lookupSaveState(url, login, password) {
  const domain = domainOf(url);
  if (!domain) return { known: false, changed: false };
  for (const [id, session] of open) {
    for (const e of session.payload.entries) {
      if (!entryMatches(e, domain)) continue;
      if ((e.username || '') !== String(login || '')) continue;
      return {
        known: true,
        changed: Boolean(password) && e.password !== password,
        vaultId: id,
        entryId: e.id,
      };
    }
  }
  return { known: false, changed: false };
}

// ---------------------------------------------------------------------------
// Liste « ne plus proposer » (par domaine)
// ---------------------------------------------------------------------------
function saveIgnore() {
  try {
    fs.writeFileSync(ignoreFile, JSON.stringify(ignoreList));
  } catch (err) {
    console.error('[vault] liste ignorée non sauvegardée:', err.message);
  }
}

export function isIgnored(url) {
  const d = domainOf(url);
  return Boolean(d) && ignoreList.includes(d);
}

export function ignoreDomain(url) {
  const d = domainOf(url);
  if (d && !ignoreList.includes(d)) {
    ignoreList.push(d);
    saveIgnore();
  }
  return { success: true, domains: ignoreList };
}

export function unignoreDomain(domain) {
  ignoreList = ignoreList.filter((d) => d !== domain);
  saveIgnore();
  return { success: true, domains: ignoreList };
}

export function ignoredDomains() {
  return ignoreList;
}

// --- Générateur de mots de passe (extrait dans passgen.js, testable) ---
export { generatePassword, generatePassphrase } from './passgen.js';

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — codes à usage unique
// ---------------------------------------------------------------------------
// Accepte le secret brut en base32 ou une URI otpauth:// (celle du QR code).
function normalizeTotpSecret(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^otpauth:\/\//i.test(value)) {
    try {
      return new URL(value).searchParams.get('secret')?.toUpperCase() || '';
    } catch {
      return '';
    }
  }
  return value.replace(/\s+/g, '').toUpperCase();
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(input).replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret, { digits = 6, period = 30 } = {}) {
  const key = base32Decode(normalizeTotpSecret(secret));
  if (key.length === 0) return { code: '', secondsLeft: 0 };
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return {
    code: String(bin % 10 ** digits).padStart(digits, '0'),
    secondsLeft: period - Math.floor((Date.now() / 1000) % period),
  };
}

export function entryTotp(id, entryId) {
  const res = revealSecret(id, entryId, 'totp');
  if (!res.success) return res;
  if (!res.value) return { success: false, error: 'no-totp' };
  return { success: true, ...totpCode(res.value) };
}

// ---------------------------------------------------------------------------
// Audit de santé des mots de passe
// ---------------------------------------------------------------------------
// Trois défauts qui comptent vraiment en pratique : trop court/trop simple,
// RÉUTILISÉ sur plusieurs sites (le pire — une fuite en compromet plusieurs),
// et très ancien. On ne calcule aucune empreinte hors de la machine : rien
// n'est envoyé à un service de fuite.
function strengthOf(password) {
  const p = String(password || '');
  if (!p) return 0;
  let classes = 0;
  if (/[a-z]/.test(p)) classes += 1;
  if (/[A-Z]/.test(p)) classes += 1;
  if (/[0-9]/.test(p)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(p)) classes += 1;
  // Entropie approchée : longueur × log2(taille de l'alphabet deviné)
  const alphabet = [26, 52, 62, 95][Math.max(0, classes - 1)] || 26;
  const bits = p.length * Math.log2(alphabet);
  if (bits < 40) return 1; // faible
  if (bits < 60) return 2; // moyen
  if (bits < 80) return 3; // bon
  return 4; // excellent
}

export function audit(id) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  const entries = session.payload.entries;
  const counts = new Map();
  for (const e of entries) {
    if (!e.password) continue;
    counts.set(e.password, (counts.get(e.password) || 0) + 1);
  }
  const yearAgo = now() - 365 * 24 * 3600 * 1000;
  const result = { weak: [], reused: [], old: [], empty: [], strong: 0 };
  for (const e of entries) {
    const view = { id: e.id, title: e.title, username: e.username, url: e.url };
    if (!e.password) {
      result.empty.push(view);
      continue;
    }
    const s = strengthOf(e.password);
    if (s <= 2) result.weak.push({ ...view, strength: s });
    else result.strong += 1;
    if (counts.get(e.password) > 1) result.reused.push(view);
    if ((e.passwordUpdatedAt || e.createdAt || 0) < yearAgo) result.old.push(view);
  }
  return { success: true, total: entries.length, ...result };
}

export function strength(password) {
  return { success: true, score: strengthOf(password) };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Analyseur CSV tolérant (guillemets, virgules et retours à la ligne inclus
// dans un champ) — les exports de Chrome et Bitwarden en contiennent.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

// Correspondance des colonnes : Chrome, Bitwarden, KeePass et Firefox n'ont
// pas les mêmes en-têtes. On cherche par mots-clés plutôt que par position.
function columnMap(headerRow) {
  const norm = headerRow.map((h) => String(h).toLowerCase().trim());
  const find = (...candidates) => {
    for (const c of candidates) {
      const i = norm.indexOf(c);
      if (i >= 0) return i;
    }
    for (const c of candidates) {
      const i = norm.findIndex((h) => h.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    title: find('name', 'title', 'account', 'nom'),
    url: find('login_uri', 'url', 'web site', 'website', 'hostname', 'site'),
    username: find('login_username', 'username', 'login name', 'login', 'user name', 'identifiant'),
    password: find('login_password', 'password', 'mot de passe'),
    notes: find('notes', 'note', 'comments', 'commentaire'),
    totp: find('login_totp', 'totp', 'otpauth'),
  };
}

export async function importFromFile(id, { window } = {}) {
  const session = requireOpen(id);
  if (!session) return { success: false, error: 'locked' };
  const res = await dialog.showOpenDialog(window || undefined, {
    title: 'Importer des mots de passe',
    filters: [{ name: 'CSV / JSON', extensions: ['csv', 'json'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return { success: false, error: 'canceled' };

  let rows = [];
  try {
    const text = fs.readFileSync(res.filePaths[0], 'utf8');
    if (res.filePaths[0].endsWith('.json')) {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.entries || [];
      rows = items.map((it) => ({
        title: it.name || it.title || '',
        url: it.url || it.login?.uris?.[0]?.uri || '',
        username: it.username || it.login?.username || '',
        password: it.password || it.login?.password || '',
        notes: it.notes || '',
        totp: it.totp || it.login?.totp || '',
      }));
    } else {
      const table = parseCsv(text);
      if (table.length < 2) return { success: false, error: 'empty-file' };
      const map = columnMap(table[0]);
      if (map.password === -1) return { success: false, error: 'no-password-column' };
      rows = table.slice(1).map((r) => ({
        title: map.title >= 0 ? r[map.title] : '',
        url: map.url >= 0 ? r[map.url] : '',
        username: map.username >= 0 ? r[map.username] : '',
        password: map.password >= 0 ? r[map.password] : '',
        notes: map.notes >= 0 ? r[map.notes] : '',
        totp: map.totp >= 0 ? r[map.totp] : '',
      }));
    }
  } catch (err) {
    return { success: false, error: 'unreadable', detail: String(err.message || err) };
  }

  // Dédoublonnage : réimporter le même fichier deux fois ne doit pas créer
  // 400 doublons. Clé = domaine + identifiant.
  const seen = new Set(
    session.payload.entries.map((e) => `${domainOf(e.url)}|${e.username}`)
  );
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.password && !row.username) continue;
    const key = `${domainOf(row.url)}|${row.username || ''}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    session.payload.entries.push({
      id: newId('e'),
      title: String(row.title || '').trim() || hostLabel(row.url) || 'Sans titre',
      url: String(row.url || '').trim(),
      extraUrls: [],
      username: String(row.username || ''),
      password: String(row.password || ''),
      totp: normalizeTotpSecret(row.totp),
      notes: String(row.notes || ''),
      category: '',
      favorite: false,
      createdAt: now(),
      updatedAt: now(),
      passwordUpdatedAt: now(),
      history: [],
    });
    imported += 1;
  }
  persist(headerOf(id), session.key, session.payload);
  return { success: true, imported, skipped };
}

// Export : exige de RESAISIR le mot de passe maître. Un export CSV/JSON est en
// clair — c'est le seul geste de l'application qui sorte les secrets du coffre,
// il ne doit pas pouvoir être déclenché par un simple clic sur un écran laissé
// sans surveillance.
export async function exportToFile(id, { password, format = 'csv', window } = {}) {
  const header = readHeader(id);
  if (!header) return { success: false, error: 'not-found' };
  let key;
  let payload;
  try {
    key = deriveKey(password, header.kdf.salt);
    payload = unseal(header, key);
  } catch {
    return { success: false, error: 'bad-password' };
  } finally {
    key?.fill(0);
  }

  const ext = format === 'json' ? 'json' : 'csv';
  const safeName = String(header.name).replace(/[^\p{L}\p{N}_-]+/gu, '-').toLowerCase();
  const res = await dialog.showSaveDialog(window || undefined, {
    title: 'Exporter le trousseau (fichier NON chiffré)',
    defaultPath: `orbit-${safeName}-${new Date().toISOString().slice(0, 10)}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return { success: false, error: 'canceled' };

  try {
    let content;
    if (ext === 'json') {
      content = JSON.stringify(
        payload.entries.map((e) => ({
          name: e.title,
          url: e.url,
          username: e.username,
          password: e.password,
          totp: e.totp,
          notes: e.notes,
        })),
        null,
        2
      );
    } else {
      // En-têtes compatibles avec l'import de Chrome et de Bitwarden.
      const lines = ['name,url,username,password,note'];
      for (const e of payload.entries) {
        lines.push([e.title, e.url, e.username, e.password, e.notes].map(csvEscape).join(','));
      }
      content = lines.join('\n');
    }
    fs.writeFileSync(res.filePath, content, { mode: 0o600 });
    return { success: true, path: res.filePath, count: payload.entries.length };
  } catch (err) {
    return { success: false, error: 'write-failed', detail: String(err.message || err) };
  }
}

// État global pour l'interface
export function getState() {
  return {
    vaults: list(),
    ignoredDomains: ignoreList,
    anyUnlocked: open.size > 0,
  };
}
