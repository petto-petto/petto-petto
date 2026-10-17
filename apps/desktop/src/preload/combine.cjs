const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('combine', {
  load: () => ipcRenderer.invoke('combine:load'),
  combine: (grade, ids, requestId) => ipcRenderer.invoke('combine:combine', grade, ids, requestId),
  /** 결과 화면의 `오버레이로 지정`. 오버레이 펫의 정본(`room:setActivePet`)을 거친다. */
  setOverlayPet: (ownedPetId) => ipcRenderer.invoke('room:setActivePet', ownedPetId),
  /** 지금 오버레이 펫의 개체 id. 없으면 `null`. */
  overlayPetId: () =>
    ipcRenderer
      .invoke('room:scene')
      .then((scene) => scene?.pets?.find((pet) => pet.isActive)?.ownedPetId ?? null),
  /** 결과 화면의 `펫룸에서 보기`. 이 창 자리에 펫룸을 열고 그 개체의 상세를 띄운다. */
  openInRoom: (ownedPetId) => ipcRenderer.invoke('screen:open', 'room', ownedPetId),
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
      : key === 'info' || key === 'achievements'
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
