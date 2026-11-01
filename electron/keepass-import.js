// ---------------------------------------------------------------------------
// Rapatriement d'une base KeePassXC vers un trousseau Orbit
//
// Pourquoi deux requêtes et pas une : le protocole keepassxc-browser n'a aucun
// message « donne-moi toute la base ». Il en a deux complémentaires :
//   • `get-database-entries` liste TOUTES les entrées, mais seulement leur
//     titre, leur URL et leur UUID — jamais les mots de passe. C'est volontaire
//     côté KeePassXC (réglage « Allow limited access to all entries »).
//   • `get-logins` rend les identifiants complets, mais pour UNE URL à la fois.
//
// On enchaîne donc : liste des entrées → URLs distinctes → un `get-logins` par
// URL. D'où ce module, qui tient la partie sans entrées/sorties (quelles URLs
// interroger, comment recoller les réponses) et reste testable sans Electron ni
// KeePassXC qui tourne.
//
// Conséquence à assumer : une entrée SANS URL est injoignable par `get-logins`,
// elle ne peut pas être rapatriée. On la compte et on la nomme dans le rapport
// plutôt que de la perdre en silence.
// ---------------------------------------------------------------------------

// KeePassXC compare les URLs schéma compris. Une entrée notée « example.com »
// sans schéma ne matcherait rien : on la présente en https://.
export function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''; // mailto:, otpauth:… : pas un site
  return `https://${value}`;
}

// URLs distinctes à interroger. Deux entrées sur le même site ne coûtent
// qu'une requête : `get-logins` rend déjà TOUS les comptes du domaine.
export function uniqueUrls(dbEntries = []) {
  const seen = new Set();
  const urls = [];
  for (const entry of dbEntries) {
    const url = normalizeUrl(entry?.url);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

// Que faut-il interroger ?
//
// `get-database-entries` n'existe QUE depuis KeePassXC 2.8 : sur 2.7.x, il
// répond « action incorrecte » et on ne peut pas énumérer la base. Le
// rapatriement n'est pas perdu pour autant — `get-logins` marche sur toutes
// les versions, il faut juste lui fournir les sites à interroger. Orbit en
// connaît une liste pertinente : les adresses de ses propres apps.
//
// On obtient alors les identifiants des sites que l'utilisateur utilise
// vraiment dans Orbit, ce qui couvre l'essentiel du besoin. Le reste de la
// base demande KeePassXC 2.8, ou son export CSV.
//
// `mode` dit laquelle des deux sources a servi, pour que l'écran l'annonce
// au lieu de laisser croire à un import exhaustif.
export function chooseScanUrls(listing, fallbackUrls = []) {
  if (listing?.success) {
    return { mode: 'database', urls: uniqueUrls(listing.entries), entries: listing.entries };
  }
  const candidates = uniqueUrls((fallbackUrls || []).map((url) => ({ url })));
  if (candidates.length === 0) return null; // rien à proposer : l'erreur remonte
  return { mode: 'apps', urls: candidates, entries: [], reason: listing?.error || 'unknown' };
}

// Entrées de la base qui n'ont aucune URL exploitable : on remonte leur titre
// pour que l'utilisateur sache exactement ce qui n'a pas suivi.
export function entriesWithoutUrl(dbEntries = []) {
  return dbEntries.filter((e) => !normalizeUrl(e?.url)).map((e) => String(e?.title || 'Sans titre'));
}

// Recolle les réponses `get-logins` en lignes d'import, au format attendu par
// l'import de fichier du coffre (title, url, username, password, totp, notes).
//
// `loginsByUrl` : Map<url interrogée, tableau d'identifiants renvoyés>.
// Le dédoublonnage ici est volontairement étroit — même URL, même compte, même
// mot de passe : c'est la même chose vue deux fois. Le rapprochement avec les
// entrées DÉJÀ dans le trousseau, lui, reste le travail du coffre (par domaine
// et nom d'utilisateur), qui sait fusionner ou écraser.
export function buildImportRows(dbEntries = [], loginsByUrl = new Map()) {
  // Titre de la base par URL : quand KeePassXC ne renvoie pas de nom pour un
  // identifiant, le titre de l'entrée d'origine vaut mieux que « rien ».
  const titleByUrl = new Map();
  for (const entry of dbEntries) {
    const url = normalizeUrl(entry?.url);
    if (!url) continue;
    const key = url.toLowerCase();
    if (!titleByUrl.has(key) && entry?.title) titleByUrl.set(key, String(entry.title));
  }

  const rows = [];
  const seen = new Set();
  for (const [url, logins] of loginsByUrl) {
    const normalized = normalizeUrl(url);
    if (!normalized) continue;
    for (const login of logins || []) {
      const username = String(login?.login || '');
      const password = String(login?.password || '');
      if (!username && !password) continue;
      const key = `${normalized.toLowerCase()}|${username}|${password}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        title: String(login?.name || titleByUrl.get(normalized.toLowerCase()) || ''),
        url: normalized,
        username,
        password,
        // KeePassXC ne joint le TOTP que si le réglage correspondant est actif
        // dans ses paramètres ; sinon le champ est simplement absent.
        totp: String(login?.totp || ''),
        notes: '',
      });
    }
  }
  return rows;
}
