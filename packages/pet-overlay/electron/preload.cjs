const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  // 펫/메뉴 hover 시 창 입력 활성화(클릭 통과 해제) 토글
  setInteractive: (v) => ipcRenderer.send('set-interactive', !!v),
  // 메뉴 열릴 때 창 포커스(그래야 바깥 클릭 시 blur로 닫을 수 있음)
  focusWindow: () => ipcRenderer.send('overlay-focus'),
  // 창이 포커스를 잃으면(다른 앱/바탕화면 클릭) 메뉴 닫기 신호
  onMenuClose: (cb) => {
    const l = () => cb();
    ipcRenderer.on('menu-close', l);
    return () => ipcRenderer.removeListener('menu-close', l);
  },
  // 드래그 = 창(윈도우) 자체를 이동 → 다른 모니터로도 이동 가능
  dragStart: (sx, sy) => ipcRenderer.send('drag-start', { sx, sy }),
  dragMove: (sx, sy) => ipcRenderer.send('drag-move', { sx, sy }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  quit: () => ipcRenderer.send('overlay-quit'),
  // renderer에는 성장 저장에 필요한 명령만 노출한다.
  hydrateGrowth: (legacySnapshots) => ipcRenderer.invoke('growth:hydrate', legacySnapshots),
  saveGrowth: (snapshots) => ipcRenderer.invoke('growth:save-all', snapshots),
  clearGrowth: () => ipcRenderer.invoke('growth:clear-all'),
  loadOverlayState: () => ipcRenderer.invoke('overlay:load-state'),
  saveOverlayState: (state) => ipcRenderer.invoke('overlay:save-state', state),
});
