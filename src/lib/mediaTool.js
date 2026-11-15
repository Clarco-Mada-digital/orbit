// ---------------------------------------------------------------------------
// Approvisionnement de yt-dlp : quel binaire utiliser, et faut-il attendre ?
//
// Pourquoi ce module existe. Le téléchargement vidéo marchait « une fois sur
// trois » et personne ne voyait pourquoi, parce que la décision était noyée
// dans du code d'entrée/sortie impossible à tester :
//
//   if (binaire vieux de plus de 7 jours) { aller sur le réseau }  // sinon throw
//
// Deux fautes dans cette seule ligne.
//
//   1. PAS DE REPLI. Si le réseau répond mal — hors ligne, ou la limite de
//      60 requêtes/heure de l'API GitHub non authentifiée — la fonction lève,
//      alors qu'un yt-dlp parfaitement utilisable est posé sur le disque. On
//      refusait de s'en servir parce qu'il avait huit jours.
//   2. ATTENTE BLOQUANTE. Le rafraîchissement retéléchargeait 41 Mo AVANT que
//      la vidéo ne commence. D'où « pas très rapide ».
//
// La règle tient en une phrase : on part avec ce qu'on a, et on se met à jour
// pendant ce temps-là. Un outil un peu vieux télécharge la vidéo ; un outil
// absent ne télécharge rien.
//
// Module SANS DÉPENDANCE (ni fs, ni net, ni Electron) : il décide, il n'agit
// pas. Testé par test/mediaTool.test.js.
// ---------------------------------------------------------------------------

// Au-delà de cet âge, le binaire mérite une mise à jour — en arrière-plan.
// yt-dlp suit les changements de YouTube, qui casse ses extracteurs toutes
// les quelques semaines : un outil figé finit par ne plus rien savoir lire.
export const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

// Âge à partir duquel on préfère QUAND MÊME attendre la mise à jour : passé
// ce délai, les chances que l'outil échoue sur YouTube deviennent élevées, et
// attendre 41 Mo vaut mieux qu'un échec immédiat. Le repli reste de s'en
// servir tel quel si le réseau ne répond pas.
export const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;

export const MAX_TOOL_BYTES = 50 * 1024 * 1024;

// Nom de l'asset publié par yt-dlp pour cette plateforme.
export function assetNameFor(platform, arch) {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') {
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'x64') return 'yt-dlp_linux';
  }
  return null;
}

// URL de téléchargement direct de la dernière version.
//
// On n'interroge PLUS l'API GitHub (api.github.com), qui plafonne à
// 60 requêtes par heure et par adresse IP sans authentification : c'était une
// cause d'échec intermittent pour quelque chose d'aussi banal que récupérer
// un fichier public. `releases/latest/download/<nom>` redirige vers le même
// binaire, sans quota.
export function releaseAssetUrl(name) {
  if (!name) return null;
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;
}

export const CHECKSUMS_URL = releaseAssetUrl('SHA2-256SUMS');

// Empreinte attendue pour `name`, lue dans le fichier SHA2-256SUMS.
// On garde cette vérification : se passer de l'API ne veut pas dire se passer
// de savoir ce qu'on vient d'écrire sur le disque et de rendre exécutable.
export function parseChecksums(text, name) {
  if (!name) return null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(\S+)\s*$/i.exec(line);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

// --- La décision ----------------------------------------------------------
//
// Entrées : ce qu'on a sous la main. Sortie : quoi faire, maintenant.
//
//   { use: chemin | null,   le binaire à lancer tout de suite (null = aucun)
//     refresh: bool,        faut-il aller chercher une version récente ?
//     blocking: bool,       ...et faut-il l'attendre avant de lancer ?
//     reason: string }      pour le journal, et pour les tests
export function chooseTool({
  cached = null, // { path, mtimeMs } du binaire géré par Orbit
  system = null, // chemin d'un yt-dlp trouvé dans le PATH
  now = Date.now(),
  refreshAfterMs = REFRESH_AFTER_MS,
  staleAfterMs = STALE_AFTER_MS,
} = {}) {
  const age = cached ? Math.max(0, now - (cached.mtimeMs || 0)) : Infinity;

  if (cached?.path) {
    if (age < refreshAfterMs) {
      return { use: cached.path, refresh: false, blocking: false, reason: 'cached-fresh' };
    }
    if (age < staleAfterMs) {
      // Le cas qui réparait tout : on télécharge avec ce qu'on a, la mise à
      // jour se fait derrière et servira la prochaine fois.
      return { use: cached.path, refresh: true, blocking: false, reason: 'cached-refresh-async' };
    }
    // Très vieux : mieux vaut attendre la mise à jour. Si elle échoue,
    // l'appelant retombe sur `use`, qui n'est pas nul — jamais de cul-de-sac.
    return { use: cached.path, refresh: true, blocking: true, reason: 'cached-stale' };
  }

  // Rien à nous. Un yt-dlp système existe peut-être, mais les paquets de
  // distribution ont souvent des années de retard — celui de la machine de
  // développement datait de 2024 et échouait sur CHAQUE vidéo YouTube. S'en
  // servir d'emblée, ce serait offrir un premier échec garanti.
  //
  // On attend donc notre version une fois, et le binaire système ne sert que
  // si ce téléchargement échoue : mieux vaut un outil vieux qu'aucun outil.
  if (system) {
    return { use: system, refresh: true, blocking: true, reason: 'system-fallback' };
  }

  return { use: null, refresh: true, blocking: true, reason: 'missing' };
}

// Le binaire fraîchement téléchargé est-il celui qu'on attend ? C'est la
// garde qui empêche d'écrire puis de rendre exécutable n'importe quoi.
//
// L'EMPREINTE SHA-256 est la garantie, et elle n'est pas négociable : sans
// elle on refuse. La taille n'est qu'un garde-fou de bon sens, et elle est
// facultative — en passant par `releases/latest/download/` on récupère une
// redirection qui n'annonce pas toujours `Content-Length`. Exiger une taille
// qu'on n'a pas, c'est se redonner l'échec qu'on vient de retirer.
export function verifyDownload({ expectedSize = null, receivedSize, expectedSum, actualSum }) {
  if (!Number.isSafeInteger(receivedSize) || receivedSize <= 0) {
    return { ok: false, reason: 'empty' };
  }
  if (receivedSize > MAX_TOOL_BYTES) return { ok: false, reason: 'size-too-large' };
  if (expectedSize !== null && expectedSize !== undefined) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
      return { ok: false, reason: 'size-invalid' };
    }
    if (receivedSize !== expectedSize) return { ok: false, reason: 'size-mismatch' };
  }
  if (!expectedSum) return { ok: false, reason: 'checksum-missing' };
  if (String(actualSum || '').toLowerCase() !== String(expectedSum).toLowerCase()) {
    return { ok: false, reason: 'checksum-mismatch' };
  }
  return { ok: true, reason: 'verified' };
}
