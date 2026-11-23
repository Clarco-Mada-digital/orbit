// ---------------------------------------------------------------------------
// « Pourquoi cette vidéo ne se lit pas » — logique PURE.
//
// Quatre causes très différentes produisent exactement le même écran noir :
//   1. le contenu est protégé par DRM (Widevine) — Electron ne l'embarque pas,
//      donc Orbit ne peut pas le lire, et ne pourra pas sans changer de socle ;
//   2. le bloqueur de pub a annulé un segment ;
//   3. le bouclier a retiré le cookie, et le CDN a refusé ;
//   4. le serveur a répondu une erreur, ou le format est illisible.
//
// Les trois dernières se corrigent en deux clics QUAND ON SAIT laquelle c'est.
// D'où ce module : il prend ce qu'on a observé (l'erreur du <video>, les
// requêtes de média en échec) et en tire la cause la plus probable, avec le
// geste correspondant.
//
// Aucune dépendance : testé sous `node --test` (voir test/mediaFault.test.js).
// ---------------------------------------------------------------------------

// Codes de HTMLMediaElement.error.code
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

// Hôte lisible, pour nommer le coupable dans le message. Chaîne vide si l'URL
// est illisible — le message reste valable sans.
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// `watch`     : { drm: bool, error: { code, message } | null } lu dans la page
// `failures`  : journal des requêtes de média en échec (le plus récent d'abord)
//
// Renvoie null quand il n'y a rien à dire — c'est le cas le plus fréquent et il
// doit rester silencieux : une bannière qui s'affiche à tort sur une vidéo qui
// marche est pire que pas de bannière du tout.
export function describeMediaFault({ drm = false, error = null, failures = [] } = {}) {
  const list = Array.isArray(failures) ? failures : [];

  // 1. DRM — prioritaire, car c'est la seule cause qu'aucun réglage ne corrige.
  //    Le dire tout de suite évite de faire chercher l'utilisateur dans les
  //    boucliers pour un problème qui n'y est pas.
  if (drm) {
    return {
      kind: 'drm',
      title: 'Vidéo protégée (DRM)',
      detail:
        'Ce site chiffre sa vidéo avec un DRM (Widevine). Le socle technique d’Orbit ne contient pas ce module : la lecture est impossible ici, quels que soient les réglages.',
      action: 'browser',
    };
  }

  // L'abandon est un geste NORMAL (on change de vidéo, on quitte la page) :
  // il ne doit jamais rien afficher.
  const hasRealError = error && error.code !== MEDIA_ERR_ABORTED;

  // 2. Un segment annulé par le bloqueur : c'est nous, et c'est réglable par
  //    app en un clic.
  const blocked = list.find((f) => f.reason === 'blocked');
  if (blocked) {
    const host = hostOf(blocked.url);
    return {
      kind: 'blocked',
      title: 'Vidéo bloquée par le bloqueur de publicités',
      detail: `Un segment de la vidéo${host ? ` (${host})` : ''} a été annulé par les listes de filtrage. Coupez le bloqueur pour cette app, puis rechargez.`,
      action: 'shields',
    };
  }

  // 3. Cookie retiré par le bouclier, puis refus du CDN. Le plus trompeur des
  //    quatre : le site semble refuser alors que c'est nous qui avons enlevé
  //    de quoi l'autoriser.
  const stripped = list.find((f) => f.cookieStripped);
  if (stripped) {
    const host = hostOf(stripped.url);
    return {
      kind: 'cookie',
      title: 'Vidéo refusée après filtrage des cookies',
      detail: `${host || 'Le serveur de vidéo'} a répondu ${stripped.status || 'une erreur'} à une requête dont le bouclier avait retiré le cookie. Autorisez les cookies pour ce site, puis rechargez.`,
      action: 'shields',
    };
  }

  // 4. Le serveur a simplement refusé : l'erreur vient du site, pas d'Orbit.
  //    On le dit, pour éviter de chercher chez nous.
  const refused = list.find((f) => f.reason === 'status' && f.status >= 400);
  if (refused) {
    const host = hostOf(refused.url);
    return {
      kind: 'status',
      title: `Le serveur de vidéo a répondu ${refused.status}`,
      detail: `${host || 'Le serveur'} a refusé la vidéo. L’erreur vient du site : le lien a peut-être expiré, ou il faut se reconnecter.`,
      action: 'reload',
    };
  }

  // 5. Rien côté réseau : on s'en tient à ce que dit le lecteur.
  if (hasRealError) {
    if (error.code === MEDIA_ERR_NETWORK) {
      return {
        kind: 'network',
        title: 'Téléchargement de la vidéo interrompu',
        detail:
          'La vidéo a commencé à se charger puis s’est arrêtée. Le plus souvent, la connexion a été coupée en cours de route.',
        action: 'reload',
      };
    }
    if (error.code === MEDIA_ERR_DECODE) {
      return {
        kind: 'decode',
        title: 'Vidéo illisible',
        detail: 'Le flux reçu est corrompu ou tronqué. Rechargez la page pour le redemander.',
        action: 'reload',
      };
    }
    if (error.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
      return {
        kind: 'source',
        title: 'Source vidéo inaccessible',
        detail:
          'Le lecteur n’a pas pu ouvrir la vidéo. Son adresse est peut-être expirée, ou le site attend une session valide.',
        action: 'reload',
      };
    }
    return {
      kind: 'unknown',
      title: 'La vidéo ne s’est pas lancée',
      detail: String(error.message || '').trim() || 'Le lecteur n’a donné aucune raison.',
      action: 'reload',
    };
  }

  return null;
}

// Signature stable d'une panne : sert à ne consigner qu'UNE ligne de diagnostic
// par panne, et à ne pas ré-afficher la bannière que l'utilisateur vient de
// fermer tant que c'est le même problème. Le sondage média tourne toutes les
// secondes — sans cela, Diagnostics se remplirait de la même ligne.
export function mediaFaultKey(fault) {
  if (!fault) return '';
  return `${fault.kind}|${fault.title}`;
}
