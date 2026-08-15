const { contextBridge, ipcRenderer } = require('electron');

// Pont IPC du mini-lecteur flottant. Il ne fait que : recevoir l'état de
// lecture (titre, pochette, playing) et renvoyer les actions (précédent,
// pause, suivant, aller à l'app, fermer) — le pilotage réel du média se fait
// dans la fenêtre principale (elle a les <webview>).
contextBridge.exposeInMainWorld('mp', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('orbit:mp:state', listener);
    return () => ipcRenderer.removeListener('orbit:mp:state', listener);
  },
  action: (type, value) => ipcRenderer.invoke('miniplayer:action', { type, value }),
  close: () => ipcRenderer.invoke('miniplayer:action', { type: 'close' }),
});
