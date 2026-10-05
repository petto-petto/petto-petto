/**
 * 펫룸 feature 를 Electron 에 끼운다.
 *
 * `mount.ts`가 meta 에 하는 일을 room 에 한다 — `@pet/room`은 Electron 을 모르고, 여기서
 * 그 요구를 IPC 로 채워 준다. 상태와 규칙은 `room-state.ts`와 `@pet/room`에 있다.
 */

import { ipcMain } from 'electron';

import { BACKGROUND_PHASES, SEASONS, type BackgroundPhase, type Season } from '@pet/room';

import type { RoomDestination, RoomHost, RoomState } from './room-state.ts';

export { RoomState, type RoomDestination, type RoomHost, type RoomScene } from './room-state.ts';

function destinationFrom(value: unknown): RoomDestination {
  if (value === 'gacha' || value === 'combine') return value;
  throw new Error(`이동할 수 없는 화면입니다: ${String(value)}`);
}

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

/** room 의 채널을 IPC 에 등록한다. 채널 이름은 room 이 소유한다. */
export function mountRoom(state: RoomState, host: RoomHost): void {
  ipcMain.handle('room:scene', () => state.scene());
  ipcMain.handle('room:open', () => {
    host.showRoom();
  });
  // 펫룸에서 뽑기·합성으로 건너가는 길. 창을 다루는 일은 앱이 하고, room 은 요청만 한다.
  ipcMain.handle('room:navigate', (event, destination: unknown) => {
    host.navigate(destinationFrom(destination), event.sender);
  });
  ipcMain.handle('room:setActivePet', (_event, ownedPetId: unknown) =>
    state.setActivePet(ownedPetIdFrom(ownedPetId), host),
  );
  ipcMain.handle('room:previewBackground', (_event, season: unknown, phase: unknown) => {
    state.previewBackground(
      season === null ? null : { season: seasonFrom(season), phase: phaseFrom(phase) },
      host,
    );
  });
}
