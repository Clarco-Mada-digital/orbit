import { reloadUrlFor } from './urls';

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
