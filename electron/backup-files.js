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
]);

// Fichiers de verrouillage de leveldb : caducs par nature, jamais utiles
// ailleurs (et leur présence sans le reste du jeu nuit).
const SKIP_FILES = new Set(['LOCK', 'LOCK.tmp']);

// Garde-fous : une sauvegarde reste un FICHIER qu'on charge en mémoire d'un
// seul tenant. Au-delà, on refuse proprement plutôt que de tuer le processus.
export const MAX_BACKUP_FILES = 50000;
export const MAX_BACKUP_BYTES = 768 * 1024 * 1024;

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

// Collecte les fichiers de session + trousseaux, compressés (gzip) et encodés
// en base64 pour tenir dans le JSON de sauvegarde.
export function collectBackupFiles(userDataDir) {
  const found = [];
  for (const rootName of BACKUP_ROOTS) {
    collect(path.join(userDataDir, rootName), rootName, found);
  }
  const entries = [];
  let total = 0;
  for (const { abs, rel } of found) {
    let raw;
    try {
      raw = fs.readFileSync(abs);
    } catch {
      continue; // fichier verrouillé au moment de l'export : sans lui
    }
    if (!raw.length) continue;
    total += raw.length;
    if (total > MAX_BACKUP_BYTES || entries.length >= MAX_BACKUP_FILES) {
      throw new Error('tooBig');
    }
    // gzip n'est utile que s'il réduit réellement (les fichiers déjà
    // compressés ne gagnent rien — on garde alors l'octet d'origine).
    const gz = zlib.gzipSync(raw, { level: 6 });
    if (gz.length < raw.length) {
      entries.push({ path: rel, gz: true, data: gz.toString('base64') });
    } else {
      entries.push({ path: rel, data: raw.toString('base64') });
    }
  }
  return entries;
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
