const { contextBridge, ipcRenderer } = require('electron');

// Pont IPC de la couche d'annotation d'écran. Elle ne demande que deux choses
// au processus principal : rendre la fenêtre traversante ou non (selon l'outil
// choisi et le survol de la palette), et se fermer.
contextBridge.exposeInMainWorld('annotate', {
  setMode: (mode) => ipcRenderer.invoke('annotate:mode', mode === 'draw' ? 'draw' : 'pointer'),
  setHover: (hovering) => ipcRenderer.invoke('annotate:hover', hovering === true),
  close: () => ipcRenderer.invoke('annotate:close'),
});
