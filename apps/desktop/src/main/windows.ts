/**
 * 창 생성과 배치.
 *
 * 기획서 4.2의 좌표 계산은 `@pet/meta`의 `placePanel`이 하고, 여기서는 그 결과를 실제
 * 창에 적용한다. 규칙이 이 파일에 섞이면 창을 띄우지 않고는 테스트할 수 없어진다.
 */

import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PANEL_HEIGHT, PANEL_WIDTH, placePanel, petSizePixels, type Rect } from '@pet/meta';

const here = dirname(fileURLToPath(import.meta.url));
/** `dist/main`에서 두 단계 올라가면 앱 루트다. */
const appRoot = join(here, '..', '..');
const rendererDir = join(appRoot, 'renderer');
const preloadPath = join(appRoot, 'src', 'preload', 'preload.cjs');

let petWindow: BrowserWindow | undefined;
let panelWindow: BrowserWindow | undefined;

export const getPetWindow = (): BrowserWindow | undefined => petWindow;
export const getPanelWindow = (): BrowserWindow | undefined => panelWindow;

/** 두 창에 같은 이벤트를 보낸다. 말풍선은 펫이, 갱신은 패널이 받는다. */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of [petWindow, panelWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
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

export function createPetWindow(petSize: string): BrowserWindow {
  const side = petSizePixels(petSize as never) + 24;
  petWindow = new BrowserWindow({ ...commonOptions(), width: side, height: side });
  void petWindow.loadFile(join(rendererDir, 'pet.html'));
  placePetInitially();
  return petWindow;
}

export function createPanelWindow(): BrowserWindow {
  panelWindow = new BrowserWindow({
    ...commonOptions(),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
  });
  void panelWindow.loadFile(join(rendererDir, 'index.html'));
  return panelWindow;
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
  if (!petWindow || !panelWindow) return;
  const placement = placePanel(windowRect(petWindow), workAreaFor(petWindow));
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
  if (!petWindow) return;
  if (visible) {
    petWindow.show();
  } else {
    petWindow.hide();
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
