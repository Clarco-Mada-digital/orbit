// Rangement des extensions installées par Orbit.
//
// Pourquoi ce module : un dossier d'extension NON PACKAGÉE n'a pas d'identité
// propre — Chromium dérive son ID du chemin absolu du dossier. Installer la
// nouvelle version du même ZIP dans `zip-temp-<horodatage>` (ce que faisait
// main.js) donnait donc un NOUVEL ID à chaque mise à jour, et tout ce que
// l'extension avait enregistré (`chrome.storage.local` : snippets, réglages,
// notes…) restait rangé sous l'ancien ID, donc invisible. Même effet pour
// l'accumulation de dossiers orphelins.
//
// D'où deux règles tenues ici :
//   1. un dossier d'installation au nom STABLE par extension (dérivé de son
//      nom), remplacé atomiquement à chaque mise à jour → ID stable → réglages
//      conservés ;
//   2. à la première migration (ID qui change quand même), le stockage de
//      l'ancien ID est recopié vers le nouveau avant le chargement.
//
// Module sans dépendance à Electron : testable avec de vrais dossiers.

import fs from 'node:fs';
import path from 'node:path';

// Nom de dossier stable et sûr pour une extension (« Text Snippets » →
// « text-snippets »). Sert aussi de clé de remplacement : deux versions de la
// même extension tombent dans le même dossier.
export function extensionDirSlug(name, fallback = 'extension') {
  const slug = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return slug || fallback;
}

// Remplace `targetDir` par `stagedDir` sans perdre l'ancienne version tant que
// la nouvelle n'est pas en place : renommage (pas de copie partielle), et
// retour arrière automatique si le renommage échoue.
export function replaceExtensionDir(stagedDir, targetDir) {
  let backupDir = null;
  if (fs.existsSync(targetDir)) {
    backupDir = `${targetDir}.old-${Date.now()}`;
    fs.renameSync(targetDir, backupDir);
  }
  try {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(stagedDir, targetDir);
  } catch (error) {
    if (backupDir) {
      try {
        fs.renameSync(backupDir, targetDir);
      } catch {
        /* l'ancienne version reste dans le dossier de sauvegarde */
      }
    }
    throw error;
  }
  return backupDir;
}

export function discardDirectory(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* sans conséquence : ce n'est qu'un dossier de sauvegarde */
  }
}

// Nettoyage des extractions temporaires laissées par les anciennes versions
// (`zip-temp-<horodatage>`), qui ne servent plus à rien.
export function pruneStaleInstallDirs(root, { prefixes = ['zip-temp-'], keep = [] } = {}) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    const full = path.join(root, entry.name);
    if (keep.includes(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* dossier verrouillé : on réessaiera au prochain démarrage */
    }
  }
  return removed;
}

// `Local Extension Settings/<id>` est l'emplacement où Chromium range
// `chrome.storage.local` d'une extension, dans chaque profil (partition).
export function extensionStoragePath(storagePath, id) {
  if (!storagePath || !id) return null;
  return path.join(storagePath, 'Local Extension Settings', id);
}

// Recopie le stockage d'un ancien ID vers le nouvel ID. On n'écrase jamais
// des données plus récentes : un dossier de destination déjà rempli est laissé
// tel quel. Un dossier VIDE (Chromium le crée au chargement de l'extension,
// avant que le stockage ne serve) est en revanche remplacé — sans quoi la
// migration ne pourrait jamais avoir lieu après le premier chargement.
export function copyExtensionStorage({ storagePaths = [], fromId, toId } = {}) {
  if (!fromId || !toId || fromId === toId) return 0;
  let copied = 0;
  for (const storagePath of storagePaths) {
    const from = extensionStoragePath(storagePath, fromId);
    const to = extensionStoragePath(storagePath, toId);
    if (!from || !to) continue;
    try {
      if (!fs.existsSync(from)) continue;
      if (fs.existsSync(to)) {
        if (fs.readdirSync(to).length > 0) continue;
        fs.rmSync(to, { recursive: true, force: true });
      }
      fs.cpSync(from, to, { recursive: true });
      copied += 1;
    } catch {
      /* profil verrouillé : les réglages restent sous l'ancien ID */
    }
  }
  return copied;
}

// Profils (partitions) où l'extension tourne : `Local Extension Settings` y est
// rangé sous un dossier par profil, d'où la liste de chemins.
export function sessionStoragePaths(sessions) {
  const paths = [];
  for (const ses of sessions || []) {
    try {
      if (ses?.storagePath) paths.push(ses.storagePath);
    } catch {
      /* session indisponible */
    }
  }
  return paths;
}
