// Sandboxed host bridge: no Node access or standalone/demo engine startup here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBattle', {
  execute: (command) => ipcRenderer.invoke('battle:command', command),
});
