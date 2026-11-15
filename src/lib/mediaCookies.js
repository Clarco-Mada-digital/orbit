// ---------------------------------------------------------------------------
// Cookies confiés à yt-dlp, au format Netscape.
//
// POURQUOI. Une vidéo Facebook, une vidéo réservée aux abonnés, une vidéo
// soumise à une vérification d'âge : yt-dlp ne les voit pas, parce qu'il est
// lancé comme un inconnu alors qu'Orbit, lui, est connecté. C'est l'autre
// moitié du « une fois sur trois ».
//
// CE QUI EST EN JEU. Un cookie de session EST l'équivalent du mot de passe
// pour la durée de la session. L'écrire dans un fichier pour le passer à un
// autre programme est la seule façon de faire (yt-dlp ne lit que `--cookies`),
// mais ça mérite d'être étroit :
//
//   • on n'envoie QUE les cookies du domaine visé — télécharger une vidéo
//     Facebook ne doit pas exposer la session bancaire ouverte à côté ;
//   • le fichier est écrit en 0600 et supprimé dès la fin du processus
//     (côté appelant, voir electron/downloader.js) ;
//   • les cookies de session (sans date d'expiration) sont inclus, c'est
//     justement ceux qui portent la connexion.
//
// Module SANS DÉPENDANCE : il met en forme et il filtre, il n'écrit rien.
// Testé par test/mediaCookies.test.js.
// ---------------------------------------------------------------------------

// Domaine enregistrable approximatif : « www.facebook.com » → « facebook.com ».
// Volontairement simple (deux derniers libellés, trois pour les suffixes
// composés courants) : il ne s'agit pas de faire une liste publique de
// suffixes, seulement de reconnaître qu'un cookie de « .facebook.com » vaut
// pour « web.facebook.com ».
const COMPOUND_SUFFIXES = new Set([
  'co.uk', 'com.au', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.mx', 'co.in',
  'com.tr', 'com.cn', 'com.tw', 'co.kr', 'com.ar', 'com.sg', 'co.il',
]);

export function registrableDomain(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (COMPOUND_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

// Le cookie `domain` s'applique-t-il à l'hôte visé ?
export function cookieMatchesHost(cookieDomain, hostname) {
  const raw = String(cookieDomain || '').trim().toLowerCase();
  const host = String(hostname || '').trim().toLowerCase();
  if (!raw || !host) return false;
  const bare = raw.replace(/^\./, '');
  return host === bare || host.endsWith(`.${bare}`);
}

// Cookies à transmettre pour cette URL : ceux de l'hôte, et ceux du domaine
// enregistrable dont il dépend. Rien d'autre ne sort.
export function selectCookiesForUrl(cookies, url) {
  let hostname = '';
  let insecureUrl = false;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    insecureUrl = parsed.protocol !== 'https:';
  } catch {
    return [];
  }
  if (!hostname) return [];
  const site = registrableDomain(hostname);

  return (Array.isArray(cookies) ? cookies : []).filter((cookie) => {
    if (!cookie?.name) return false;
    const domain = cookie.domain || '';
    if (!cookieMatchesHost(domain, hostname)) return false;
    // Garde-fou supplémentaire : un cookie dont le domaine sort du site visé
    // n'est jamais transmis, même si l'hôte y correspondait par accident.
    if (registrableDomain(domain.replace(/^\./, '')) !== site) return false;
    // Un cookie « secure » n'a rien à faire dans une requête en clair.
    if (insecureUrl && cookie.secure) return false;
    return true;
  });
}

// Format Netscape, le seul que yt-dlp sait lire (`--cookies`).
// Colonnes : domaine, tous-sous-domaines, chemin, sécurisé, expiration, nom,
// valeur — séparées par des tabulations.
//
// L'en-tête « # Netscape HTTP Cookie File » est obligatoire : sans elle
// yt-dlp refuse le fichier.
export function toNetscapeCookieFile(cookies, { now = Date.now() } = {}) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Écrit par Orbit pour yt-dlp — supprimé aussitôt après usage.',
    '',
  ];
  let kept = 0;
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (!cookie?.name) continue;
    const domain = String(cookie.domain || '');
    if (!domain) continue;
    // Une date d'expiration déjà passée ne sert à rien : le site l'ignorerait
    // et yt-dlp s'en servirait comme d'un cookie valide.
    const expires = Number(cookie.expirationDate);
    const hasExpiry = Number.isFinite(expires) && expires > 0;
    if (hasExpiry && expires * 1000 <= now) continue;
    // Les valeurs sont tabulées : une tabulation ou un saut de ligne dans un
    // nom ou une valeur casserait le fichier (et pourrait injecter une ligne).
    const name = String(cookie.name);
    const value = String(cookie.value ?? '');
    if (/[\t\r\n]/.test(name) || /[\t\r\n]/.test(value) || /[\t\r\n]/.test(domain)) continue;
    lines.push(
      [
        domain,
        domain.startsWith('.') ? 'TRUE' : 'FALSE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        // 0 = cookie de session, ce que yt-dlp comprend comme « sans fin ».
        hasExpiry ? String(Math.floor(expires)) : '0',
        name,
        value,
      ].join('\t')
    );
    kept += 1;
  }
  // Aucun cookie retenu : on ne crée pas de fichier pour rien. L'appelant
  // saute alors l'option `--cookies` au lieu de passer un fichier vide, que
  // yt-dlp signalerait comme une erreur.
  if (kept === 0) return null;
  return `${lines.join('\n')}\n`;
}
