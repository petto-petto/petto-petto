import { ipcMain } from 'electron';
import { RoomState, type RoomHost } from './room-state.ts';
export { RoomState, loadRoomCollection, type RoomHost, type RoomScene } from './room-state.ts';

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
  ipcMain.handle('room:setActivePet', (_event, ownedPetId: unknown) =>
    state.setActivePet(ownedPetIdFrom(ownedPetId), host),
  );
}
