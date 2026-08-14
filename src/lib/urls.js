// Aides URL : une app ne doit JAMAIS redémarrer sur une page de connexion.
//
// Deux cas bien distincts :
// 1. PAGES DE CONNEXION (signin, 2FA, challenge, OAuth…) : des pages mortes
//    au redémarrage → on repart de la « maison » (les cookies font le reste).
// 2. JETONS DE SÉCURITÉ DANS L'URL (cpsess de cPanel, ?token=, session…) :
//    ce sont des pages AUTHENTIFIÉES, pas des pages de connexion. On les
//    RESTAURE telles quelles, sinon il faut se reconnecter à chaque retour
//    dans l'app alors que la session est encore valide.

// Chemins caractéristiques des pages de connexion / flux d'authentification
// (challenges, 2FA, formulaires…) — jamais restaurées.
export function isLoginPageUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    // Toute la page de connexion Google (accounts.google.com)
    if (host === 'accounts.google.com') return true;
    return /(signin|sign-in|login|log-in|\bauth\b|oauth|authorize|challenge|two-factor|2fa|verify|otp|identifier|servicelogin|sessions\/|forgot|reset)/.test(
      path
    );
  } catch {
    return true;
  }
}

// URL contenant un jeton de sécurité : page AUTHENTIFIÉE à restaurer
// (ex. cpsess<code> dans le chemin de cPanel, token= dans la query…).
export function isTokenUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const search = u.search.toLowerCase();
    return (
      /cpsess\d+/.test(path) ||
      /(token=|sid=|session=|authkey|signature=|code=|access_token)/.test(search)
    );
  } catch {
    return false;
  }
}

// URL de démarrage « maison » : l'origine du site si l'URL fournie est une
// page de connexion éphémère, sinon l'URL telle quelle.
export function homeUrlFor(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    return isLoginPageUrl(url) ? u.origin : url;
  } catch {
    return url;
  }
}

// Même hôte (domaine) entre deux URL ?
function sameHost(a, b) {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

// URL effective au lancement d'une app :
//   - URL à jeton → on la RESTAURE (session encore valide, pas de reconnexion)
//   - jamais une page de connexion → on repart de la « maison »
//   - URL persistée sur un AUTRE domaine que la « maison » (ex. widget
//     contacts.google.com capturé par erreur dans l'app Gmail) → URL parasite,
//     on repart de la maison (corrige aussi les données déjà polluées)
//   - sinon on reprend la dernière URL visitée (reprise du contexte)
export function computeStartUrl(app, recipes) {
  const recipeUrl = app.recipeId ? recipes[app.recipeId]?.url : undefined;
  let home = app.homeUrl || recipeUrl || app.url;
  // Apps personnalisées ajoutées avec une URL à jeton éphémère : la « maison »
  // reste l'origine du site si c'est une page de connexion.
  if (isLoginPageUrl(home)) home = homeUrlFor(home);
  if (isTokenUrl(app.url)) return app.url;
  if (home && app.url && !sameHost(home, app.url)) return home;
  return isLoginPageUrl(app.url) ? home : app.url;
}
