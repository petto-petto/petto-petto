/** Electron 진입점. 창을 만들고, 트레이를 달고, 1분 주기 집계를 돌린다. */

import { BrowserWindow, Menu, Tray, app, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { systemClock } from '@pet/core';

import { MetaAppState } from '@pet/meta';
import type { RoomSnapshot } from '@pet/room';
import type { MetaSnapshot } from '@pet/meta';

import { RoomCollectionPort } from './collection.ts';
import { mountMeta } from './mount.ts';
import { RoomState, loadRoomCollection, mountRoom, type RoomHost } from './room.ts';
import { JsonFileStore, META_FILE_NAME, ROOM_FILE_NAME } from './store.ts';
import { registerOverlayGrowthIpc } from './overlay/growth-ipc.ts';
import { PetGrowthRepository } from './overlay/pet-growth-repository.ts';
import { SqliteFileDatabase } from './persistence/sqlite-file.ts';
import {
  applyOverlayVisibility,
  beginOverlayDrag,
  broadcast,
  createBattleWindow,
  createOverlayWindow,
  createCombineWindow,
  createGachaWindow,
  createPanelWindow,
  endOverlayDrag,
  focusOverlayWindow,
  moveOverlayDrag,
  setOverlayInteractive,
  showPanel,
  showRoom,
} from './windows.ts';

/** 기획서 8.3: 수집은 앱 시작, 실행 중 매 1분, 카드별 수동 재스캔에서 실행한다. */
const AGGREGATION_INTERVAL_MS = 60_000;

const here = dirname(fileURLToPath(import.meta.url));
/** `dist/main`에서 두 단계 올라가면 앱 루트다. */
const appRoot = join(here, '..', '..');

let state: MetaAppState | undefined;
let room: RoomState | undefined;
let tray: Tray | undefined;
let growthRepository: PetGrowthRepository | undefined;

interface OverlayPointer {
  screenX: number;
  screenY: number;
}

function isOverlayPointer(value: unknown): value is OverlayPointer {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.screenX === 'number' &&
    Number.isFinite(candidate.screenX) &&
    typeof candidate.screenY === 'number' &&
    Number.isFinite(candidate.screenY)
  );
}

function mountOverlayWindowIpc(): void {
  ipcMain.on('overlay:set-interactive', (_event, interactive: unknown) => {
    setOverlayInteractive(interactive === true);
  });
  ipcMain.on('overlay:focus', () => focusOverlayWindow());
  ipcMain.on('overlay:drag-start', (_event, point: unknown) => {
    if (isOverlayPointer(point)) beginOverlayDrag(point.screenX, point.screenY);
  });
  ipcMain.on('overlay:drag-move', (_event, point: unknown) => {
    if (isOverlayPointer(point)) moveOverlayDrag(point.screenX, point.screenY);
  });
  ipcMain.on('overlay:drag-end', () => endOverlayDrag());
  ipcMain.on('overlay:quit', () => app.quit());
  ipcMain.handle('battle:open', () => {
    createBattleWindow();
  });
}

/** 펫룸이 앱 껍데기에 요구하는 것. 창을 다루는 일은 `@pet/room`이 할 수 없다. */
const roomHost: RoomHost = { showRoom, broadcast };

const shouldOpenGachaPrototype = (): boolean => process.env['GACHA_PROTO_OPEN'] !== undefined;
const shouldOpenCombinePrototype = (): boolean => process.env['COMBINE_PROTO_OPEN'] !== undefined;

/**
 * 트레이 진입점. 기획서 2.1은 트레이를 MVP에 포함한다.
 *
 * 아이콘은 반드시 실제 그림이어야 한다. 예전에는 `nativeImage.createEmpty()`를 썼는데,
 * 트레이 항목은 폭 16px로 **존재하지만 아무것도 그려지지 않아** 메뉴 바에서 눈에 띄지
 * 않았다. 열 수 있는 창이 트레이 뒤에만 있으면 앱에 들어갈 방법이 없는 것과 같다.
 *
 * 파일명이 `Template`로 끝나면 macOS가 알파만 읽어 메뉴 바 색에 맞춰 칠한다
 * (`tools/tray-icon.py`가 그 규칙대로 그린다).
 */
function buildTray(current: MetaAppState): void {
  tray = new Tray(join(appRoot, 'resources', 'trayTemplate.png'));
  tray.setToolTip('petto-petto — 클릭해서 펫룸·정보·설정·업적 열기');
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
        label: '펫룸',
        click: () => showRoom(),
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
/**
 * 앱 메뉴. 트레이와 별개로 **항상 보이는** 진입점이다.
 *
 * 트레이 아이콘은 메뉴 바가 붐비면 가려지고, 오버레이 우클릭 메뉴는 펫을 찾아 눌러야
 * 한다는 것을 알아야 쓸 수 있다. 앱 메뉴는 둘 다 아니어서, 앱이 떠 있으면 언제나 같은
 * 자리에 있고 단축키도 붙는다.
 */
function buildAppMenu(current: MetaAppState): void {
  const openPanel = (screen: string) => () => {
    current.panelScreen = screen;
    showPanel();
    broadcast('panel:show', screen);
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: '펫',
        submenu: [
          { label: '펫룸', accelerator: 'CommandOrControl+1', click: () => showRoom() },
          { type: 'separator' },
          { label: '정보', accelerator: 'CommandOrControl+2', click: openPanel('info') },
          { label: '설정', accelerator: 'CommandOrControl+3', click: openPanel('settings') },
          { label: '업적', accelerator: 'CommandOrControl+4', click: openPanel('achievements') },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

app.setName('tamagotchi-pet');

app.whenReady().then(() => {
  // 저장 위치는 OS가 정하는 앱 데이터 디렉터리다.
  const directory = app.getPath('userData');
  const store = new JsonFileStore<MetaSnapshot>(directory, META_FILE_NAME);
  const roomStore = new JsonFileStore<RoomSnapshot>(directory, ROOM_FILE_NAME);
  const growthDatabase = new SqliteFileDatabase({ filePath: join(directory, 'petto.sqlite') });
  growthRepository = new PetGrowthRepository(growthDatabase, {
    legacyDatabasePaths: [
      join(directory, 'pet-overlay.sqlite'),
      join(app.getPath('appData'), 'Electron', 'pet-overlay.sqlite'),
    ],
  });
  growthRepository.open();
  registerOverlayGrowthIpc(growthRepository);
  console.log(`[STORE] 저장 위치 ${store.path}`);

  // 보유 펫이 meta 의 조회(오버레이 펫 · 보유 수 · 도감 진행도)에 답한다. 예전에는 이
  // 자리에 테스트 대역이 들어가 상수를 돌려주고 있었다.
  const ownedPets = loadRoomCollection(roomStore);
  const collection = new RoomCollectionPort(ownedPets);
  state = new MetaAppState(store, store.path, app.getVersion(), collection);
  room = new RoomState(roomStore, systemClock, collection, ownedPets);
  mountMeta(state);
  mountRoom(room, roomHost);
  mountOverlayWindowIpc();

  createOverlayWindow();
  createPanelWindow();
  buildTray(state);
  buildAppMenu(state);
  applyOverlayVisibility(state.meta.settings.overlayVisible);
  if (shouldOpenGachaPrototype()) createGachaWindow();
  if (shouldOpenCombinePrototype()) createCombineWindow();

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
    // 낮↔밤이 넘어갔으면 열려 있는 펫룸의 배경을 바꾼다. 창을 다시 열 필요가 없다.
    room?.refreshBackground(roomHost);
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
      createOverlayWindow();
      createPanelWindow();
      if (shouldOpenGachaPrototype()) createGachaWindow();
      if (shouldOpenCombinePrototype()) createCombineWindow();
    }
  });
});

// 오버레이 앱이므로 창을 모두 닫아도 트레이에 남는다.
app.on('window-all-closed', () => {
  // macOS가 아니어도 종료하지 않는다. 기획서 6.2: 오버레이를 숨겨도 수집기는 계속 돈다.
});

app.on('before-quit', () => {
  state?.persist();
  room?.persist();
  growthRepository?.close();
});
