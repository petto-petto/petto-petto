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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MetaAppState, MetaHost, PortraitSource } from '@pet/meta';
import { metaHandlers } from '@pet/meta';

import {
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  hidePanel,
  petAssetsDir,
  showPanel,
} from './windows.ts';

/**
 * 활성 펫을 초상화 파일 주소로 바꾼다.
 *
 * 파일명에 들어가는 id 는 `speciesId` 그대로다(`pet_006_s3_card.png`). 예전에는 슬러그만 받아서
 * `pet.json` 을 열어 id 를 찾았는데, `PetClient` 가 종 id 를 함께 주므로 파일을 읽지 않는다.
 *
 * 에셋 stage 는 저장된 `evolutionStage + 1` 이다(인계 문서: 진화 단계 0/1/2 → stage 1/2/3).
 * 예전에는 레벨 10 · 20 경계로 단계를 추측했는데 오버레이 성장 규칙의 경계는 15 · 35 라서
 * 원래부터 어긋나 있었다.
 *
 * 에셋이 없으면 던지지 않고 `undefined`. 화면은 자리표시 글리프로 넘어간다.
 */
function petPortrait(pet: PortraitSource): string | undefined {
  try {
    const stage = pet.evolutionStage + 1;
    const file = join(
      petAssetsDir,
      pet.rarity.toLowerCase(),
      pet.sprite,
      `stage${stage}`,
      `pet_${pet.speciesId}_s${stage}_card.png`,
    );
    return existsSync(file) ? pathToFileURL(file).href : undefined;
  } catch {
    return undefined;
  }
}

/** Electron 으로 `MetaHost` 를 채운다. */
const host: MetaHost = {
  showPanel,
  hidePanel,
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  openExternal: (url) => shell.openExternal(url),
  revealPath: (path) => shell.showItemInFolder(path),
  petPortrait,
};

/** meta 의 채널을 IPC 에 등록한다. 채널 이름은 meta 가 소유한다. */
export function mountMeta(state: MetaAppState): void {
  for (const [channel, listener] of Object.entries(metaHandlers(state, host))) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => listener(...args));
  }
}
