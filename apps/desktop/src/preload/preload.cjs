/**
 * 렌더러에 노출하는 안전한 API 표면.
 *
 * `contextIsolation: true`이므로 렌더러는 Node에 직접 닿지 못한다. 여기서 고른 함수만
 * `window.petApi`로 보인다. 렌더러가 임의의 IPC 채널을 부를 수 없다는 점이 중요하다 —
 * 채널 이름을 이 파일이 확정한다.
 *
 * CommonJS(`.cjs`)로 두는 이유: Electron의 ESM preload는 샌드박스를 꺼야 해서, 보안을
 * 낮추는 대신 확장자를 맞추는 편이 낫다.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 메인이 렌더러로 보내는 이벤트 채널. 이 목록 밖은 구독할 수 없다.
 *
 * `room:*` 두 개는 **모든 창**이 받는다. 활성 펫을 바꾼 창 자신도 예외가 아니다 —
 * 화면 갱신은 오직 이 push 를 받고 나서 한다(`src/main/room.ts` 참조).
 */
const EVENT_CHANNELS = [
  'panel:show',
  'usage:aggregated',
  'room:activePetChanged',
  'room:backgroundChanged',
];

contextBridge.exposeInMainWorld('petApi', {
  // 조회
  infoSummary: () => ipcRenderer.invoke('info:summary'),
  infoUsage: (period) => ipcRenderer.invoke('info:usage', period),
  infoPerformance: () => ipcRenderer.invoke('info:performance'),
  settingsView: () => ipcRenderer.invoke('settings:view'),
  achievementsView: (category) => ipcRenderer.invoke('achievements:view', category),
  overlayPet: () => ipcRenderer.invoke('pet:overlay'),

  // 수집
  toggleSource: (provider, enabled) => ipcRenderer.invoke('collect:toggle', provider, enabled),
  rescan: (provider) => ipcRenderer.invoke('collect:rescan', provider),
  aggregateNow: () => ipcRenderer.invoke('collect:now'),

  // 설정
  setDisplaySetting: (key, value) => ipcRenderer.invoke('settings:display', key, value),
  setNotification: (key, value) => ipcRenderer.invoke('settings:notification', key, value),

  // 프로필
  equipTitle: (title) => ipcRenderer.invoke('profile:equip-title', title),

  // 펫룸
  roomScene: () => ipcRenderer.invoke('room:scene'),
  openRoom: () => ipcRenderer.invoke('room:open'),
  setActivePet: (ownedPetId) => ipcRenderer.invoke('room:setActivePet', ownedPetId),

  // 창
  openPanel: (screen) => ipcRenderer.invoke('panel:open', screen),
  closePanel: () => ipcRenderer.invoke('panel:close'),
  currentPanelScreen: () => ipcRenderer.invoke('panel:current'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  revealDataLocation: () => ipcRenderer.invoke('shell:reveal-data'),

  // 진단
  debugLog: (message) => ipcRenderer.invoke('debug:log', message),
  selftestEnabled: () => ipcRenderer.invoke('debug:selftest-enabled'),

  // 시연 (프로토타입 전용)
  demoEvent: (kind) => ipcRenderer.invoke('demo:event', kind),
  demoUsage: (provider) => ipcRenderer.invoke('demo:usage', provider),
  demoFailNextReward: () => ipcRenderer.invoke('demo:fail-next-reward'),
  demoBreakSource: (provider) => ipcRenderer.invoke('demo:break-source', provider),

  /**
   * 메인이 보내는 이벤트를 구독한다. 허용된 채널만 받는다.
   *
   * 해제 함수를 돌려준다. 펫룸은 창이 열리고 닫히는 화면이라, 구독을 못 끊으면 닫힌 창의
   * 콜백이 계속 남는다.
   */
  on: (channel, listener) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});

/**
 * 메인 오버레이 전용 API.
 *
 * 기존 오버레이 UI가 기대하는 `window.overlay` 계약을 공통 데스크톱 host가 제공한다.
 * 성장 저장·사용량 수집은 아직 이관 전이므로 3단계에서 이 표면을 확장한다.
 */
contextBridge.exposeInMainWorld('overlay', {
  setInteractive: (interactive) =>
    ipcRenderer.send('overlay:set-interactive', Boolean(interactive)),
  focusWindow: () => ipcRenderer.send('overlay:focus'),
  dragStart: (screenX, screenY) => ipcRenderer.send('overlay:drag-start', { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send('overlay:drag-move', { screenX, screenY }),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  quit: () => ipcRenderer.send('overlay:quit'),
  openPanel: (screen) => ipcRenderer.invoke('panel:open', screen),
  openPetRoom: () => ipcRenderer.invoke('room:open'),
  openBattle: () => ipcRenderer.invoke('battle:open'),
  hydrateGrowth: (legacySnapshots) => ipcRenderer.invoke('growth:hydrate', legacySnapshots),
  saveGrowth: (snapshots) => ipcRenderer.invoke('growth:save-all', snapshots),
  clearGrowth: () => ipcRenderer.invoke('growth:clear-all'),
  loadOverlayState: () => ipcRenderer.invoke('overlay:load-state'),
  saveOverlayState: (state) => ipcRenderer.invoke('overlay:save-state', state),
  onMenuClose: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('overlay:menu-close', wrapped);
    return () => ipcRenderer.removeListener('overlay:menu-close', wrapped);
  },
});
