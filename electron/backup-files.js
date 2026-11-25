// ---------------------------------------------------------------------------
// Sauvegarde COMPLETE : les fichiers de SESSION (cookies, stockages) et les
// TROUSSEAUX quittent le dossier utilisateur pour rejoindre le fichier de
// sauvegarde — c'est ce qui permet de retrouver ses comptes connectés et ses
// mots de passe sur un autre ordinateur.
//
// Deux exigences dictent tout ce qui suit :
//
//   • La restauration ne se fait JAMAIS pendant la vie de l'app : Electron
//     réécrit les cookies et les stockages de chaque partition à la fermeture,
//     ce qui écraserait ce qu'on vient de poser. On ÉTAGE donc la restauration
//     (fichier `pending-restore.json`) et main.js l'applique au démarrage
//     SUIVANT, avant la moindre session ouverte.
//
//   • Un fichier de sauvegarde ne doit pouvoir écrire QUE sous `Partitions/`
//     et `vaults/` : une entrée « ../security.json » pourrait sinon déverrouiller
//     l'appareil, ou « ../Local Storage/… » réécrire la configuration.
//
// Ce module ne connaît ni Electron ni les dialogues : il ne fait que du fs, ce
// qui le rend testable sous `node --test` avec des dossiers temporaires.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Racines incluses dans une sauvegarde (relatives au dossier utilisateur).
export const BACKUP_ROOTS = ['Partitions', 'vaults'];

// Dossiers régénérables : le cache se reconstruit tout seul et pèse souvent
// plus que le reste (vidéos de page, shaders GPU…). On les laisse sur disque.
const SKIP_DIRS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'GrShaderCache',
  'ShaderCache',
  'CacheStorage',
  'Crashpad',
  'crashpad',
  'DawnWebGPUCache',
  // Scripts des service workers : le site les retélécharge au besoin.
  'ScriptCache',
  // Statistiques et données jetables de Chromium.
  'VideoDecodeStats',
  'WebrtcVideoStats',
  'blob_storage',
  'shared_proto_db',
  'Shared Dictionary',
]);

// Fichiers de verrouillage de leveldb : caducs par nature, jamais utiles
// ailleurs (et leur présence sans le reste du jeu nuit).
const SKIP_FILES = new Set(['LOCK', 'LOCK.tmp']);
// Bases publicitaires et statistiques de Chromium (et leurs journaux) : rien
// de ce qu'on veut retrouver sur un autre ordinateur.
const SKIP_FILE_PREFIXES = [
  'Trust Tokens',
  'InterestGroups',
  'PrivateAggregation',
  'DIPS',
  'declarative_performance_observer',
  'SharedStorage',
];

// Garde-fous : une sauvegarde reste un FICHIER qu'on charge en mémoire d'un
// seul tenant. Au-delà, on refuse proprement plutôt que de tuer le processus.
export const MAX_BACKUP_FILES = 50000;
export const MAX_BACKUP_BYTES = 768 * 1024 * 1024;
// Plafond de ce qu'on ENCODE (base64) : le fichier de sauvegarde est une seule
// chaîne JSON, et V8 refuse toute chaîne au-delà d'environ 512 Mo (« Invalid
// string length »). Chiffré, le contenu est encore réencodé en base64 (×4/3) :
// 320 Mo ici donnent ~430 Mo au pire, sous la limite.
export const MAX_ENCODED_BYTES = 320 * 1024 * 1024;

// Les grosses données locales des sites (IndexedDB, système de fichiers) :
// sauvegardées si la place le permet, en commençant par les plus petites, et
// TOUJOURS par magasin entier (une base leveldb à moitié copiée est corrompue).
const HEAVY_DIRS = new Set(['IndexedDB', 'File System']);

function heavyGroupOf(rel) {
  const parts = rel.split('/');
  const i = parts.findIndex((p) => HEAVY_DIRS.has(p));
  if (i < 0) return null;
  // Partitions/<partition>/IndexedDB/<magasin>/…
  return parts.slice(0, Math.min(parts.length - 1, i + 2)).join('/');
}

function describeGroup(group) {
  const parts = group.split('/');
  let partition = parts[1] || '';
  try {
    partition = decodeURIComponent(partition);
  } catch {
    /* nom brut */
  }
  const store = parts[3] || parts[2] || '';
  const m = /^(https?)_(.+?)_\d+\.indexeddb/.exec(store);
  return { partition, site: m ? m[2] : store };
}

const encodedLength = (n) => Math.ceil(n / 3) * 4;

// Relève récursive des fichiers (les dossiers ignorés ne sont pas parcourus).
function collect(root, rel, out) {
  let items;
  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // dossier absent (aucune session encore) : pas une erreur
  }
  for (const item of items) {
    const relPath = rel ? `${rel}/${item.name}` : item.name;
    const abs = path.join(root, item.name);
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      collect(abs, relPath, out);
    } else if (item.isFile()) {
      if (SKIP_FILES.has(item.name)) continue;
      if (SKIP_FILE_PREFIXES.some((prefix) => item.name.startsWith(prefix))) continue;
      out.push({ abs, rel: relPath });
    }
  }
}

// Racine d'une entrée : 'Partitions', 'vaults', ou null si hors périmètre.
function rootOf(rel) {
  const first = String(rel || '').split('/')[0];
  return BACKUP_ROOTS.includes(first) ? first : null;
}

function assertSafeEntry(entry) {
  const rel = String(entry?.path || '');
  if (!rootOf(rel)) throw new Error(`entrée hors périmètre : ${rel || '(vide)'}`);
  // Résolution contre la racine : rejette « .. », le absolu, et tout ce qui
  // sortirait du dossier utilisateur.
  const resolved = path.resolve('/base', rel);
  const base = path.resolve('/base');
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error(`chemin refusé : ${rel}`);
  }
}

function encodeEntry(rel, raw) {
  // gzip n'est utile que s'il réduit réellement (les fichiers déjà
  // compressés ne gagnent rien — on garde alors l'octet d'origine).
  const gz = zlib.gzipSync(raw, { level: 6 });
  if (gz.length < raw.length) return { path: rel, gz: true, data: gz.toString('base64') };
  return { path: rel, data: raw.toString('base64') };
}

// Collecte les fichiers de session + trousseaux, compressés (gzip) et encodés
// en base64 pour tenir dans le JSON de sauvegarde.
//
// L'essentiel (cookies, stockages locaux, trousseaux…) passe d'abord et doit
// tenir en entier. Les grosses données des sites (IndexedDB) suivent, des
// plus petites aux plus grosses, tant qu'il reste de la place ; celles qui
// ne tiennent pas sont listées dans `skipped` (le site les recrée, mais il
// peut redemander une connexion).
export function collectBackup(userDataDir, { maxEncoded = MAX_ENCODED_BYTES } = {}) {
  const found = [];
  for (const rootName of BACKUP_ROOTS) {
    collect(path.join(userDataDir, rootName), rootName, found);
  }
  if (found.length > MAX_BACKUP_FILES) throw new Error('tooBig');

  const essentials = [];
  const groups = new Map(); // magasin → { files, size }
  for (const file of found) {
    let size = 0;
    try {
      size = fs.statSync(file.abs).size;
    } catch {
      continue;
    }
    if (!size) continue;
    const group = heavyGroupOf(file.rel);
    if (!group) {
      essentials.push(file);
      continue;
    }
    const g = groups.get(group) || { files: [], size: 0 };
    g.files.push(file);
    g.size += size;
    groups.set(group, g);
  }

  const entries = [];
  let encoded = 0;
  let raw = 0;
  const read = (abs) => {
    try {
      return fs.readFileSync(abs);
    } catch {
      return null; // fichier verrouillé au moment de l'export : sans lui
    }
  };

  for (const { abs, rel } of essentials) {
    const data = read(abs);
    if (!data?.length) continue;
    raw += data.length;
    const entry = encodeEntry(rel, data);
    encoded += entry.data.length;
    if (raw > MAX_BACKUP_BYTES || encoded > maxEncoded) throw new Error('tooBig');
    entries.push(entry);
  }

  const skipped = [];
  const ordered = [...groups.entries()].sort((a, b) => a[1].size - b[1].size);
  for (const [group, { files, size }] of ordered) {
    // Estimation prudente (sans gzip) avant de lire quoi que ce soit.
    if (encoded + encodedLength(size) > maxEncoded) {
      skipped.push({ ...describeGroup(group), bytes: size });
      continue;
    }
    const batch = [];
    let batchEncoded = 0;
    for (const { abs, rel } of files) {
      const data = read(abs);
      if (!data?.length) continue;
      const entry = encodeEntry(rel, data);
      batchEncoded += entry.data.length;
      batch.push(entry);
    }
    if (encoded + batchEncoded > maxEncoded) {
      skipped.push({ ...describeGroup(group), bytes: size });
      continue;
    }
    encoded += batchEncoded;
    entries.push(...batch);
  }
  return { entries, skipped, encodedBytes: encoded };
}

// Forme historique : les entrées seules.
export function collectBackupFiles(userDataDir, options) {
  return collectBackup(userDataDir, options).entries;
}

// Écrit les entrées dans le dossier utilisateur (utilisé AU DÉMARRAGE, avant
// toute session). Renvoie le nombre de fichiers écrits.
export function writeBackupFiles(userDataDir, entries) {
  if (!Array.isArray(entries) || entries.length > MAX_BACKUP_FILES) {
    if (Array.isArray(entries)) throw new Error('tooMany');
    return 0;
  }
  let written = 0;
  for (const entry of entries) {
    assertSafeEntry(entry);
    const buf = Buffer.from(String(entry?.data || ''), 'base64');
    const data = entry?.gz ? zlib.gunzipSync(buf) : buf;
    const target = path.join(userDataDir, ...String(entry.path).split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written += 1;
  }
  return written;
}

export function pendingRestorePath(userDataDir) {
  return path.join(userDataDir, 'pending-restore.json');
}

// Étage la restauration : main.js écrit ce fichier puis redémarre l'app ; le
// prochain lancement l'applique avant d'ouvrir la moindre session.
export function stageRestore(userDataDir, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { count: 0 };
  // Valide TOUT avant d'écrire : une entrée invalide ne doit pas laisser un
  // fichier de restauration partiellement faux sur disque.
  for (const entry of entries) assertSafeEntry(entry);
  if (entries.length > MAX_BACKUP_FILES) throw new Error('tooMany');
  const file = pendingRestorePath(userDataDir);
  fs.writeFileSync(file, JSON.stringify({ entries }));
  return { count: entries.length };
}

// Applique la restauration en attente (aucun fichier → 0, sans erreur).
export function applyPendingRestore(userDataDir) {
  const file = pendingRestorePath(userDataDir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { count: 0 };
  }
  try {
    const parsed = JSON.parse(raw);
    const count = writeBackupFiles(userDataDir, parsed.entries);
    fs.rmSync(file, { force: true });
    return { count };
  } catch (err) {
    // Fichier corrompu ou entrée refusée : on laisse tomber la restauration
    // mais on ne casse pas le démarrage (l'app reste utilisable).
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
    return { count: 0, error: String(err.message || err) };
  }
}

// ---------------------------------------------------------------------------
// Sauvegarde complète EN FLUX (format 2)
//
// Le format 1 tenait dans UNE chaîne JSON : au-delà d'environ 512 Mo, V8
// refusait (« Invalid string length ») et il fallait laisser des données de
// côté. Le format 2 écrit au fil de l'eau, sans jamais tout tenir en mémoire :
//
//   ORBITBK2 {"v":2,"salt":"…","iv":"…"}\n   ← en-tête en clair (authentifié)
//   <AES-256-GCM( ligne 1 : configuration JSON
//                 lignes suivantes : une entrée de fichier JSON par ligne )>
//   <étiquette GCM, 16 octets>
//
// Les gros fichiers sont découpés en morceaux de 32 Mo (`append: true` pour
// les suivants) : aucune ligne ne s'approche de la limite des chaînes.
// À la lecture, RIEN n'est appliqué avant que l'étiquette ait été vérifiée :
// le contenu déchiffré est d'abord étagé dans un fichier temporaire.
// ---------------------------------------------------------------------------

export const STREAM_MAGIC = 'ORBITBK2';
const CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_CONFIG_LINE = 256 * 1024 * 1024;

function deriveStreamKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32);
}

// Toutes les entrées, une par une (gros fichiers découpés). Sans plafond de
// taille totale : c'est tout l'intérêt du format en flux.
export function* iterateBackupEntries(userDataDir) {
  const found = [];
  for (const rootName of BACKUP_ROOTS) {
    collect(path.join(userDataDir, rootName), rootName, found);
  }
  if (found.length > MAX_BACKUP_FILES) throw new Error('tooBig');
  for (const { abs, rel } of found) {
    let raw;
    try {
      raw = fs.readFileSync(abs);
    } catch {
      continue; // fichier verrouillé au moment de l'export : sans lui
    }
    if (!raw.length) continue;
    for (let at = 0; at < raw.length; at += CHUNK_BYTES) {
      const entry = encodeEntry(rel, raw.subarray(at, at + CHUNK_BYTES));
      if (at > 0) entry.append = true;
      yield entry;
    }
  }
}

export function isStreamBackup(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(STREAM_MAGIC.length);
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.toString('latin1') === STREAM_MAGIC;
  } catch {
    return false;
  }
}

// Écrit la sauvegarde complète chiffrée. `config` : tout sauf les fichiers.
export async function writeStreamBackup(filePath, { config, password, userDataDir }) {
  if (!password) throw new Error('password-required');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = Buffer.from(`${STREAM_MAGIC} ${JSON.stringify({ v: 2, salt: salt.toString('base64'), iv: iv.toString('base64') })}\n`, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveStreamKey(password, salt), iv);
  cipher.setAAD(header);
  const tmp = `${filePath}.tmp`;
  let count = 0;
  try {
    fs.writeFileSync(tmp, header, { mode: 0o600 });
    const lines = function* () {
      yield `${JSON.stringify(config ?? {})}\n`;
      for (const entry of iterateBackupEntries(userDataDir)) {
        count += 1;
        yield `${JSON.stringify(entry)}\n`;
      }
    };
    await pipeline(Readable.from(lines()), cipher, fs.createWriteStream(tmp, { flags: 'a', mode: 0o600 }));
    fs.appendFileSync(tmp, cipher.getAuthTag());
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { count };
}

// Coupe un flux d'octets en lignes ; appelle onLine(chaîne) pour chacune.
// Les morceaux d'une ligne longue sont gardés à part et recollés UNE fois :
// les recoller à chaque bloc reçu serait quadratique sur une ligne de 40 Mo.
function lineSplitter(onLine) {
  let parts = [];
  let partsLen = 0;
  const emit = (tail) => {
    const line = parts.length ? Buffer.concat([...parts, tail]) : tail;
    parts = [];
    partsLen = 0;
    onLine(line.toString('utf8'));
  };
  return new Transform({
    transform(chunk, _enc, done) {
      try {
        let start = 0;
        let nl;
        while ((nl = chunk.indexOf(10, start)) >= 0) {
          emit(chunk.subarray(start, nl));
          start = nl + 1;
        }
        if (start < chunk.length) {
          parts.push(chunk.subarray(start));
          partsLen += chunk.length - start;
          if (partsLen > MAX_CONFIG_LINE) throw new Error('line-too-long');
        }
        done();
      } catch (err) {
        done(err);
      }
    },
    flush(done) {
      try {
        if (partsLen) emit(Buffer.alloc(0));
        done();
      } catch (err) {
        done(err);
      }
    },
  });
}

// Déchiffre et VÉRIFIE la sauvegarde, en étageant les fichiers dans
// `stagePath` (une entrée JSON par ligne). Renvoie la configuration et le
// nombre d'entrées. Mot de passe faux ou fichier altéré : erreur 'bad-password'
// et rien n'est laissé sur le disque.
export async function readStreamBackup(filePath, { password, stagePath }) {
  const size = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(Math.min(4096, size));
  fs.readSync(fd, head, 0, head.length, 0);
  const tag = Buffer.alloc(16);
  fs.readSync(fd, tag, 0, 16, size - 16);
  fs.closeSync(fd);
  const nl = head.indexOf(10);
  if (nl < 0 || head.subarray(0, STREAM_MAGIC.length).toString('latin1') !== STREAM_MAGIC) throw new Error('not-a-backup');
  const header = head.subarray(0, nl + 1);
  let meta;
  try {
    meta = JSON.parse(header.subarray(STREAM_MAGIC.length + 1).toString('utf8'));
  } catch {
    throw new Error('not-a-backup');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveStreamKey(password, Buffer.from(String(meta.salt), 'base64')),
    Buffer.from(String(meta.iv), 'base64')
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  const tmp = `${stagePath}.tmp`;
  const out = fs.openSync(tmp, 'w', 0o600);
  let config = null;
  let count = 0;
  try {
    await pipeline(
      fs.createReadStream(filePath, { start: header.length, end: size - 17 }),
      decipher,
      lineSplitter((line) => {
        if (!line) return;
        if (config === null) {
          config = JSON.parse(line);
          return;
        }
        const entry = JSON.parse(line);
        assertSafeEntry(entry);
        count += 1;
        if (count > MAX_BACKUP_FILES * 64) throw new Error('tooMany');
        fs.writeSync(out, `${line}\n`);
      })
    );
    fs.closeSync(out);
  } catch (err) {
    try {
      fs.closeSync(out);
    } catch {
      /* déjà fermé */
    }
    fs.rmSync(tmp, { force: true });
    // Mauvais mot de passe : soit l'étiquette GCM refuse à la fin, soit le
    // « clair » obtenu n'est que du bruit et ne se lit pas. Même réponse.
    const msg = String(err?.message || err);
    if (err instanceof SyntaxError || /auth|decrypt/i.test(msg)) throw new Error('bad-password');
    throw err;
  }
  if (count) fs.renameSync(tmp, stagePath);
  else fs.rmSync(tmp, { force: true });
  return { config: config || {}, count };
}

export function pendingStreamRestorePath(userDataDir) {
  return path.join(userDataDir, 'pending-restore.ndjson');
}

// Applique un étage au format ligne par ligne (lecture par blocs : le fichier
// peut faire plusieurs Go).
function applyNdjson(userDataDir, file) {
  const fd = fs.openSync(file, 'r');
  const block = Buffer.alloc(8 * 1024 * 1024);
  let rest = Buffer.alloc(0);
  let written = 0;
  const handle = (line) => {
    if (!line.length) return;
    const entry = JSON.parse(line.toString('utf8'));
    assertSafeEntry(entry);
    const buf = Buffer.from(String(entry?.data || ''), 'base64');
    const data = entry?.gz ? zlib.gunzipSync(buf) : buf;
    const target = path.join(userDataDir, ...String(entry.path).split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.append) fs.appendFileSync(target, data);
    else {
      fs.writeFileSync(target, data);
      written += 1;
    }
  };
  try {
    let n;
    while ((n = fs.readSync(fd, block, 0, block.length, null)) > 0) {
      let buf = Buffer.concat([rest, block.subarray(0, n)]);
      let nl;
      while ((nl = buf.indexOf(10)) >= 0) {
        handle(buf.subarray(0, nl));
        buf = buf.subarray(nl + 1);
      }
      rest = Buffer.from(buf);
    }
    if (rest.length) handle(rest);
  } finally {
    fs.closeSync(fd);
  }
  return written;
}

export function applyPendingStreamRestore(userDataDir) {
  const file = pendingStreamRestorePath(userDataDir);
  if (!fs.existsSync(file)) return { count: 0 };
  try {
    return { count: applyNdjson(userDataDir, file) };
  } catch (err) {
    return { count: 0, error: String(err.message || err) };
  } finally {
    fs.rmSync(file, { force: true });
  }
}
