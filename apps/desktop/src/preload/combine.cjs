const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('combine', {
  load: () => ipcRenderer.invoke('combine:load'),
  combine: (grade, ids, requestId) => ipcRenderer.invoke('combine:combine', grade, ids, requestId),
  backToRoom: () => ipcRenderer.invoke('window:backToRoom'),
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
