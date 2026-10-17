// Sandboxed host bridge: no Node access or standalone/demo engine startup here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBattle', {
  execute: (command) => ipcRenderer.invoke('battle:command', command),
});

// 전투 창의 `펫룸` 버튼. 창을 다루는 일은 앱이 한다 — 전투 창은 닫지 않고 펫룸 창만 연다.
contextBridge.exposeInMainWorld('petBattleHost', {
  openRoom: () => ipcRenderer.invoke('screen:open', 'room'),
});
