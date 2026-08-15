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
  // Purge cookies/session d'un compte désinstallé (clé de session stable)
  clearAppSession: (payload) => ipcRenderer.invoke('sessions:clear', payload),
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
  // Clic sur une notification système → ouvrir l'app concernée
  onActivateApp: (callback) => {
    const listener = (_event, appId) => callback(appId);
    ipcRenderer.on('orbit:activate-app', listener);
    return () => ipcRenderer.removeListener('orbit:activate-app', listener);
  },
  // Téléchargements (progression + actions)
  onDownload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('orbit:download', listener);
    return () => ipcRenderer.removeListener('orbit:download', listener);
  },
  openDownload: (id) => ipcRenderer.invoke('downloads:open', id),
  revealDownload: (id) => ipcRenderer.invoke('downloads:reveal', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  openDownloadsFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  // Bloqueur de pub natif
  adblock: {
    setEnabled: (on) => ipcRenderer.invoke('adblock:setEnabled', on),
    getState: () => ipcRenderer.invoke('adblock:getState'),
  },
  // Traduction : configuration (langue cible + moteur Google/LibreTranslate)
  setTranslateConfig: (cfg) => ipcRenderer.invoke('translate:setConfig', cfg),
  // Proxy / VPN par partition
  applyProxy: (payload) => ipcRenderer.invoke('proxy:apply', payload),
  // Portail captif (Wi-Fi public)
  checkCaptivePortal: () => ipcRenderer.invoke('captive:check'),
  openCaptivePortal: () => ipcRenderer.invoke('captive:open'),
  onCaptivePortal: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('orbit:captive', listener);
    return () => ipcRenderer.removeListener('orbit:captive', listener);
  },
  // Sauvegarde / restauration de la configuration
  backupExport: (payload) => ipcRenderer.invoke('backup:export', payload),
  backupImport: () => ipcRenderer.invoke('backup:import'),
  backupDecrypt: (payload) => ipcRenderer.invoke('backup:decrypt', payload),
  // Touches média globales du clavier (⏯ ⏭ ⏮)
  setMediaKeysEnabled: (on) => ipcRenderer.invoke('mediakeys:setEnabled', on),
  onMediaKey: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('orbit:media-key', listener);
    return () => ipcRenderer.removeListener('orbit:media-key', listener);
  },
  // Mini-lecteur flottant (toujours au-dessus)
  miniPlayer: {
    open: () => ipcRenderer.invoke('miniplayer:open'),
    sendState: (state) => ipcRenderer.invoke('miniplayer:state', state),
    onRequestState: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('orbit:mp:request-state', listener);
      return () => ipcRenderer.removeListener('orbit:mp:request-state', listener);
    },
    onAction: (callback) => {
      const listener = (_event, action) => callback(action);
      ipcRenderer.on('orbit:mp:action', listener);
      return () => ipcRenderer.removeListener('orbit:mp:action', listener);
    },
  },
  // Verrouillage / sécurité
  security: {
    getState: () => ipcRenderer.invoke('security:getState'),
    setAppLock: (pin) => ipcRenderer.invoke('security:setAppLock', pin),
    removeAppLock: (pin) => ipcRenderer.invoke('security:removeAppLock', pin),
    unlockApp: (pin) => ipcRenderer.invoke('security:unlockApp', pin),
    lockApp: () => ipcRenderer.invoke('security:lockApp'),
    setProfileLock: (id, pin) => ipcRenderer.invoke('security:setProfileLock', { id, pin }),
    removeProfileLock: (id, pin) => ipcRenderer.invoke('security:removeProfileLock', { id, pin }),
    unlockProfile: (id, pin) => ipcRenderer.invoke('security:unlockProfile', { id, pin }),
    lockProfile: (id) => ipcRenderer.invoke('security:lockProfile', id),
    dropProfile: (id) => ipcRenderer.invoke('security:dropProfile', id),
  },
  platform: process.platform,
});
