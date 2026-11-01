// ---------------------------------------------------------------------------
// Règles de la sauvegarde automatique — LOGIQUE PURE, sans Electron ni disque.
//
// Deux décisions valent d'être vérifiables indépendamment, parce qu'elles sont
// invisibles quand elles se trompent : QUAND sauvegarder (un automatisme qui ne
// se déclenche jamais ressemble à un automatisme qui marche) et QUOI SUPPRIMER
// en rotation (une erreur ici détruit des sauvegardes au lieu d'en garder).
// ---------------------------------------------------------------------------
import { ARCHIVE_EXTENSION } from './vault-archive.js';

const everyMs = (everyHours) => Math.max(1, Number(everyHours) || 24) * 3600 * 1000;

// Jamais sauvegardé (`lastRunAt` à 0) = dû immédiatement. Attendre 24 h après
// l'activation laisserait l'utilisateur croire que c'est en place alors qu'il
// n'aurait encore aucune archive.
export function isDue(lastRunAt, everyHours, now = Date.now()) {
  if (!Number(lastRunAt)) return true;
  return now >= Number(lastRunAt) + everyMs(everyHours);
}

// Date d'affichage de la prochaine sauvegarde. 0 = « dès que possible », ce
// que l'interface traduit en texte plutôt qu'en date de 1970.
export function nextRunDate(lastRunAt, everyHours) {
  if (!Number(lastRunAt)) return 0;
  return Number(lastRunAt) + everyMs(everyHours);
}

// Nom d'archive : `orbit-<trousseau>-<horodatage ISO>.orbitvault`. L'ISO rend
// le tri alphabétique équivalent au tri chronologique.
export function archiveName(vaultName, date = new Date()) {
  return `orbit-${safeName(vaultName)}-${stamp(date)}.${ARCHIVE_EXTENSION}`;
}

export function safeName(name) {
  return String(name || 'trousseau')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .toLowerCase();
}

export function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Quelles archives supprimer pour n'en garder que `keep` ?
//
// Le tri se fait sur le NOM, qui porte l'horodatage : trier sur la date du
// fichier se ferait piéger par une copie ou une synchronisation cloud, qui la
// réécrivent — on supprimerait alors les mauvaises.
//
// `keep` est borné à 1 au minimum : aucun réglage ne doit pouvoir vider le
// dossier de toutes ses sauvegardes. Les fichiers des AUTRES trousseaux ne sont
// jamais touchés, la rotation est par trousseau.
export function archivesToPrune(files, vaultName, keep) {
  const prefix = `orbit-${safeName(vaultName)}-`;
  const mine = (files || [])
    .filter((f) => typeof f === 'string' && f.startsWith(prefix) && f.endsWith(`.${ARCHIVE_EXTENSION}`))
    .sort();
  const limit = Math.max(1, Number(keep) || 1);
  return mine.slice(0, Math.max(0, mine.length - limit));
}
