const { contextBridge, ipcRenderer } = require('electron');

// Pont de la fenêtre secondaire stylée. La configuration (URL, partition,
// thème) arrive par la query string : le preload est chargé avant le script
// de page, donc `window.orbitPopup.config` est prêt dès la première ligne.
const params = new URLSearchParams(window.location.search);

contextBridge.exposeInMainWorld('orbitPopup', {
  config: {
    url: params.get('url') || 'about:blank',
    partition: params.get('partition') || '',
    theme: params.get('theme') || 'dark',
    accent: params.get('accent') || '#6366f1',
  },
  close: () => ipcRenderer.invoke('popup:close'),
  minimize: () => ipcRenderer.invoke('popup:minimize'),
  maximize: () => ipcRenderer.invoke('popup:maximize'),
  openExternal: (url) => ipcRenderer.invoke('popup:openExternal', url),
});
