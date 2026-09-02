/** Electron 진입점. 창을 만들고, 트레이를 달고, 1분 주기 집계를 돌린다. */

import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import { join } from 'node:path';

import { MetaAppState } from '@pet/meta';

import { mountMeta } from './mount.ts';
import { JsonFileStore } from './store.ts';
import {
  applyOverlayVisibility,
  broadcast,
  createGachaWindow,
  createPanelWindow,
  createPetWindow,
  showPanel,
} from './windows.ts';

/** 기획서 8.3: 수집은 앱 시작, 실행 중 매 1분, 카드별 수동 재스캔에서 실행한다. */
const AGGREGATION_INTERVAL_MS = 60_000;

let state: MetaAppState | undefined;
let tray: Tray | undefined;

const shouldOpenGachaPrototype = (): boolean => process.env['GACHA_PROTO_OPEN'] !== undefined;

/** 트레이 진입점. 기획서 2.1은 트레이를 MVP에 포함한다. */
function buildTray(current: MetaAppState): void {
  // 아이콘 파일이 없어도 트레이가 뜨도록 빈 이미지로 시작한다.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('tamagotchi-pet 프로토타입');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '정보',
        click: () => {
          current.panelScreen = 'info';
          showPanel();
          broadcast('panel:show', 'info');
        },
      },
      {
        label: '설정',
        click: () => {
          current.panelScreen = 'settings';
          showPanel();
          broadcast('panel:show', 'settings');
        },
      },
      {
        label: '업적',
        click: () => {
          current.panelScreen = 'achievements';
          showPanel();
          broadcast('panel:show', 'achievements');
        },
      },
      { type: 'separator' },
      {
        label: '오버레이 표시 전환',
        click: () => {
          current.meta.settings.overlayVisible = !current.meta.settings.overlayVisible;
          applyOverlayVisibility(current.meta.settings.overlayVisible);
          current.persist();
        },
      },
      { label: '종료', click: () => app.quit() },
    ]),
  );
}

// `userData` 경로가 앱 이름에서 나오므로 `whenReady` 전에 정해야 한다. 이걸 빼면
// 저장 파일이 `Application Support/Electron/`에 들어가 다른 Electron 개발 앱과 섞인다.
app.setName('tamagotchi-pet');

app.whenReady().then(() => {
  // 저장 위치는 OS가 정하는 앱 데이터 디렉터리다.
  const directory = app.getPath('userData');
  const store = new JsonFileStore(directory);
  console.log(`[STORE] 저장 위치 ${store.path}`);

  state = new MetaAppState(store, store.path, app.getVersion());
  mountMeta(state);

  createPetWindow(state.meta.settings.petSize);
  createPanelWindow();
  buildTray(state);
  applyOverlayVisibility(state.meta.settings.overlayVisible);
  if (shouldOpenGachaPrototype()) createGachaWindow();

  // 앱 시작 집계. 기획서 8.2에 따라 이 스캔은 기준점만 만들고 아무것도 적립하지 않는다.
  // 그다음 데모 기록을 심고 한 번 더 돌려야 "설치 이후 사용"이 생긴다.
  state.aggregate();
  state.seedDemoUsage();
  state.aggregate();
  state.persist();

  // 개발용: 패널을 띄운 채로 시작한다. 기획서상 패널은 펫 우클릭이나 트레이로 여는 것이
  // 정상 경로이므로, 스크린샷과 화면 확인에만 쓰는 뒷문이다.
  const openPanel = process.env['META_PROTO_OPEN_PANEL'];
  if (openPanel !== undefined && state) {
    state.panelScreen = openPanel === '' ? 'info' : openPanel;
    // 창이 실제로 배치된 뒤에 열어야 펫 좌표를 올바로 읽는다.
    setTimeout(() => {
      showPanel();
      broadcast('panel:show', state?.panelScreen ?? 'info');
    }, 400);
  }

  // 1분 주기 집계.
  setInterval(() => {
    if (!state) return;
    const { run, outcome } = state.aggregate();
    state.persist();
    const allowed = state.meta.settings.notifyAchievement && state.meta.settings.overlayVisible;
    broadcast('usage:aggregated', {
      activityMinuteAdded: run.activityMinuteAdded,
      bubble: allowed ? undefined : undefined,
      newlyUnlocked: outcome.newlyUnlocked,
    });
  }, AGGREGATION_INTERVAL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && state) {
      createPetWindow(state.meta.settings.petSize);
      createPanelWindow();
      if (shouldOpenGachaPrototype()) createGachaWindow();
    }
  });
});

// 오버레이 앱이므로 창을 모두 닫아도 트레이에 남는다.
app.on('window-all-closed', () => {
  // macOS가 아니어도 종료하지 않는다. 기획서 6.2: 오버레이를 숨겨도 수집기는 계속 돈다.
});

app.on('before-quit', () => {
  state?.persist();
});
