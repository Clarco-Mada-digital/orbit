// UA Chrome AUTHENTIQUE pour les <webview>.
//
// Electron ajoute un jeton produit à l'UA d'après le nom de l'app :
// « … Orbit/1.0.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36 ».
// WhatsApp refuse de démarrer dès qu'un jeton inconnu s'y trouve — pas
// seulement « Electron », « Orbit » aussi (« WhatsApp fonctionne avec Google
// Chrome 100 ou version ultérieure »), et Google y voit un navigateur non
// sécurisé. On reconstruit donc l'UA exacte du vrai Chrome : segment
// plate-forme d'origine, version réduite (Chrome/130.0.0.0 depuis la v101),
// aucun jeton produit.
//
// Le main process pose la même valeur sur chaque webview avant navigation
// (CHROME_UA dans electron/main.js) et aligne les en-têtes Sec-CH-UA ;
// keepass-preload.cjs aligne navigator.userAgentData. Les trois sources
// doivent rester cohérentes — c'est le fond du problème WhatsApp/Google.
export function authenticChromeUA(rawUA) {
  const ua = String(rawUA || '');
  const platform = (ua.match(/\(([^)]*)\)/) || [])[1] || 'X11; Linux x86_64';
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1] || '130';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export const CHROME_UA =
  typeof navigator !== 'undefined' ? authenticChromeUA(navigator.userAgent) : undefined;
