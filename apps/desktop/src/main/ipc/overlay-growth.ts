import { ipcMain } from 'electron';

import { PetGrowthRepository } from '../persistence/repositories/pet-growth-repository.ts';

/**
 * 성장 저장소가 앱 껍데기에 요구하는 것.
 *
 * 저장소는 명부도 창도 모른다. 성장이 바뀌면 레벨·진화 단계를 명부에 투영하고 창에 알리는
 * 일은 앱이 한다 — 그래야 프로필(명부에서 읽는다)과 오버레이(성장 저장소에서 읽는다)가
 * 같은 값을 말한다.
 */
export interface OverlayGrowthHost {
  /** 저장된 성장값을 명부에 투영하고, 달라졌으면 창에 알린다. */
  growthChanged(): void;
  /** 명부의 모든 개체를 성장 이전(Lv.1 · 진화 0회)으로 되돌린다. 초기화 직후에 쓴다. */
  reseed(): void;
}

/** renderer가 성장 저장소에 접근하는 명시적 IPC 채널만 등록한다. */
export function registerOverlayGrowthIpc(
  repository: PetGrowthRepository,
  host: OverlayGrowthHost,
): void {
  ipcMain.handle('growth:load-all', () => repository.loadAll());
  ipcMain.handle('growth:save-all', (_event, snapshots: unknown) => {
    repository.saveAll(snapshots);
    host.growthChanged();
  });
  ipcMain.handle('growth:clear-all', () => {
    // 지우기와 다시 깔기를 한 트랜잭션에 둔다. 행이 없는 중간 상태가 보이면 오버레이가
    // 성장 기록이 없는 펫을 그린다.
    host.reseed();
  });
}
