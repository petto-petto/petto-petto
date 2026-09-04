import { ipcMain } from 'electron';

import { PetGrowthRepository } from '../persistence/repositories/pet-growth-repository.ts';

/** renderer가 성장 저장소에 접근하는 명시적 IPC 채널만 등록한다. */
export function registerOverlayGrowthIpc(repository: PetGrowthRepository): void {
  ipcMain.handle('growth:hydrate', (_event, legacySnapshots: unknown) => {
    return repository.hydrate(legacySnapshots);
  });
  ipcMain.handle('growth:save-all', (_event, snapshots: unknown) => {
    repository.saveAll(snapshots);
  });
  ipcMain.handle('growth:clear-all', () => {
    repository.clearAll();
  });
  ipcMain.handle('overlay:load-state', () => repository.loadOverlayState());
  ipcMain.handle('overlay:save-state', (_event, state: unknown) => {
    repository.saveOverlayState(state);
  });
}
