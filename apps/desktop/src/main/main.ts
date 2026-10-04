/** Electron 진입점. 창을 만들고, 트레이를 달고, 1분 주기 집계를 돌린다. */

import { BrowserWindow, Menu, Tray, app, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { systemClock } from '@pet/core';
import { createPersistentGacha } from '@pet/gacha';
import { createPersistentCombine } from '@pet/combine';

import { FixtureCollector, MetaAppState, type UsageCollector } from '@pet/meta';
import type { StoredRoomSnapshot } from '@pet/room';

import { RoomCollectionPort } from './collection.ts';
import type { PetClient, TokenClient } from '@pet/client';

import { SqlitePetClient } from './clients/sqlite-pet-client.ts';
import { SqliteTokenClient } from './clients/sqlite-token-client.ts';
import { SqliteCurrencyPort } from './currency.ts';
import { importLegacyMetaSnapshot, SqliteMetaStore } from './meta-store.ts';
import { OVERLAY_GROWTH_RULES } from './growth-rules.ts';
import { MetaRepository } from './persistence/repositories/meta-repository.ts';
import { PetRepository } from './persistence/repositories/pet-repository.ts';
import { CurrencyRepository } from './persistence/repositories/currency-repository.ts';
import { TokenRepository } from './persistence/repositories/token-repository.ts';
import { mountMeta } from './mount.ts';
import { CcusageCollector, resolveCcusageBinary } from './usage/ccusage-collector.ts';
import { RoomState, loadRoomCollection, mountRoom, type RoomHost } from './room.ts';
import { JsonFileStore, ROOM_FILE_NAME } from './store.ts';
import { registerOverlayGrowthIpc, type OverlayGrowthHost } from './ipc/overlay-growth.ts';
import { registerGachaIpc } from './ipc/gacha.ts';
import { registerCombineIpc } from './ipc/combine.ts';
import { APP_MIGRATIONS } from './persistence/migrations/index.ts';
import { PetGrowthRepository } from './persistence/repositories/pet-growth-repository.ts';
import { SqliteFileDatabase } from './persistence/sqlite-file.ts';
import {
  applyOverlayVisibility,
  beginOverlayDrag,
  broadcast,
  createBattleWindow,
  createOverlayWindow,
  createCombineWindow,
  createGachaWindow,
  isGachaWebContents,
  isCombineWebContents,
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
let appDatabase: SqliteFileDatabase | undefined;
/** 종료 정리를 시작했는가. 주기 집계를 멈추고, 두 번째 `before-quit`은 그대로 종료시킨다. */
let quitting = false;

/**
 * 사용량 수집기. 기본은 번들된 `ccusage`다.
 *
 * `META_DEMO_USAGE=1`이면 12주치 가짜 기록을 심는 픽스처를 쓴다. 화면을 눈으로 확인하거나
 * 스크린샷을 찍을 때만 쓰는 뒷문이다 — 실제 기록과 섞이면 안 되므로 둘 중 하나만 고른다.
 */
function createUsageCollector(): UsageCollector {
  if (process.env['META_DEMO_USAGE'] === '1') {
    console.log('[USAGE] 데모 수집기로 시작합니다 (META_DEMO_USAGE=1)');
    return FixtureCollector.withEmptySnapshots();
  }
  return new CcusageCollector({
    home: homedir(),
    binaryPath: resolveCcusageBinary(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

/**
 * 1분 주기 집계. 앞선 집계가 **끝난 뒤** 다음 집계를 예약한다.
 *
 * `setInterval`은 앞선 집계가 ccusage를 기다리는 중에도 다음 틱을 쏜다. 합류 덕분에 실행이
 * 두 번 되지는 않지만, 느린 환경에서 요청이 쌓이는 모양 자체를 만들지 않는다(기획서 8.3).
 */
function scheduleAggregation(roomHost: RoomHost): void {
  setTimeout(() => {
    void aggregateTick(roomHost).finally(() => {
      if (!quitting) scheduleAggregation(roomHost);
    });
  }, AGGREGATION_INTERVAL_MS);
}

async function aggregateTick(roomHost: RoomHost): Promise<void> {
  // 낮↔밤이 넘어갔으면 열려 있는 펫룸의 배경을 바꾼다. 창을 다시 열 필요가 없다.
  room?.refreshBackground(roomHost);
  if (!state || quitting) return;
  try {
    const { run, outcome } = await state.aggregate();
    state.persist();
    broadcast('usage:aggregated', {
      activityMinuteAdded: run.activityMinuteAdded,
      bubble: undefined,
      newlyUnlocked: outcome.newlyUnlocked,
    });
  } catch (error) {
    // 한 번의 실패로 주기가 끊기면 안 된다. 다음 예약은 `finally`가 한다.
    console.log(`[USAGE] 주기 집계 실패 — ${String(error)}`);
  }
}

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
const roomHost: RoomHost = {
  showRoom,
  // `createGachaWindow`는 창을 돌려주지만 room 은 창을 알 필요가 없다.
  showGacha: () => {
    createGachaWindow();
  },
  broadcast,
};

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

app.whenReady().then(async () => {
  // 저장 위치는 OS가 정하는 앱 데이터 디렉터리다.
  const directory = app.getPath('userData');
  const roomStore = new JsonFileStore<StoredRoomSnapshot>(directory, ROOM_FILE_NAME);
  const databasePath = join(directory, 'petto.sqlite');
  const database = new SqliteFileDatabase({ filePath: databasePath, migrations: APP_MIGRATIONS });
  appDatabase = database;
  database.open();

  // meta 상태는 공통 SQLite 의 meta_* 표에 산다. 시작할 때 한 번 읽고, 연산마다 바뀐 행만 즉시 쓴다.
  const store = new SqliteMetaStore(new MetaRepository(appDatabase));
  // 표로 옮기기 전의 meta-state.json 이 있으면 한 번만 가져오고 `.migrated` 로 이름을 바꾼다.
  const legacy = importLegacyMetaSnapshot(directory, store);
  if (legacy !== 'none') console.log(`[STORE] 옛 meta-state.json → meta 표 (${legacy})`);
  const growthRepository = new PetGrowthRepository(appDatabase, {
    legacyDatabasePaths: [
      join(directory, 'pet-overlay.sqlite'),
      join(app.getPath('appData'), 'Electron', 'pet-overlay.sqlite'),
    ],
  });
  growthRepository.migrateLegacyData();
  console.log(`[STORE] 저장 위치 ${databasePath}`);

  // room 의 JSON 명부는 이제 트로피 배치와 room 자신의 화면만 쓴다. meta 의 펫 데이터는
  // 아래 `pets` 에서 온다.
  const ownedPets = loadRoomCollection(roomStore);
  const collection = new RoomCollectionPort(ownedPets);
  // 공통 펫 데이터. 펫 담당이 만든 `PetClient` 를 같은 DB 위에 한 번만 조립해 나눠 준다.
  const pets: PetClient = new SqlitePetClient(new PetRepository(database));
  const currencyRepository = new CurrencyRepository(database);
  const tokens: TokenClient = new SqliteTokenClient(
    new TokenRepository(database),
    currencyRepository,
  );
  const featureTransaction = <T>(work: () => T): T => database.transaction(work);
  registerGachaIpc(
    ipcMain,
    createPersistentGacha(pets, tokens, featureTransaction),
    (event) => isGachaWebContents(event.sender) && event.senderFrame === event.sender.mainFrame,
  );
  registerCombineIpc(
    ipcMain,
    createPersistentCombine(pets, tokens, featureTransaction),
    (event) => isCombineWebContents(event.sender) && event.senderFrame === event.sender.mainFrame,
  );
  // 재화는 공통 SQLite 파일에 남는다. 인메모리 대역이던 시절에는 앱을 끌 때마다 잔액이
  // 0으로 돌아갔고, 멱등 키는 meta 스냅샷에 남아 다시 지급되지도 않았다.
  const currency = new SqliteCurrencyPort(currencyRepository, systemClock);
  state = new MetaAppState(
    store,
    databasePath,
    app.getVersion(),
    collection,
    currency,
    pets,
    OVERLAY_GROWTH_RULES,
    createUsageCollector(),
  );
  room = new RoomState(roomStore, systemClock, collection, ownedPets);

  // 명부의 개체가 모두 성장 행을 갖게 하고, 그 값을 명부에 투영한다. 이게 없으면 프로필은
  // 명부의 레벨을, 오버레이는 성장 저장소의 레벨을 말해 두 화면이 갈라진다.
  //
  // 실패해도 앱은 뜬다. 이 줄은 창·IPC·트레이보다 **앞**이라, 여기서 던지면 사용자는 창이
  // 하나도 없는 죽은 프로세스만 보게 된다 — 손댄 저장 파일 하나가 앱을 통째로 못 쓰게
  // 만드는 것이 저장 파일을 방어하는 이유 그 자체였다. 성장이 안 붙으면 명부의 값으로
  // 그리면 되고, 다음 실행에서 다시 시도된다.
  try {
    room.applyGrowth(growthRepository.adoptRoster(room.growthSeeds()), roomHost);
  } catch (error) {
    console.log(`[GROWTH] 성장 기록을 명부에 맞추지 못했습니다 — ${String(error)}`);
  }

  const growthHost: OverlayGrowthHost = {
    growthChanged: () => room?.applyGrowth(growthRepository.growth(), roomHost),
    reseed: () => {
      if (!room) return;
      room.applyGrowth(growthRepository.resetGrowth(room.growthSeeds()), roomHost);
    },
  };
  registerOverlayGrowthIpc(growthRepository, growthHost);

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
  // 데모 모드에서는 그다음 데모 기록을 심고 한 번 더 돌려야 "설치 이후 사용"이 생긴다.
  // 실제 수집기로 두 번 돌리면 ccusage 를 한 번 더 실행할 뿐이라 데모일 때만 다시 돈다.
  try {
    await state.aggregate();
    if (state.seedDemoUsage()) await state.aggregate();
    state.persist();
  } catch (error) {
    // 시작 집계가 실패해도 앱과 1분 주기는 살아 있어야 한다. 다음 주기가 다시 시도한다.
    console.log(`[USAGE] 시작 집계 실패 — ${String(error)}`);
  }

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

  // 1분 주기 집계. 앞선 집계가 끝난 뒤 다음 집계를 예약한다.
  scheduleAggregation(roomHost);

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

/**
 * 진행 중인 집계가 끝난 뒤에 저장하고 DB 를 닫는다.
 *
 * 집계는 ccusage 를 기다리는 동안 멈춰 있다가 이어서 재화를 지급하고 저장한다. 그 사이에 DB 를
 * 닫으면 닫힌 DB 에 쓰다 실패한다. 그래서 첫 종료 요청은 미루고, 집계가 끝나면 정리한 뒤
 * 종료한다. 기다림은 ccusage 타임아웃(10초)을 넘지 않는다.
 */
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (state?.idle() ?? Promise.resolve()).finally(() => {
    try {
      state?.persist();
      room?.persist();
      appDatabase?.close();
    } finally {
      // 정리는 끝났다. `app.quit()`을 다시 부르면 미뤄 둔 종료 요청이 되살아나지 않는 경우가
      // 있어서(SIGTERM 으로 확인) 종료 절차를 다시 밟지 않는 `exit`로 끝낸다.
      app.exit(0);
    }
  });
});
