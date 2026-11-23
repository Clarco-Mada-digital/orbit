// ---------------------------------------------------------------------------
// Journal des requêtes MÉDIA qui échouent — logique PURE, sans Electron.
//
// Pourquoi ce fichier existe : « certaines vidéos ne se lisent pas » était un
// signalement qu'on ne pouvait pas instruire. Le lecteur restait noir, et rien,
// nulle part, ne disait pourquoi : réponse 403 du CDN ? segment bloqué par le
// bloqueur de pub ? cookie retiré par le bouclier ? contenu protégé par DRM ?
// Les quatre causes produisent le même écran noir.
//
// Ce journal répond à cette question précise : pour une page donnée, quelles
// requêtes de média ont échoué, avec quel statut, et est-ce que NOUS y sommes
// pour quelque chose. L'interface le lit quand une vidéo tombe en panne et le
// recopie dans Diagnostics — on passe d'une intuition à une trace.
//
// Borné par construction : une page vidéo émet des centaines de requêtes de
// segments. Un journal non borné sur une app laissée ouverte toute la journée
// finirait par peser plus lourd que ce qu'il explique.
// ---------------------------------------------------------------------------

// Nombre d'échecs retenus par page. Au-delà, le plus ancien part : ce sont les
// DERNIERS qui comptent (ceux de la vidéo qu'on regarde maintenant).
const MAX_PER_CONTENTS = 25;

// Requêtes dont on a retiré le cookie, en attente de leur réponse. Bornée
// elle aussi : une requête dont la réponse n'arrive jamais ne doit pas laisser
// une entrée éternelle.
const MAX_PENDING = 200;

const journal = new Map(); // webContentsId -> [{ url, status, reason, cookieStripped, at }]
const strippedRequests = new Set(); // ids de requêtes dont le cookie a été retiré

// Extensions et formes d'URL qui transportent de la vidéo ou de l'audio.
// `m4s` et `ts` sont les segments de DASH/HLS, `m3u8`/`mpd` leurs manifestes.
const MEDIA_EXT = /\.(?:mp4|m4s|m4a|m4v|webm|mkv|mov|m3u8|mpd|ts|aac|mp3|ogg|opus|flac|wav)(?:$|[?#])/i;

// Chemins de lecteurs connus qui ne portent aucune extension :
//   • `videoplayback`         → YouTube ;
//   • `/v/t<nombre>.`         → fbcdn (Facebook, Messenger, Instagram) ;
//   • `dash`, `hls`, `segment`, `range` → nommage courant du streaming par
//     segments, tous moteurs confondus.
const MEDIA_HINT = /videoplayback|\/v\/t\d+\.|[/_-](?:dash|hls|segment|chunk)[/_.-]|bytestart=/i;

// Une requête transporte-t-elle du média ? Le type de ressource suffit quand
// Chromium le dit ('media'), mais les lecteurs modernes (MSE) téléchargent
// leurs segments en `xhr`/`fetch` : indistinguables d'un appel d'API sans
// regarder l'URL. Sans ce filtre, le journal se remplirait du bavardage normal
// d'une messagerie et n'expliquerait plus rien.
export function looksLikeMedia(url, resourceType) {
  if (resourceType === 'media') return true;
  if (resourceType !== 'xhr' && resourceType !== 'other') return false;
  const u = String(url || '');
  return MEDIA_EXT.test(u) || MEDIA_HINT.test(u);
}

// Mémorise qu'on a retiré le cookie de cette requête (blocage des cookies
// tiers). C'est l'information la plus précieuse du journal : elle distingue
// « le site refuse » de « nous avons retiré de quoi l'autoriser ».
export function noteCookieStrip(requestId) {
  if (requestId == null) return;
  if (strippedRequests.size >= MAX_PENDING) {
    // Set itère dans l'ordre d'insertion : le premier est le plus ancien.
    strippedRequests.delete(strippedRequests.values().next().value);
  }
  strippedRequests.add(requestId);
}

// Enregistre un échec. `reason` : 'status' (le serveur a refusé) ou 'blocked'
// (c'est nous qui avons annulé la requête).
export function record(webContentsId, { url, status = 0, reason = 'status', requestId } = {}) {
  const id = Number(webContentsId);
  if (!Number.isInteger(id)) return null;
  const cookieStripped = requestId != null && strippedRequests.delete(requestId);
  const entry = {
    url: String(url || '').slice(0, 500),
    status: Number(status) || 0,
    reason,
    cookieStripped,
    at: Date.now(),
  };
  const list = journal.get(id) || [];
  list.push(entry);
  while (list.length > MAX_PER_CONTENTS) list.shift();
  journal.set(id, list);
  return entry;
}

// Échecs retenus pour cette page, du plus récent au plus ancien.
export function list(webContentsId) {
  const id = Number(webContentsId);
  return [...(journal.get(id) || [])].reverse();
}

// Vidé au début de chaque chargement de page (comme les stats de blocage) :
// les échecs de la page précédente n'expliquent pas celle-ci.
export function clear(webContentsId) {
  journal.delete(Number(webContentsId));
  return { success: true };
}

// Pour les tests : repart d'un état vierge.
export function reset() {
  journal.clear();
  strippedRequests.clear();
}
