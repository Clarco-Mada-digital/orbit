const { contextBridge, ipcRenderer } = require('electron');

// Pont IPC de la couche d'annotation d'écran. Elle demande au processus
// principal de rendre la fenêtre traversante ou non (selon l'outil choisi et le
// survol de la palette), de la fermer, et de relayer ses tracés au studio.
contextBridge.exposeInMainWorld('annotate', {
  setMode: (mode) => ipcRenderer.invoke('annotate:mode', mode === 'draw' ? 'draw' : 'pointer'),
  setHover: (hovering) => ipcRenderer.invoke('annotate:hover', hovering === true),
  close: () => ipcRenderer.invoke('annotate:close'),
  // Tracés courants, pour que le studio les compose dans la vidéo.
  publish: (state) => ipcRenderer.send('annotate:state', state),
});
