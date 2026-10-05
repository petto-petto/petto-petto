/**
 * 창 생성과 배치.
 *
 * 기획서 4.2의 좌표 계산은 `@pet/meta`의 `placePanel`이 하고, 여기서는 그 결과를 실제
 * 창에 적용한다. 규칙이 이 파일에 섞이면 창을 띄우지 않고는 테스트할 수 없어진다.
 */

import { BrowserWindow, app, screen, type WebContents } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { PANEL_HEIGHT, PANEL_WIDTH, placePanel, type Rect } from '@pet/meta';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '@pet/room';
import battleWindowOptions from '@pet/battle/ui/window-options.json' with { type: 'json' };

import {
  OVERLAY_WINDOW_HEIGHT,
  OVERLAY_WINDOW_WIDTH,
  overlayWindowOptions,
} from './overlay/window-options.ts';

const here = dirname(fileURLToPath(import.meta.url));
/** `dist/main`에서 두 단계 올라가면 앱 루트다. */
const appRoot = join(here, '..', '..');
const rendererDir = join(appRoot, 'renderer');

/** 펫 에셋 뿌리. 배치를 아는 곳을 앱 한 군데로 묶는다. */
export const petAssetsDir = join(rendererDir, 'assets', 'pets');
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
const battleUiDir = dirname(fileURLToPath(import.meta.resolve('@pet/battle/ui')));

/**
 * 정적 에셋의 루트.
 *
 * 에셋은 **앱이** 갖고 UI 는 패키지가 갖는다. 패키지가 앱의 파일 경로를 알면 앱 밖에서 못
 * 쓰게 되므로, 창을 열 때 `?assets=` 로 알려 준다. 모든 feature 창이 같은 규약을 쓴다.
 */
const assetsQuery = () => ({ assets: pathToFileURL(join(rendererDir, 'assets')).href });

let overlayWindow: BrowserWindow | undefined;
let panelWindow: BrowserWindow | undefined;
let roomWindow: BrowserWindow | undefined;
let gachaWindow: BrowserWindow | undefined;
let combineWindow: BrowserWindow | undefined;
let battleWindow: BrowserWindow | undefined;
let growthUsageReadyWebContentsId: number | undefined;
const pendingGrowthUsage: unknown[] = [];
const battleWindowClosedListeners = new Set<() => void>();

export const getOverlayWindow = (): BrowserWindow | undefined => overlayWindow;
export const getPanelWindow = (): BrowserWindow | undefined => panelWindow;
export const getRoomWindow = (): BrowserWindow | undefined => roomWindow;
export const getBattleWindow = (): BrowserWindow | undefined => battleWindow;

/** 전투 준비 취소 신호만 전달한다. 다른 창의 수명이나 전투 상태를 소유하지 않는다. */
export function subscribeBattleWindowClosed(listener: () => void): () => void {
  battleWindowClosedListeners.add(listener);
  return () => {
    battleWindowClosedListeners.delete(listener);
  };
}

/**
 * 열려 있는 **모든** 창에 같은 이벤트를 보낸다.
 *
 * 창 목록을 여기 나열하지 않고 `getAllWindows()`를 쓴다. 나열하면 창을 새로 추가할 때마다
 * 이 배열에 넣는 것을 잊게 되고, 그 창만 조용히 상태 갱신을 못 받는다. 활성 펫 동기화가
 * 정확히 그렇게 깨진다 — 그래서 목록을 사람이 관리하지 않는다.
 */
export function broadcast(channel: string, payload: unknown): void {
  if (channel === 'growth:usage') {
    const overlay = overlayWindow;
    if (
      overlay &&
      !overlay.isDestroyed() &&
      !overlay.webContents.isDestroyed() &&
      overlay.webContents.id === growthUsageReadyWebContentsId
    ) {
      overlay.webContents.send(channel, payload);
    } else {
      pendingGrowthUsage.push(payload);
    }
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** Growth notifications wait until the overlay has installed its listener. */
export function markGrowthUsageReady(sender: WebContents): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayWindow.webContents !== sender) return;
  growthUsageReadyWebContentsId = sender.id;
  for (const payload of pendingGrowthUsage.splice(0)) sender.send('growth:usage', payload);
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
  injectFonts(overlayWindow);
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

/**
 * 이사만루체를 창에 넣는다.
 *
 * 모든 UI(`meta`·`room`·`gacha`·`combine`·`battle`·오버레이)가 `Isamanru` 한 가지만 쓰는데
 * 폰트 파일은 **앱이** 가진다(`renderer/assets/fonts/`). 패키지가 앱의 파일 경로를 알면 앱 밖에서
 * 못 쓰게 되므로, 패키지는 폰트 이름만 말하고 파일은 호스트인 앱이 대 준다.
 *
 * 파일은 저장소에 없다. 라이선스가 재배포를 금지해 `scripts/fetch-fonts.mjs`가 설치 때 받는다.
 * 파일이 없으면 시스템 기본 폰트로 보인다.
 *
 * 앱이 여는 모든 창에 넣는다. 창마다 따로 챙기면 새 창을 추가할 때 빠뜨리고, 그 창만 조용히
 * 기본 폰트로 떨어진다 — 실제로 오버레이 창이 그 상태였다.
 */
function injectFonts(window: BrowserWindow): void {
  const url = (file: string) => pathToFileURL(join(rendererDir, 'assets', 'fonts', file)).href;
  const face = (file: string, weight: number) => `
    @font-face {
      font-family: 'Isamanru';
      src: url('${url(file)}') format('woff');
      font-weight: ${weight};
      font-display: swap;
    }`;
  const css = [
    face('GongGothicLight.woff', 300),
    face('GongGothicMedium.woff', 400),
    face('GongGothicBold.woff', 700),
  ].join('\n');
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

export function isRoomWebContents(contents: WebContents): boolean {
  return (
    roomWindow !== undefined && !roomWindow.isDestroyed() && roomWindow.webContents === contents
  );
}

export function isGachaWebContents(contents: WebContents): boolean {
  return (
    gachaWindow !== undefined && !gachaWindow.isDestroyed() && gachaWindow.webContents === contents
  );
}

/** 가챠 프로토타입은 오버레이와 수명·창 옵션을 공유하지 않는 독립 창이다. */
export function createGachaWindow(): BrowserWindow {
  if (gachaWindow && !gachaWindow.isDestroyed()) {
    gachaWindow.show();
    gachaWindow.focus();
    return gachaWindow;
  }

  gachaWindow = new BrowserWindow({
    width: 640,
    height: 420,
    useContentSize: true,
    frame: false,
    resizable: false,
    backgroundColor: '#10231a',
    title: 'Petto Petto — 소환의 숲',
    webPreferences: {
      preload: join(appRoot, 'src', 'preload', 'gacha.cjs'),
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
    width: 640,
    height: 420,
    useContentSize: true,
    frame: false,
    resizable: false,
    backgroundColor: '#161828',
    title: 'Petto Petto — 비전 합성소',
    webPreferences: {
      preload: join(appRoot, 'src', 'preload', 'combine.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  injectFonts(combineWindow);
  void combineWindow.loadFile(join(combineUiDir, 'index.html'), { query: assetsQuery() });
  combineWindow.on('closed', () => {
    combineWindow = undefined;
  });
  return combineWindow;
}

export function isCombineWebContents(contents: WebContents): boolean {
  return (
    combineWindow !== undefined &&
    !combineWindow.isDestroyed() &&
    combineWindow.webContents === contents
  );
}

/**
 * 전투 UI와 에셋은 `@pet/battle`이 소유하고, 데스크톱 앱은 창 수명만 맡는다.
 *
 * 전투 전용 sandbox preload를 통해 공유 PetClient를 주입받은 Electron 내부 전투를 사용한다.
 * 브라우저 fallback은 앱 밖 독립 미리보기에서만 사용한다.
 */
export function createBattleWindow(): BrowserWindow | undefined {
  if (battleWindow && !battleWindow.isDestroyed()) {
    battleWindow.show();
    battleWindow.focus();
    return battleWindow;
  }

  battleWindow = new BrowserWindow({
    ...battleWindowOptions,
    webPreferences: {
      preload: join(battleUiDir, 'host-preload.cjs'),
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
    for (const listener of battleWindowClosedListeners) listener();
  });
  return battleWindow;
}

/**
 * 펫룸 창 크기. 뽑기·합성과 같은 640x420이다.
 *
 * 배경 원본은 960x360이지만 픽셀 아트는 정수 배율만 허용되므로(design.md §4) 줄여 그리지
 * 않고 1배로 두고 **잘라서** 640x240만 보여 준다. 그 규칙과 상수는 `@pet/room`의
 * `viewportOf`가 갖는다 — 여기서 숫자를 다시 적으면 두 곳이 갈라진다.
 *
 * 상세 패널은 장면을 덮지 않고 **아래 칸**에 놓는다(design.md §7: 상세 패널은 펫 이동을
 * 막지 않는 자리에). 높이 180px은 합성 창과 같은 값이다.
 */
const ROOM_PANEL_HEIGHT = 180;
export const ROOM_WIDTH = VIEWPORT_WIDTH;
export const ROOM_HEIGHT = VIEWPORT_HEIGHT + ROOM_PANEL_HEIGHT;

/**
 * 펫룸 창을 열거나 이미 열려 있으면 앞으로 가져온다.
 *
 * 뽑기·합성 창과 같은 프레임 없는 창이다. 세 화면이 같은 자리에서 갈아 끼워지므로 창 모양과
 * 닫기 버튼 자리가 같아야 한 창처럼 보인다. 닫기는 화면 오른쪽 위 버튼이, 옮기기는 하단
 * 패널의 빈 바탕이 맡는다(`petroom.css`).
 */
export function showRoom(): BrowserWindow {
  if (roomWindow && !roomWindow.isDestroyed()) {
    roomWindow.show();
    roomWindow.focus();
    return roomWindow;
  }

  roomWindow = new BrowserWindow({
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    useContentSize: true,
    frame: false,
    // 배경이 정수 배율만 허용하므로 임의 크기 조절을 막는다.
    resizable: false,
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
  return roomWindow;
}

/**
 * `from` 창을 닫고 그 자리에 `next` 창을 놓는다.
 *
 * 사용자에게는 같은 창에서 화면이 바뀌는 것처럼 보여야 한다. 한 창에서 `loadFile`로 갈아
 * 끼우지 않는 이유: 뽑기·합성은 전용 preload 를 쓰고 IPC 도 자기 창에서 온 요청만 받는데,
 * preload 는 창을 만들 때 정해져 바꿀 수 없다. 그래서 창은 바꾸되 이전 화면이 있던 자리에
 * 띄운다. 크기는 셋 다 640x420이고 모두 프레임 없는 창이다. 창 위치가 아니라 **내용 영역**을
 * 맞추는 것은 어느 한쪽에 프레임이 다시 생겨도 화면이 어긋나지 않게 하려는 것이다.
 */
function replaceWindow(from: BrowserWindow, next: BrowserWindow): void {
  if (from.isDestroyed() || from === next) return;
  const { x, y } = from.getContentBounds();
  const { width, height } = next.getContentBounds();
  next.setContentBounds({ x, y, width, height });
  next.show();
  next.focus();
  from.close();
}

/** 펫룸 화면에서 뽑기·합성 화면으로 넘어간다. 펫룸 창이 없으면 `next`만 연 채로 둔다. */
export function replaceRoomWith(next: BrowserWindow): void {
  if (roomWindow) replaceWindow(roomWindow, next);
}

/** 뽑기·합성 화면에서 펫룸으로 돌아간다. */
export function returnToRoom(from: BrowserWindow): void {
  replaceWindow(from, showRoom());
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
  if (!overlayWindow || !panelWindow) return;
  const anchorWindow = overlayWindow;
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
  if (!overlayWindow) return;
  if (visible) {
    overlayWindow.show();
  } else {
    overlayWindow.hide();
    hidePanel();
  }
}

/**
 * 펫 크기 설정을 창에 적용한다(기획서 6.2).
 *
 * **지금은 적용할 창이 없다.** 이 설정은 펫 크기를 창 크기로 표현하던 옛 펫 창의 것이었고 그
 * 창은 삭제됐다. 현재 오버레이(`@pet/main-overlay`)는 창 크기가 고정이고 펫 크기는 렌더러가
 * CSS 로 정하므로, 설정을 살리려면 값을 렌더러까지 내려보내야 한다.
 *
 * 조용히 무시하지 않고 로그를 남긴다. 설정을 바꿨는데 아무 일도 일어나지 않는 이유가
 * 어딘가에는 적혀 있어야 한다 — 빈 함수로 두면 다음 사람이 창 코드를 뒤진다.
 */
export function applyPetSize(petSize: string): void {
  console.log(`[WINDOW] 펫 크기(${petSize})를 적용할 창이 없습니다 — 오버레이는 고정 크기입니다.`);
}
