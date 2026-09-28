const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gacha', {
  load: () => ipcRenderer.invoke('gacha:load'),
  draw: (count, requestId) => ipcRenderer.invoke('gacha:draw', count, requestId),
});
