const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('combine', {
  load: () => ipcRenderer.invoke('combine:load'),
  combine: (grade, ids, requestId) => ipcRenderer.invoke('combine:combine', grade, ids, requestId),
});
