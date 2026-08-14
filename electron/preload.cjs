const { contextBridge, ipcRenderer } = require('electron');

// API exposée à l'interface React (fenêtre uniquement).
// La navigation des apps passe par les <webview> côté DOM.
// NB : pas de __dirname ici — les preloads sandboxés ne l'ont pas.
// Le preload des <webview> (KeePassXC) est injecté par le main process
// dans l'événement 'will-attach-webview' (il connaît, lui, son chemin).
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  // Notifications système + badge de la fenêtre
  showNotification: (payload) => ipcRenderer.invoke('notifications:show', payload),
  setBadgeCount: (count) => ipcRenderer.invoke('notifications:setBadge', count),
  // Purge cookies/session d'un compte désinstallé
  clearAppSession: (profileId, appId) => ipcRenderer.invoke('sessions:clear', { profileId, appId }),
  // Extensions Chrome
  syncExtensions: (list) => ipcRenderer.invoke('extensions:sync', list),
  installWebStoreExtension: (idOrUrl) => ipcRenderer.invoke('extensions:installWebStore', { idOrUrl }),
  openExtensionOptions: (payload) => ipcRenderer.invoke('extensions:openOptions', payload),
  getExtensionInfo: (payload) => ipcRenderer.invoke('extensions:getInfo', payload),
  pickExtensionFolder: () => ipcRenderer.invoke('extensions:pickFolder'),
  pickExtensionCrx: () => ipcRenderer.invoke('extensions:pickCrx'),
  installExtension: (payload) => ipcRenderer.invoke('extensions:install', payload),
  uninstallExtension: (payload) => ipcRenderer.invoke('extensions:uninstall', payload),
  // KeePassXC (auto-remplissage des identifiants)
  keepassStatus: () => ipcRenderer.invoke('keepass:status'),
  keepassAssociate: () => ipcRenderer.invoke('keepass:associate'),
  keepassSetEnabled: (enabled) => ipcRenderer.invoke('keepass:setEnabled', enabled),
  // Raccourcis globaux interceptés par le main process (même dans les apps)
  onShortcut: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('orbit:shortcut', listener);
    return () => ipcRenderer.removeListener('orbit:shortcut', listener);
  },
  platform: process.platform,
});
