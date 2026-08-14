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
