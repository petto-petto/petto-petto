import type { BrowserWindowConstructorOptions } from 'electron';

/** 다음 단계에서 `windows.ts`가 사용할 overlay 전용 창 규약. */
export const OVERLAY_WINDOW_WIDTH = 460;
export const OVERLAY_WINDOW_HEIGHT = 520;

export function overlayWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: OVERLAY_WINDOW_WIDTH,
    height: OVERLAY_WINDOW_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
