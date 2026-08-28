/**
 * meta feature 를 Electron 에 끼운다.
 *
 * 이 파일이 껍데기와 feature 를 잇는 유일한 지점이다. `@pet/meta`는 Electron 을 모르고,
 * 여기서 그 요구(`MetaHost`)를 Electron API 로 채워 준다.
 *
 * 팀이 아직 정하지 않은 것이 바로 이 모양이다 — feature 를 앱에 어떻게 끼울지. 지금은
 * meta 하나만 직접 마운트하고, 일반화된 `FeatureModule` 인터페이스는 만들지 않았다.
 * 그것을 지금 정하면 회의를 앞질러 간다.
 */

import { ipcMain, shell } from 'electron';

import type { MetaAppState, MetaHost } from '@pet/meta';
import { metaHandlers } from '@pet/meta';

import {
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  hidePanel,
  showPanel,
} from './windows.ts';

/** Electron 으로 `MetaHost` 를 채운다. */
const host: MetaHost = {
  showPanel,
  hidePanel,
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  openExternal: (url) => shell.openExternal(url),
  revealPath: (path) => shell.showItemInFolder(path),
};

/** meta 의 채널을 IPC 에 등록한다. 채널 이름은 meta 가 소유한다. */
export function mountMeta(state: MetaAppState): void {
  for (const [channel, listener] of Object.entries(metaHandlers(state, host))) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => listener(...args));
  }
}
