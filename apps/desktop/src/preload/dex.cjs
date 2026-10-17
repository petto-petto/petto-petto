const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  load: () => ipcRenderer.invoke('dex:load'),
  markSeen: (speciesId) => ipcRenderer.invoke('dex:markSeen', speciesId),
  openInRoom: (speciesId) => ipcRenderer.invoke('dex:openInRoom', speciesId),
  goGacha: () => ipcRenderer.invoke('dex:goGacha'),
});

/**
 * 640 화면 공통 상단 바(`@pet/shell`). 탭은 640 화면이면 이 창 자리에서 바꾸고, 전투·정보는 따로 띄운다.
 * sandbox preload 는 다른 파일을 읽지 못해 네 preload 에 같은 블록을 둔다.
 */
contextBridge.exposeInMainWorld('shell', {
  state: () => ipcRenderer.invoke('shell:state'),
  open: (key) =>
    key === 'battle'
      ? ipcRenderer.invoke('battle:open')
      : key === 'info' || key === 'achievements' || key === 'settings'
        ? ipcRenderer.invoke('panel:open', key)
        : ipcRenderer.invoke('screen:open', key),
  onChanged: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('shell:changed', wrapped);
    ipcRenderer.on('usage:aggregated', wrapped);
    return () => {
      ipcRenderer.removeListener('shell:changed', wrapped);
      ipcRenderer.removeListener('usage:aggregated', wrapped);
    };
  },
});
