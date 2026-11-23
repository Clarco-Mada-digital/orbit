// ---------------------------------------------------------------------------
// Ce qu'une extension Chrome ne pourra PAS faire dans Orbit — logique PURE.
//
// Electron n'implémente qu'une partie des API `chrome.*`. Une extension dont
// une fonction repose sur une API absente ne plante pas : elle ne fait
// simplement RIEN, en silence. D'où ces avertissements, affichés au moment de
// l'installation.
//
// ---------------------------------------------------------------------------
// Les listes ci-dessous sont MESURÉES, pas supposées
// ---------------------------------------------------------------------------
// Relevé sur Electron 43.8.3 en chargeant une extension Manifest V3 déclarant
// toutes ces permissions, puis en inventoriant `chrome.*` DANS son service
// worker. Point important découvert à cette occasion : plusieurs API
// n'existent QUE si l'extension a déclaré la permission correspondante — un
// inventaire fait sans les déclarer conclut à tort qu'elles manquent.
//
// Ce que le relevé a corrigé, et qui était faux dans les avertissements
// précédents :
//   • les service workers Manifest V3 DÉMARRENT et tournent (on annonçait
//     l'inverse, et on conseillait de revenir au Manifest V2) ;
//   • `declarativeNetRequest` fonctionne, règles dynamiques comprises : une
//     requête visée est bien refusée (ERR_BLOCKED_BY_CLIENT). On annonçait
//     l'inverse, et on envoyait l'utilisateur vers une version « classique »
//     qui n'existe plus chez la plupart des éditeurs.
//
// À revérifier à chaque montée de version majeure d'Electron : une API qui
// arrive doit sortir de cette liste, sinon on continue d'avertir pour rien.
// ---------------------------------------------------------------------------

// Permissions dont l'API `chrome.<nom>` est ABSENTE, même déclarée.
const UNSUPPORTED_PERMISSIONS = new Set([
  'contextMenus',
  'cookies',
  'notifications',
  'downloads',
  'bookmarks',
  'history',
  'webNavigation',
  'omnibox',
  'sidePanel',
  'permissions',
  'topSites',
  'privacy',
  'search',
]);

// Nom lisible de ce que l'utilisateur perd, pour les permissions dont
// l'absence a une conséquence visible et facile à décrire.
const CONSEQUENCES = {
  contextMenus: 'ses entrées de menu au clic droit',
  notifications: 'ses notifications',
  cookies: 'sa lecture des cookies',
  downloads: 'ses téléchargements',
  bookmarks: 'ses favoris',
  history: 'son accès à l’historique',
  webNavigation: 'son suivi de navigation',
  omnibox: 'ses raccourcis dans la barre d’adresse',
  sidePanel: 'son panneau latéral',
};

// Clés de manifeste sans équivalent dans Orbit.
const UNSUPPORTED_KEYS = {
  commands: 'ses raccourcis clavier propres',
  devtools_page: 'son panneau dans les outils de développement',
  chrome_url_overrides: 'son remplacement des pages internes du navigateur',
  side_panel: 'son panneau latéral',
};

// Liste en français, avec « et » avant le dernier élément.
function enumerate(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

// Avertissements à montrer pour ce manifeste. Tableau vide = rien à signaler,
// et c'est le cas qu'on veut le plus souvent : un avertissement affiché à tort
// (c'était le cas pour toute extension Manifest V3) apprend à l'utilisateur à
// ne plus les lire.
export function extensionWarnings(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const perms = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : []),
  ].map(String);

  const warnings = [];

  // Native messaging : Electron n'héberge aucun hôte de messagerie native, et
  // ce n'est pas une question de version — il n'y a rien à attendre.
  if (perms.includes('nativeMessaging')) {
    warnings.push(
      'Cette extension dialogue avec un logiciel installé sur la machine (native messaging). Orbit ne peut pas faire ce pont : cette partie restera inactive.'
    );
  }

  // Permissions dont l'API manque. On les regroupe en UNE ligne : trois
  // avertissements séparés pour une même extension, personne ne les lit.
  const missing = [...new Set(perms.filter((p) => UNSUPPORTED_PERMISSIONS.has(p)))];
  const described = missing.filter((p) => CONSEQUENCES[p]);
  if (described.length) {
    warnings.push(
      `Orbit ne fournit pas ${enumerate(described.map((p) => CONSEQUENCES[p]))} : ces fonctions resteront sans effet. Le reste de l’extension fonctionne normalement.`
    );
  }
  const plain = missing.filter((p) => !CONSEQUENCES[p]);
  if (plain.length) {
    warnings.push(
      `API non disponibles dans Orbit : ${enumerate(plain)}. Les fonctions qui en dépendent resteront sans effet.`
    );
  }

  // Clés de manifeste sans équivalent.
  const keys = Object.keys(UNSUPPORTED_KEYS).filter((k) => manifest[k]);
  if (keys.length) {
    warnings.push(
      `Orbit ne prend pas en charge ${enumerate(keys.map((k) => UNSUPPORTED_KEYS[k]))}.`
    );
  }

  return warnings;
}

// Exporté pour les tests et pour documenter le relevé : c'est la liste qu'il
// faut rejouer à chaque montée d'Electron.
export const UNSUPPORTED = {
  permissions: [...UNSUPPORTED_PERMISSIONS],
  manifestKeys: Object.keys(UNSUPPORTED_KEYS),
};
