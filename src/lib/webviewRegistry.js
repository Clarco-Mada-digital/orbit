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

