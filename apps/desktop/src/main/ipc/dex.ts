import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { PetClient } from '@pet/client';
import { COMBINE_MATERIAL_COUNT } from '@pet/combine';
import { dexView, roomFocusTarget, type DexResponse, type DexView } from '@pet/dex';
import { STANDARD_GRADE_WEIGHTS } from '@pet/gacha';
import { petAssetPath } from '@pet/room';

/** 도감이 앱 껍데기에 요구하는 것. 창을 다루는 일은 도감이 할 수 없다. */
export interface DexHost {
  /** 도감 창을 닫고 펫룸으로 돌아가 이 개체의 상세를 연다. */
  openInRoom(event: IpcMainInvokeEvent, ownedPetId: string): void;
  /** 도감 창을 닫고 그 자리에 뽑기 창을 띄운다. */
  goGacha(event: IpcMainInvokeEvent): void;
}

/**
 * 도감 화면 모델. 에셋 경로·뽑기 확률·합성 재료 수는 각 소유자의 값을 여기서 넘긴다
 * (`@pet/dex`가 그 패키지들을 import 하지 않는 이유는 `domain/dex.ts` 머리말 참조).
 */
export function loadDexView(pets: Pick<PetClient, 'listDexEntries'>): DexView {
  return dexView(pets.listDexEntries(), {
    spriteOf: (species, stage) => ({
      card: petAssetPath(species.rarity, species.sprite, species.speciesId, stage, 'card'),
      idle: petAssetPath(species.rarity, species.sprite, species.speciesId, stage, 'idle'),
    }),
    gachaWeights: STANDARD_GRADE_WEIGHTS,
    combineMaterialCount: COMBINE_MATERIAL_COUNT,
  });
}

/** 도감 창의 채널(`dex:*`)을 등록한다. 채널 이름은 도감이 소유한다. */
export function registerDexIpc(
  ipc: Pick<IpcMain, 'handle'>,
  pets: Pick<PetClient, 'listDexEntries' | 'markDexSeen' | 'listOwnedPets'>,
  isDexWindow: (event: IpcMainInvokeEvent) => boolean,
  /** 도감 버튼의 NEW 표식을 묻는 창. 펫룸만 묻는다. */
  isRoomWindow: (event: IpcMainInvokeEvent) => boolean,
  host: DexHost,
): void {
  function respond<T>(event: IpcMainInvokeEvent, work: () => T): DexResponse<T> {
    if (!isDexWindow(event)) return { ok: false, message: '도감 창에서만 사용할 수 있습니다.' };
    try {
      return { ok: true, value: work() };
    } catch (error) {
      console.error('[DEX]', error);
      return { ok: false, message: '펫 정보를 불러오거나 저장하지 못했어요. 다시 시도해 주세요.' };
    }
  }

  ipc.handle('dex:load', (event) => respond(event, () => loadDexView(pets)));
  ipc.handle('dex:markSeen', (event, speciesId: unknown) =>
    respond(event, () => {
      pets.markDexSeen(speciesIdFrom(speciesId));
      return null;
    }),
  );
  ipc.handle('dex:openInRoom', (event, speciesId: unknown) =>
    respond(event, () => {
      const target = roomFocusTarget(pets.listOwnedPets(speciesIdFrom(speciesId)));
      if (target === null) throw new Error(`보유한 개체가 없는 종입니다: ${String(speciesId)}`);
      host.openInRoom(event, target);
      return null;
    }),
  );
  ipc.handle('dex:goGacha', (event) => {
    if (isDexWindow(event)) host.goGacha(event);
  });
  // 펫룸의 도감 버튼 NEW 표식. 판정은 도감 화면 모델의 것을 그대로 쓴다. 실패하면 거부로 돌려준다.
  ipc.handle('dex:hasNew', (event) => {
    if (!isRoomWindow(event)) throw new Error('펫룸 창에서만 사용할 수 있습니다.');
    return loadDexView(pets).hasNew;
  });
}

function speciesIdFrom(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`펫 종류가 올바르지 않습니다: ${String(value)}`);
}
