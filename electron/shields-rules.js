// ---------------------------------------------------------------------------
// Règles d'application des Boucliers — logique PURE, sans Electron.
//
// Ce fichier ne connaît ni `session`, ni `webRequest`, ni le disque : il reçoit
// les réglages d'un site et une requête, et répond par une décision. main.js
// est le seul à translatedécision en appel réseau (redirection, annulation,
// retouche d'en-têtes).
//
// Pourquoi ce découpage : c'est la partie qui casse les sites quand elle est
// fausse. Isolée ici, elle se teste sans lancer Electron — voir
// test/shields-rules.test.js.
// ---------------------------------------------------------------------------

// Hôtes sans TLS : mettre à niveau une requête vers eux la casserait
// net (développeurs qui lancken service en local, box, NAS, imprimantes).
const LOCAL_HOSTS =
  /^(?:localhost|127(?:\.\d+){3}|\[?::1\]?|0\.0\.0\.0|\[?::\]?|.*\.local)$/i;

export { LOCAL_HOSTS };

// Types de ressources qui portent du JavaScript exécutable. 'object' couvre
// <embed>/<object> ; les images, polices et feuilles de style passent — sans
// CSS un site devient simplement laid, sans JS il devient souvent inutilisable.
const SCRIPT_TYPES = new Set(['script', 'object']);

// ---------------------------------------------------------------------------
// Étape 1 — onBeforeRequest
// ---------------------------------------------------------------------------
// Renvoie `null` pour laisser passer, sinon une action à exécuter par main.js :
//   { action: 'redirect', url, reason }
//   { action: 'cancel', reason, domain }
export function decideRequest(site, details) {
  if (!site || site.enabled === false) return null;

  const url = details.url;

  // Mise à niveau HTTPS — navigations de premier niveau UNIQUEMENT. Upgrader
  // les sous-ressources casserait tout site servant encore une image ou un
  // script en http, et le retour arrière vers http n'existe pas dans
  // onBeforeRequest (une redirection ratée = page morte, pas une page lente).
  if (site.httpsUpgrade === true && details.resourceType === 'mainFrame') {
    const up = upgradeToHttps(url);
    if (up) return { action: 'redirect', url: up, reason: 'https' };
  }

  if (site.blockScripts === true && SCRIPT_TYPES.has(details.resourceType)) {
    return {
      action: 'cancel',
      reason: 'script',
      domain: hostOf(url),
      resourceType: details.resourceType,
    };
  }

  return null;
}

// http:// → https:// pour une URL, sauf si l'hôte est local. Renvoie null
// quand rien à faire.
export function upgradeToHttps(url) {
  let u = null;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (LOCAL_HOSTS.test(u.hostname)) return null;
  u.protocol = 'https:';
  return u.toString();
}

// ---------------------------------------------------------------------------
// Étape 2 — onBeforeSendHeaders (cookies tiers + empreinte)
// ---------------------------------------------------------------------------
// `siteDomain` = domaine enregistrable du site de premier niveau (ex.
// 'example.com'), `reqDomain` = celui de la requête (ex. 'cdn.net').
// Renvoie true si l'en-tête Cookie doit être SUPPRIMÉ de la requête.
export function shouldStripCookieHeader(site, siteDomain, reqDomain) {
  if (!site || site.enabled === false) return false;
  if (site.cookies === 'allow') return false;
  if (site.cookies === 'all') return true;
  return !isSameSite(siteDomain, reqDomain);
}

// Renvoie true si le Set-Cookie de la réponse doit être refusé. Même prédicat
// que pour l'envoi : ce qui n'est pas renvoyé ne doit pas être déposé, sinon
// Chromium le garderait et le renverrait à la requête suivante.
export function shouldStripSetCookie(site, siteDomain, reqDomain) {
  return shouldStripCookieHeader(site, siteDomain, reqDomain);
}

// « same-site » au sens du SITE affiché, pas de l'URL : c'est ce que fait un
// navigateur et c'est ce qu'attend l'utilisateur. Un domaine inconnu des deux
// côtés (localhost, IP) est considéré comme tiers : mieux vaut un cookie en
// trop qu'un cookie absent.
export function isSameSite(siteDomain, reqDomain) {
  if (!siteDomain || !reqDomain) return false;
  return siteDomain === reqDomain;
}

// ---------------------------------------------------------------------------
// Étape 3 — en-têtes de réduction d'empreinte
// ---------------------------------------------------------------------------
// En-têtes retirés, jamais modifiés : c'est ce qui distingue 'standard'.
// Aucun n'est utilisé par le moteur de rendu pour AFFICHER la page — les
// supprimer ne change rien au rendu, seulement ce que le site peut mesurer.
const HIGH_ENTROPY_HINTS = [
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-wow64',
  'sec-ch-ua-mobile',
];

// En plus en 'strict' : la version complète du navigateur, premier signal de
// corrélation, et l'en-tête de contraste lisibilité.
const STRICT_ONLY = ['sec-ch-ua-full-version'];

// Liste des en-têtes que la règle demande de retirer pour ces réglages.
// Renvoie les CLÉS PRESENTES dans `headers` (casse d'origine conservée), ce qui
// évite à l'appelant de reparcourir l'objet.
export function headersToStrip(site, headers) {
  const out = [];
  if (!site || site.enabled === false || !headers) return out;
  const strict = site.fingerprinting === 'strict';
  if (site.fingerprinting === 'off') return out;
  const wanted = strict ? [...HIGH_ENTROPY_HINTS, ...STRICT_ONLY] : HIGH_ENTROPY_HINTS;
  const lower = new Map();
  for (const key of Object.keys(headers)) lower.set(key.toLowerCase(), key);
  for (const hint of wanted) {
    const actual = lower.get(hint);
    if (actual) out.push(actual);
  }
  return out;
}

// En-têtes à AJOUTER (standard : aucun ; strict : DNT).
export function headersToAdd(site) {
  if (!site || site.enabled === false) return {};
  if (site.fingerprinting === 'strict') return { DNT: '1' };
  return {};
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}