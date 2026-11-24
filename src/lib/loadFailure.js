// ---------------------------------------------------------------------------
// Échecs de chargement d'une page — logique PURE.
//
// Pourquoi ce fichier existe : jusqu'ici, un `did-fail-load` ne produisait
// qu'un `console.warn` et une ligne de diagnostic. L'utilisateur, lui, voyait
// un cadre VIDE — sans savoir si le site était en panne, si Orbit avait planté,
// ou s'il devait attendre. Un navigateur, dans la même situation, explique et
// propose un geste. C'est ce que ce module permet : traduire un code d'erreur
// réseau de Chromium en « ce qui s'est passé » et « ce qu'on peut y faire ».
//
// Les codes viennent de net/base/net_error_list.h (Chromium). On n'en couvre
// qu'une partie : ceux qu'une app web rencontre vraiment. Tout le reste tombe
// sur un message générique — jamais sur du vide.
//
// Ce module ne connaît ni React ni Electron : il se teste sous `node --test`
// tel quel (voir test/loadFailure.test.js).
// ---------------------------------------------------------------------------

// Navigation remplacée par une autre (redirections normales de Gmail, Slack…).
// Bénin : ce n'est PAS un échec, il ne doit rien afficher.
export const ERR_ABORTED = -3;

// Boucle de redirection — traitée à part (purge des cookies de l'hôte), voir
// WebView.jsx. Elle a sa propre récupération automatique.
export const ERR_TOO_MANY_REDIRECTS = -310;

// Natures de panne. Elles commandent le texte ET les boutons proposés :
//   cert    — le certificat TLS est refusé (auto-signé, expiré, mauvais nom)
//   tls     — l'hôte ne sait pas parler HTTPS (ou pas une version acceptée)
//   dns     — le nom n'existe pas / ne se résout pas
//   offline — pas de réseau du tout
//   refused — l'hôte répond « non » (port fermé, service arrêté)
//   timeout — l'hôte ne répond pas
//   server  — la connexion a abouti mais la réponse est inutilisable
//   proxy   — le proxy configuré ne répond pas
//   unknown — tout le reste
const FAILURES = {
  '-2': { kind: 'unknown', name: 'ERR_FAILED', title: 'Le chargement a échoué' },
  '-20': { kind: 'unknown', name: 'ERR_BLOCKED_BY_CLIENT', title: 'Page bloquée par Orbit' },
  '-120': { kind: 'refused', name: 'ERR_SOCKS_CONNECTION_FAILED', title: 'Connexion impossible par le tunnel' },
  '-6': { kind: 'server', name: 'ERR_FILE_NOT_FOUND', title: 'Fichier introuvable' },
  '-7': { kind: 'timeout', name: 'ERR_TIMED_OUT', title: 'Le site ne répond pas' },
  '-15': { kind: 'server', name: 'ERR_SOCKET_NOT_CONNECTED', title: 'Connexion interrompue' },
  '-21': { kind: 'offline', name: 'ERR_NETWORK_CHANGED', title: 'Le réseau a changé' },
  '-100': { kind: 'server', name: 'ERR_CONNECTION_CLOSED', title: 'Connexion fermée par le site' },
  '-101': { kind: 'server', name: 'ERR_CONNECTION_RESET', title: 'Connexion réinitialisée' },
  '-102': { kind: 'refused', name: 'ERR_CONNECTION_REFUSED', title: 'Connexion refusée' },
  '-104': { kind: 'refused', name: 'ERR_CONNECTION_FAILED', title: 'Connexion impossible' },
  '-105': { kind: 'dns', name: 'ERR_NAME_NOT_RESOLVED', title: 'Adresse introuvable' },
  '-106': { kind: 'offline', name: 'ERR_INTERNET_DISCONNECTED', title: 'Pas de connexion Internet' },
  '-107': { kind: 'tls', name: 'ERR_SSL_PROTOCOL_ERROR', title: 'Ce site ne gère pas HTTPS' },
  '-109': { kind: 'refused', name: 'ERR_ADDRESS_UNREACHABLE', title: 'Adresse inaccessible' },
  '-113': { kind: 'tls', name: 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH', title: 'Chiffrement incompatible' },
  '-118': { kind: 'timeout', name: 'ERR_CONNECTION_TIMED_OUT', title: 'Délai de connexion dépassé' },
  '-130': { kind: 'proxy', name: 'ERR_PROXY_CONNECTION_FAILED', title: 'Le proxy ne répond pas' },
  '-137': { kind: 'dns', name: 'ERR_NAME_RESOLUTION_FAILED', title: 'Adresse introuvable' },
  '-200': { kind: 'cert', name: 'ERR_CERT_COMMON_NAME_INVALID', title: 'Certificat au mauvais nom' },
  '-201': { kind: 'cert', name: 'ERR_CERT_DATE_INVALID', title: 'Certificat expiré' },
  '-202': { kind: 'cert', name: 'ERR_CERT_AUTHORITY_INVALID', title: 'Certificat non reconnu' },
  '-203': { kind: 'cert', name: 'ERR_CERT_CONTAINS_ERRORS', title: 'Certificat invalide' },
  '-204': { kind: 'cert', name: 'ERR_CERT_NO_REVOCATION_MECHANISM', title: 'Certificat invérifiable' },
  '-205': { kind: 'cert', name: 'ERR_CERT_UNABLE_TO_CHECK_REVOCATION', title: 'Certificat invérifiable' },
  '-206': { kind: 'cert', name: 'ERR_CERT_REVOKED', title: 'Certificat révoqué' },
  '-207': { kind: 'cert', name: 'ERR_CERT_INVALID', title: 'Certificat invalide' },
  '-208': { kind: 'cert', name: 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM', title: 'Certificat trop faible' },
  '-210': { kind: 'cert', name: 'ERR_CERT_NON_UNIQUE_NAME', title: 'Certificat au nom ambigu' },
  '-211': { kind: 'cert', name: 'ERR_CERT_WEAK_KEY', title: 'Clé du certificat trop faible' },
  '-212': { kind: 'cert', name: 'ERR_CERT_NAME_CONSTRAINT_VIOLATION', title: 'Certificat non autorisé pour ce nom' },
  '-213': { kind: 'cert', name: 'ERR_CERT_VALIDITY_TOO_LONG', title: 'Certificat valable trop longtemps' },
  '-324': { kind: 'server', name: 'ERR_EMPTY_RESPONSE', title: 'Le site n’a rien renvoyé' },
  '-501': { kind: 'cert', name: 'ERR_INSECURE_RESPONSE', title: 'Réponse non sécurisée' },
};

// Explication par nature, à la deuxième personne et sans jargon : c'est ce que
// l'utilisateur lit à la place de la page blanche.
const DETAILS = {
  cert:
    'Le certificat de sécurité de ce site n’est pas valide. La connexion serait bien chiffrée, mais rien ne prouve que vous parlez au bon serveur.',
  tls:
    'Ce serveur ne propose pas de connexion chiffrée (HTTPS). Orbit a tenté HTTPS d’abord, comme le fait un navigateur.',
  dns: 'Ce nom de domaine n’a pas pu être traduit en adresse. Vérifiez l’orthographe de l’adresse.',
  offline: 'Orbit n’a pas accès au réseau. Vérifiez votre connexion, puis réessayez.',
  refused:
    'Le serveur a refusé la connexion. Il est peut-être arrêté, ou il n’écoute pas sur ce port.',
  timeout: 'Le serveur a mis trop de temps à répondre. Il est peut-être surchargé ou injoignable.',
  server:
    'La connexion a bien été établie, mais la réponse du serveur est inutilisable. L’erreur vient du site.',
  proxy: 'Le proxy configuré pour ce profil ne répond pas. Vérifiez ses réglages.',
  unknown: 'Orbit n’a pas pu charger cette page.',
};

// Décrit un échec de chargement. `code` est l'`errorCode` d'un `did-fail-load`.
// Renvoie toujours un objet exploitable — jamais null, jamais de champ vide.
//
// `upgraded` : le bouclier a réécrit l'adresse de http vers https avant cet
// échec. Sans cette nuance, le message accuse le site à tort. Cas vécu : on
// demande http://neverssl.com, le bouclier tente https, le port 443 ne répond
// rien, et l'utilisateur lit « Le site n'a rien renvoyé — l'erreur vient du
// site ». C'est faux : le site répond très bien en http, c'est NOTRE mise à
// niveau qui n'aboutit pas.
//
// Les échecs de CERTIFICAT gardent leur message propre même après mise à
// niveau : le serveur parle bien TLS, il présente simplement un certificat
// qu'on refuse — « ce site ne gère pas HTTPS » serait faux dans l'autre sens.
//
// `network` : réseau privé de l'app ('tor' | 'vpn' | null) et `url` : adresse
// demandée. Ils expliquent deux échecs qui sont des PROTECTIONS, pas des pannes :
//   - une adresse .onion hors de Tor (bloquée pour ne pas la révéler au FAI) ;
//   - une app réglée sur Tor ou VPN alors que le moteur n'est pas connecté
//     (rien ne part en direct, par conception).
const NETWORK_NAMES = { tor: 'Tor', vpn: 'Le VPN' };

function isOnion(url) {
  try {
    return /\.onion\.?$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function describeLoadFailure(code, description = '', { upgraded = false, url = '', network = null } = {}) {
  const num = Number(code);
  const known = FAILURES[String(num)];
  const kind = known ? known.kind : 'unknown';
  if (isOnion(url) && network !== 'tor') {
    return {
      code: num,
      name: known ? known.name : `ERR_${num}`,
      kind: 'onion',
      title: 'Adresse .onion : il faut Tor',
      detail:
        'Les sites en .onion ne sont joignables que par le réseau Tor. Orbit a bloqué la page sans rien envoyer : une tentative normale aurait révélé l’adresse à votre fournisseur d’accès.',
    };
  }
  if (NETWORK_NAMES[network] && (num === -130 || num === -20 || (num === -120 && !isOnion(url)))) {
    return {
      code: num,
      name: known ? known.name : `ERR_${num}`,
      kind: 'privnet',
      network,
      title: `${NETWORK_NAMES[network]} n’est pas connecté`,
      detail: `Cette app passe par ${network === 'tor' ? 'Tor' : 'le VPN'}. Tant qu’il n’est pas connecté, rien ne part par la connexion normale — c’est voulu, pour ne jamais exposer votre adresse.`,
    };
  }
  if (network === 'tor' && num === -120 && isOnion(url)) {
    return {
      code: num,
      name: 'ERR_SOCKS_CONNECTION_FAILED',
      kind: 'timeout',
      title: 'Ce site .onion ne répond pas',
      detail: 'Tor est connecté, mais ce service caché est injoignable : il est peut-être hors ligne, ou l’adresse est erronée. Les sites .onion changent souvent.',
    };
  }
  if (upgraded && kind !== 'cert' && HTTP_FALLBACK_KINDS.has(kind)) {
    return {
      code: num,
      name: known ? known.name : String(description || '').trim() || `ERR_${num}`,
      kind,
      title: 'Ce site ne gère pas HTTPS',
      detail:
        'Orbit a d’abord essayé une connexion chiffrée, comme le fait un navigateur, et ce serveur ne l’accepte pas. Le site fonctionne sans doute très bien sans chiffrement.',
    };
  }
  return {
    code: num,
    // `errorDescription` d'Electron porte déjà le nom Chromium quand on le
    // connaît ; on garde le nôtre en repli pour que le diagnostic soit lisible
    // même sur un code non répertorié.
    name: known ? known.name : String(description || '').trim() || `ERR_${num}`,
    kind,
    title: known ? known.title : 'Le chargement a échoué',
    detail: DETAILS[kind],
  };
}

// Un échec de certificat se « contourne » : on peut décider de faire confiance
// à cet hôte. Les autres natures, non — réessayer est le seul geste utile.
export function isCertificateFailure(code) {
  return describeLoadFailure(code).kind === 'cert';
}

// Faut-il proposer « continuer en HTTP non sécurisé » ?
//
// Seulement quand la navigation a été MISE À NIVEAU par le bouclier HTTPS :
// sans cela, l'offre n'a aucun sens (l'URL était déjà en http).
//
// Et seulement pour les pannes qu'un retour en http peut réellement résoudre.
// `dns` et `offline` sont exclus : le nom introuvable ou le réseau absent
// seront tout aussi introuvables et absents en http — proposer le geste
// donnerait un faux espoir, puis un second échec.
const HTTP_FALLBACK_KINDS = new Set(['tls', 'cert', 'refused', 'timeout', 'server', 'unknown']);

export function canFallBackToHttp(code, { upgraded }) {
  if (!upgraded) return false;
  return HTTP_FALLBACK_KINDS.has(describeLoadFailure(code).kind);
}

// Échec à AFFICHER ? Les deux codes traités ailleurs ne doivent jamais ouvrir
// une interstitielle : -3 est bénin, -310 a sa propre récupération.
export function isDisplayableFailure(code) {
  const num = Number(code);
  return num !== ERR_ABORTED && num !== ERR_TOO_MANY_REDIRECTS;
}

// Hôte affichable d'une URL, pour le titre de l'interstitielle. Chaîne vide si
// l'URL est illisible — l'appelant retombe alors sur le nom de l'app.
export function hostLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
