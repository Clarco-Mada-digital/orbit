import { reloadUrlFor } from './urls.js';

// Registre des <webview> par appId — permet à la Topbar de piloter
// l'app active (retour, avant, recharger, navigation) sans IPC.
const registry = new Map();

export function registerWebview(appId, webview) {
  registry.set(appId, webview);
}

export function unregisterWebview(appId) {
  registry.delete(appId);
}

export function getWebview(appId) {
  return registry.get(appId) || null;
}

// Identifiant du webContents d'une app, ou null si elle n'est pas encore
// interrogeable. `getWebContentsId` LÈVE une exception tant que le <webview>
// n'est pas attaché au DOM et n'a pas émis `dom-ready` — ce qui est
// systématiquement le cas pendant un rendu. Les appels doivent donc passer par
// ici : les boutons de la Topbar sont rendus avant que la page ait fini de
// démarrer, et une exception à ce moment-là ferait tomber tout le <Topbar>
// (et non seulement le bouton concerné) dans l'ErrorBoundary.
export function getWebContentsIdFor(appId) {
  const wv = registry.get(appId);
  if (!wv) return null;
  try {
    return wv.getWebContentsId();
  } catch {
    return null;
  }
}

// Toutes les <webview> montées (apps ouvertes/vivantes). Sert à recharger les
// pages après un changement d'extensions : les content scripts ne s'injectent
// que lors d'une navigation POSTÉRIEURE au chargement de l'extension.
export function getAllWebviews() {
  return Array.from(registry.values());
}

// Paires [appId, webview] des apps montées — pour recharger une app avec son
// URL nettoyée (jetons éphémères retirés) au lieu d'un reload aveugle.
export function getRegisteredWebviews() {
  return Array.from(registry.entries());
}


// Envoie une app montée sur une URL précise. Utilisé par la recherche
// transverse : rouvrir une page de l'historique DANS son app d'origine, pour
// profiter de sa session (une page volante demanderait de se reconnecter).
// Renvoie false si l'app n'est pas montée — l'appelant se replie alors sur une
// page volante.
export function navigateApp(appId, url) {
  const wv = getWebview(appId);
  if (!wv || !url) return false;
  try {
    wv.loadURL(url);
    return true;
  } catch {
    return false;
  }
}

// Recharge la page d'une app montée. Logique unique partagée par le bouton
// « Actualiser » de la Topbar, le menu contextuel et le raccourci Ctrl+R :
//   • URL nettoyée de ses jetons éphémères (CSRF Roundcube, code OAuth…) →
//     un reload brut rejouerait un jeton périmé = page d'erreur/blanche ;
//   • `hard` (Ctrl+⇧+R / ⇧F5) ignore le cache — utile quand une app affiche
//     une version périmée de son interface.
export function reloadApp(appId, url, hard = false) {
  const wv = getWebview(appId);
  if (!wv) return false;
  try {
    if (hard) {
      wv.reloadIgnoringCache();
      return true;
    }
    const clean = reloadUrlFor(url);
    if (clean) wv.loadURL(clean);
    else wv.reload();
    return true;
  } catch {
    return false;
  }
}
