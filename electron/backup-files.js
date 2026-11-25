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
