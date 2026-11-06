const { contextBridge, ipcRenderer } = require('electron');

// Pont IPC d'une capture épinglée. La fenêtre ne connaît ni chemin de fichier
// ni image source : elle reçoit une data URL à afficher et demande des actions.
// L'identité de la fenêtre est déduite côté principal (`event.sender`), jamais
// envoyée par le rendu — une fenêtre ne peut donc pas agir sur une autre.
contextBridge.exposeInMainWorld('pin', {
  onImage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('orbit:pin:image', listener);
    return () => ipcRenderer.removeListener('orbit:pin:image', listener);
  },
  copy: () => ipcRenderer.invoke('pin:copy'),
  save: () => ipcRenderer.invoke('pin:save'),
  close: () => ipcRenderer.invoke('pin:close'),
});
