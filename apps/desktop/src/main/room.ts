/**
 * 펫룸 feature 를 Electron 에 끼운다.
 *
 * `mount.ts`가 meta 에 하는 일을 room 에 한다 — `@pet/room`은 Electron 을 모르고, 여기서
 * 그 요구를 IPC 로 채워 준다. 상태와 규칙은 `room-state.ts`와 `@pet/room`에 있다.
 */

import { ipcMain } from 'electron';

import { BACKGROUND_PHASES, SEASONS, type BackgroundPhase, type Season } from '@pet/room';

import type { RoomHost, RoomState } from './room-state.ts';

export { RoomState, type RoomHost, type RoomScene } from './room-state.ts';

function seasonFrom(value: unknown): Season {
  const found = SEASONS.find((season) => season === value);
  if (found) return found;
  throw new Error(`계절이 올바르지 않습니다: ${String(value)}`);
}

function phaseFrom(value: unknown): BackgroundPhase {
  const found = BACKGROUND_PHASES.find((phase) => phase === value);
  if (found) return found;
  throw new Error(`시간대가 올바르지 않습니다: ${String(value)}`);
}

function ownedPetIdFrom(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`펫 식별자가 올바르지 않습니다: ${String(value)}`);
}

/** 펫룸이 오버레이에 맡기는 일. 진화는 오버레이의 성장 컨트롤러만 실행한다. */
export interface RoomOverlayHost {
  requestEvolve(ownedPetId: string): void;
}

/** room 의 채널을 IPC 에 등록한다. 채널 이름은 room 이 소유한다. */
export function mountRoom(state: RoomState, host: RoomHost, overlay: RoomOverlayHost): void {
  ipcMain.handle('room:scene', () => state.scene());
  ipcMain.handle('room:open', () => {
    host.showRoom();
  });
  // 다른 화면으로 가는 길은 공통 상단 바가 `screen:open`으로 연다(동선 3단계). room 은 갖지 않는다.
  ipcMain.handle('room:setActivePet', (_event, ownedPetId: unknown) =>
    state.setActivePet(ownedPetIdFrom(ownedPetId), host),
  );
  // 펫룸 상세의 `진화시키기`. 그 펫을 오버레이 펫으로 세운 뒤 오버레이에 진화를 맡긴다.
  ipcMain.handle('room:evolve', (_event, ownedPetId: unknown) => {
    const id = ownedPetIdFrom(ownedPetId);
    const ready = state.prepareEvolve(id, host);
    if (ready) overlay.requestEvolve(id);
    return ready;
  });
  ipcMain.handle('room:previewBackground', (_event, season: unknown, phase: unknown) => {
    state.previewBackground(
      season === null ? null : { season: seasonFrom(season), phase: phaseFrom(phase) },
      host,
    );
  });
}
