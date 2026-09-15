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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { MetaAppState, MetaHost, PetSummary } from '@pet/meta';
import { metaHandlers } from '@pet/meta';

import {
  applyOverlayVisibility,
  applyPetSize,
  broadcast,
  hidePanel,
  petAssetsDir,
  showPanel,
} from './windows.ts';

/** 레벨 → 진화 단계. 에셋 가이드 §3. `renderer/pet.js`와 같은 규칙이다. */
function stageOfLevel(level: number): number {
  if (level < 10) return 1;
  if (level < 20) return 2;
  return 3;
}

/**
 * 펫 요약을 초상화 파일 주소로 바꾼다.
 *
 * 슬러그만으로는 파일명을 알 수 없다 — 파일명에 들어가는 `petId`는 종 메타(`pet.json`)에
 * 있다(에셋 가이드 §6). 등급 폴더는 소문자, `pet.json`의 `grade`는 대문자다(§1).
 *
 * 에셋이 하나라도 없으면 던지지 않고 `undefined`를 준다. 초상화가 없는 것은 오류가
 * 아니고, 화면은 자리표시 글리프로 넘어간다.
 */
function petPortrait(pet: PetSummary): string | undefined {
  try {
    const speciesDir = join(petAssetsDir, pet.rarity.toLowerCase(), pet.sprite);
    const manifest = join(speciesDir, 'pet.json');
    if (!existsSync(manifest)) return undefined;

    const species = JSON.parse(readFileSync(manifest, 'utf8')) as { petId?: string };
    if (species.petId === undefined) return undefined;

    const stage = stageOfLevel(pet.level);
    const file = join(speciesDir, `stage${stage}`, `pet_${species.petId}_s${stage}_card.png`);
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
