const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  load: () => ipcRenderer.invoke('dex:load'),
  markSeen: (speciesId) => ipcRenderer.invoke('dex:markSeen', speciesId),
  openInRoom: (speciesId) => ipcRenderer.invoke('dex:openInRoom', speciesId),
  goGacha: () => ipcRenderer.invoke('dex:goGacha'),
  backToRoom: () => ipcRenderer.invoke('window:backToRoom'),
});
