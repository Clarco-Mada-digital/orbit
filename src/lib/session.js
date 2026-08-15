// Détermine la partition Electron (le « coffre à cookies ») d'une app.
//
// Deux modes, selon le profil :
//   • Profil NORMAL (défaut) : chaque app a sa propre partition
//     (`persist:<sessionKey>`) → sessions isolées, on peut avoir plusieurs
//     comptes d'un même service (2 Gmail) dans le profil.
//   • Profil PARTAGÉ (sharedSession) : toutes les apps du profil partagent
//     `persist:<profileId>` → comportement « navigateur » : se connecter à
//     Google dans Gmail vaut pour YouTube, Drive… (SSO), plus de 2FA à répéter.
export function appPartition(app, sharedSession) {
  // Conteneur explicite (type Firefox) : prioritaire, partagé entre les apps
  // du même conteneur (plusieurs comptes d'un même service possibles).
  if (app.containerId) return `persist:ctn:${app.containerId}`;
  if (sharedSession) return `persist:${app.profileId}`;
  return `persist:${app.sessionKey || `${app.profileId}:${app.id}`}`;
}

// Proxy/VPN effectif d'une app : override de l'app > proxy du profil > proxy
// global. Chaîne vide = connexion directe. Format attendu par Electron, ex.
// "socks5://127.0.0.1:1080" ou "http=host:port;https=host:port".
export function resolveProxy(app, profile, globalProxy) {
  return (app?.proxy || profile?.proxy || globalProxy || '').trim();
}

// Clé React d'une app : doit changer quand la partition change (conteneur /
// isolée / partagée) pour forcer le remontage du <webview> avec le bon coffre.
export function appViewKey(app, sharedSession) {
  if (app.containerId) return `${app.id}:ctn:${app.containerId}`;
  return sharedSession ? `${app.id}:shared` : app.id;
}
