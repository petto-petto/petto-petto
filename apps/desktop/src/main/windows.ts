/**
 * 창 생성과 배치.
 *
 * 기획서 4.2의 좌표 계산은 `@pet/meta`의 `placePanel`이 하고, 여기서는 그 결과를 실제
 * 창에 적용한다. 규칙이 이 파일에 섞이면 창을 띄우지 않고는 테스트할 수 없어진다.
 */

import { BrowserWindow, app, screen } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { PANEL_HEIGHT, PANEL_WIDTH, placePanel, petSizePixels, type Rect } from '@pet/meta';

import {
  OVERLAY_WINDOW_HEIGHT,
  OVERLAY_WINDOW_WIDTH,
  overlayWindowOptions,
} from './overlay/window-options.ts';

const here = dirname(fileURLToPath(import.meta.url));
/** `dist/main`에서 두 단계 올라가면 앱 루트다. */
const appRoot = join(here, '..', '..');
const rendererDir = join(appRoot, 'renderer');
const preloadPath = join(appRoot, 'src', 'preload', 'preload.cjs');

/**
 * 패널 화면은 `@pet/meta`가 소유한다. 패키지 위치에서 찾아야 하므로 경로를 직접 쓰지 않고
 * 모듈 해석으로 구한다 — 패키지가 옮겨져도 깨지지 않는다.
 */
const metaUiDir = join(dirname(fileURLToPath(import.meta.resolve('@pet/meta/package.json'))), 'ui');
const gachaUiDir = join(
  dirname(fileURLToPath(import.meta.resolve('@pet/gacha/package.json'))),
  'ui',
);
const combineUiDir = join(
  dirname(fileURLToPath(import.meta.resolve('@pet/combine/package.json'))),
  'ui',
);
const roomUiDir = join(dirname(fileURLToPath(import.meta.resolve('@pet/room/package.json'))), 'ui');
const overlayUiDir = join(dirname(fileURLToPath(import.meta.resolve('@pet/main-overlay/ui'))));
const battleUiDir = join(
  dirname(fileURLToPath(import.meta.resolve('@pet/battle/package.json'))),
  'ui',
);

/**
 * 정적 에셋의 루트.
 *
 * 에셋은 **앱이** 갖고 UI 는 패키지가 갖는다. 패키지가 앱의 파일 경로를 알면 앱 밖에서 못
 * 쓰게 되므로, 창을 열 때 `?assets=` 로 알려 준다. 모든 feature 창이 같은 규약을 쓴다.
 */
const assetsQuery = () => ({ assets: pathToFileURL(join(rendererDir, 'assets')).href });

let petWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let panelWindow: BrowserWindow | undefined;
let roomWindow: BrowserWindow | undefined;
let gachaWindow: BrowserWindow | undefined;
let combineWindow: BrowserWindow | undefined;
let battleWindow: BrowserWindow | undefined;

export const getPetWindow = (): BrowserWindow | undefined => petWindow;
export const getOverlayWindow = (): BrowserWindow | undefined => overlayWindow;
export const getPanelWindow = (): BrowserWindow | undefined => panelWindow;
export const getRoomWindow = (): BrowserWindow | undefined => roomWindow;
export const getBattleWindow = (): BrowserWindow | undefined => battleWindow;

/**
 * 열려 있는 **모든** 창에 같은 이벤트를 보낸다.
 *
 * 창 목록을 여기 나열하지 않고 `getAllWindows()`를 쓴다. 나열하면 창을 새로 추가할 때마다
 * 이 배열에 넣는 것을 잊게 되고, 그 창만 조용히 상태 갱신을 못 받는다. 활성 펫 동기화가
 * 정확히 그렇게 깨진다 — 그래서 목록을 사람이 관리하지 않는다.
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function commonOptions() {
  return {
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      // 렌더러가 Node에 직접 닿지 못하게 한다. 렌더러는 `window.petApi`만 본다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  } as const;
}

interface OverlayWindowState {
  x: number;
  y: number;
}

interface OverlayDragOrigin {
  windowX: number;
  windowY: number;
  screenX: number;
  screenY: number;
}

let overlayDragOrigin: OverlayDragOrigin | undefined;

function overlayWindowStatePath(): string {
  return join(app.getPath('userData'), 'overlay-window.json');
}

function loadOverlayWindowState(): OverlayWindowState | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(overlayWindowStatePath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const candidate = raw as Record<string, unknown>;
    if (
      typeof candidate.x === 'number' &&
      Number.isFinite(candidate.x) &&
      typeof candidate.y === 'number' &&
      Number.isFinite(candidate.y)
    ) {
      return { x: candidate.x, y: candidate.y };
    }
  } catch {
    // 첫 실행 또는 잘못된 위치 파일이면 기본 위치를 사용한다.
  }
  return undefined;
}

function saveOverlayWindowState(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  writeFileSync(overlayWindowStatePath(), JSON.stringify({ x, y }));
}

function overlayPositionIsVisible(state: OverlayWindowState): boolean {
  const centerX = state.x + OVERLAY_WINDOW_WIDTH / 2;
  const centerY = state.y + OVERLAY_WINDOW_HEIGHT / 2;
  return screen.getAllDisplays().some(({ bounds }) => {
    return (
      centerX >= bounds.x &&
      centerX <= bounds.x + bounds.width &&
      centerY >= bounds.y &&
      centerY <= bounds.y + bounds.height
    );
  });
}

function initialOverlayPosition(): OverlayWindowState {
  const { workArea } = screen.getPrimaryDisplay();
  const fallback = {
    x: workArea.x + workArea.width - OVERLAY_WINDOW_WIDTH,
    y: workArea.y + workArea.height - OVERLAY_WINDOW_HEIGHT,
  };
  const restored = loadOverlayWindowState();
  return restored && overlayPositionIsVisible(restored) ? restored : fallback;
}

/** 공통 데스크톱 앱이 여는 첫 번째 투명 오버레이 창. */
export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return overlayWindow;
  }

  const position = initialOverlayPosition();
  overlayWindow = new BrowserWindow({
    ...overlayWindowOptions(preloadPath),
    x: position.x,
    y: position.y,
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  void overlayWindow.loadFile(join(overlayUiDir, 'index.html'));
  overlayWindow.on('blur', () => {
    overlayWindow?.webContents.send('overlay:menu-close');
  });
  overlayWindow.on('closed', () => {
    overlayWindow = undefined;
    overlayDragOrigin = undefined;
  });
  return overlayWindow;
}

export function setOverlayInteractive(interactive: boolean): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

export function focusOverlayWindow(): void {
  overlayWindow?.focus();
}

export function beginOverlayDrag(screenX: number, screenY: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const { x: windowX, y: windowY } = overlayWindow.getBounds();
  overlayDragOrigin = { windowX, windowY, screenX, screenY };
}

export function moveOverlayDrag(screenX: number, screenY: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayDragOrigin) return;
  const bounds = overlayWindow.getBounds();
  const allDisplays = screen.getAllDisplays();
  const left = Math.min(...allDisplays.map(({ bounds: display }) => display.x));
  const top = Math.min(...allDisplays.map(({ bounds: display }) => display.y));
  const right = Math.max(...allDisplays.map(({ bounds: display }) => display.x + display.width));
  const bottom = Math.max(...allDisplays.map(({ bounds: display }) => display.y + display.height));
  const desiredX = overlayDragOrigin.windowX + screenX - overlayDragOrigin.screenX;
  const desiredY = overlayDragOrigin.windowY + screenY - overlayDragOrigin.screenY;
  const x = Math.max(left - bounds.width / 2, Math.min(desiredX, right - bounds.width / 2));
  const y = Math.max(top - bounds.height / 2, Math.min(desiredY, bottom - bounds.height / 2));
  overlayWindow.setPosition(Math.round(x), Math.round(y));
}

export function endOverlayDrag(): void {
  overlayDragOrigin = undefined;
  saveOverlayWindowState();
}

export function createPetWindow(petSize: string): BrowserWindow {
  const side = petSizePixels(petSize as never) + 24;
  petWindow = new BrowserWindow({ ...commonOptions(), width: side, height: side });
  injectFonts(petWindow);
  void petWindow.loadFile(join(roomUiDir, 'pet.html'), { query: assetsQuery() });
  placePetInitially();
  return petWindow;
}

/**
 * 도트 폰트를 창에 넣는다.
 *
 * 다섯 UI(`meta`·`room`·`gacha`·`combine`·`battle`)가 전부 `Galmuri11`을 쓰는데 폰트 파일은
 * **앱이** 가진다(`renderer/assets/fonts/`). 패키지가 앱의 파일 경로를 알면 앱 밖에서 못
 * 쓰게 되므로, 패키지는 폰트 이름만 말하고 파일은 호스트인 앱이 대 준다.
 *
 * 앱이 여는 모든 창에 넣는다. 창마다 따로 챙기면 새 창을 추가할 때 빠뜨리고, 그 창만 조용히
 * 기본 고정폭으로 떨어진다 — 실제로 `gacha`·`battle`·`meta` 가 그 상태였다.
 */
function injectFonts(window: BrowserWindow): void {
  const url = (file: string) => pathToFileURL(join(rendererDir, 'assets', 'fonts', file)).href;
  const css = `
    @font-face {
      font-family: 'Galmuri9';
      src: url('${url('Galmuri9.woff2')}') format('woff2');
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: 'Galmuri11';
      src: url('${url('Galmuri11-Bold.woff2')}') format('woff2');
      font-weight: 700;
      font-display: swap;
    }
  `;
  window.webContents.on('did-finish-load', () => {
    void window.webContents.insertCSS(css);
  });
}

export function createPanelWindow(): BrowserWindow {
  panelWindow = new BrowserWindow({
    ...commonOptions(),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
  });
  injectFonts(panelWindow);
  void panelWindow.loadFile(join(metaUiDir, 'index.html'));
  return panelWindow;
}

/** 가챠 프로토타입은 오버레이와 수명·창 옵션을 공유하지 않는 독립 창이다. */
export function createGachaWindow(): BrowserWindow {
  if (gachaWindow && !gachaWindow.isDestroyed()) {
    gachaWindow.show();
    gachaWindow.focus();
    return gachaWindow;
  }

  gachaWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 920,
    minHeight: 700,
    backgroundColor: '#10231a',
    title: 'Petto Petto — 소환의 숲',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  injectFonts(gachaWindow);
  void gachaWindow.loadFile(join(gachaUiDir, 'index.html'), { query: assetsQuery() });
  gachaWindow.on('closed', () => {
    gachaWindow = undefined;
  });
  return gachaWindow;
}

export function createCombineWindow(): BrowserWindow {
  if (combineWindow && !combineWindow.isDestroyed()) {
    combineWindow.show();
    combineWindow.focus();
    return combineWindow;
  }
  combineWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 920,
    minHeight: 700,
    backgroundColor: '#161828',
    title: 'Petto Petto — 비전 합성소',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  injectFonts(combineWindow);
  void combineWindow.loadFile(join(combineUiDir, 'index.html'), { query: assetsQuery() });
  combineWindow.on('closed', () => {
    combineWindow = undefined;
  });
  return combineWindow;
}

/**
 * 전투 UI와 에셋은 `@pet/battle`이 소유하고, 데스크톱 앱은 창 수명만 맡는다.
 *
 * 공통 preload에는 `window.petBattle`을 노출하지 않는다. 전투 UI가 제공하는 브라우저
 * fallback gateway를 사용하므로 Rust sidecar·개별 Electron 실행 없이도 같은 앱에서
 * 전투 화면을 확인할 수 있다.
 */
export function createBattleWindow(): BrowserWindow | undefined {
  if (battleWindow && !battleWindow.isDestroyed()) {
    battleWindow.show();
    battleWindow.focus();
    return battleWindow;
  }

  battleWindow = new BrowserWindow({
    width: 360,
    height: 180,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  battleWindow.setMenuBarVisibility(false);
  injectFonts(battleWindow);
  void battleWindow.loadFile(join(battleUiDir, 'index.html'));
  battleWindow.once('ready-to-show', () => battleWindow?.show());
  battleWindow.on('closed', () => {
    battleWindow = undefined;
  });
  return battleWindow;
}

/**
 * 펫룸 창 크기.
 *
 * 장면은 배경 원본 그대로 960x360이다. 픽셀 아트는 정수 배율만 허용되므로(design.md §4)
 * 1배로 두어 확대 보간이 아예 일어나지 않게 한다.
 *
 * 상세 패널은 장면을 덮지 않고 **옆 칸**에 놓는다(design.md §7: 상세 패널은 펫 이동을 막지
 * 않는 자리에). 그래서 창은 장면보다 패널 폭만큼 넓다.
 */
const SCENE_WIDTH = 960;
const SIDE_WIDTH = 264;
export const ROOM_WIDTH = SCENE_WIDTH + SIDE_WIDTH;
export const ROOM_HEIGHT = 360;

/**
 * 펫룸 창을 열거나 이미 열려 있으면 앞으로 가져온다.
 *
 * 오버레이·패널과 달리 투명 프레임리스가 아니다. 펫룸은 오버레이가 아니라 들여다보는
 * 화면이라 창 크롬이 있어야 옮기고 닫을 수 있다.
 */
export function showRoom(): void {
  if (roomWindow && !roomWindow.isDestroyed()) {
    roomWindow.show();
    roomWindow.focus();
    return;
  }

  roomWindow = new BrowserWindow({
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    // 배경이 정수 배율만 허용하므로 임의 크기 조절을 막는다.
    resizable: false,
    useContentSize: true,
    title: '펫룸',
    backgroundColor: '#10231A',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  roomWindow.on('closed', () => {
    roomWindow = undefined;
  });

  injectFonts(roomWindow);
  void roomWindow.loadFile(join(roomUiDir, 'petroom.html'), { query: assetsQuery() });
}

/** 창의 논리 픽셀 사각형. */
function windowRect(window: BrowserWindow): Rect {
  const [x, y] = window.getPosition();
  const [width, height] = window.getSize();
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
}

/**
 * 펫이 있는 모니터의 작업 영역.
 *
 * Electron의 `workArea`는 메뉴 바와 독을 이미 제외한 값이라, Tauri에서 하던 수동 보정이
 * 필요 없다.
 */
function workAreaFor(window: BrowserWindow): Rect {
  const rect = windowRect(window);
  const display = screen.getDisplayNearestPoint({
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  });
  return display.workArea;
}

/**
 * 패널을 펫 옆에 배치하고 보여준다.
 *
 * 패널 창이 하나뿐이므로 "동시에 둘 이상의 메타 패널이 보이지 않는다"(META-001)가
 * 구조적으로 성립한다. 화면을 바꾸는 것은 같은 창의 내용을 갈아 끼우는 일이다.
 */
export function showPanel(): void {
  const anchorWindow = overlayWindow ?? petWindow;
  if (!anchorWindow || !panelWindow) return;
  const placement = placePanel(windowRect(anchorWindow), workAreaFor(anchorWindow));
  panelWindow.setPosition(Math.round(placement.x), Math.round(placement.y));
  panelWindow.show();
  panelWindow.focus();
}

export function hidePanel(): void {
  panelWindow?.hide();
}

/**
 * 오버레이 표시 설정을 창에 적용한다(기획서 6.2).
 *
 * 오버레이를 숨겨도 앱과 수집기는 계속 실행된다. 그래서 창을 닫는 게 아니라 감춘다.
 */
export function applyOverlayVisibility(visible: boolean): void {
  const activeOverlay = overlayWindow ?? petWindow;
  if (!activeOverlay) return;
  if (visible) {
    activeOverlay.show();
  } else {
    activeOverlay.hide();
    hidePanel();
  }
}

/**
 * 펫 크기 설정을 창에 적용한다(기획서 6.2).
 *
 * 패널 창은 건드리지 않는다 — SET-005가 요구하는 바로 그 분리다.
 */
export function applyPetSize(petSize: string): void {
  if (!petWindow) return;
  const side = petSizePixels(petSize as never) + 24;
  petWindow.setSize(side, side);
}

/** 시작 시 펫을 화면 오른쪽 아래에 놓는다. */
export function placePetInitially(): void {
  if (!petWindow) return;
  const area = workAreaFor(petWindow);
  const rect = windowRect(petWindow);
  petWindow.setPosition(
    Math.round(Math.max(area.x + area.width - rect.width - 40, area.x)),
    Math.round(Math.max(area.y + area.height - rect.height - 60, area.y)),
  );
}
