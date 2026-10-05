import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { GachaActionError, type GachaResponse, type PersistentGacha } from '@pet/gacha';

/** 뽑기 창에는 카탈로그 조회와 횟수 기반 뽑기만 제공한다. */
export function registerGachaIpc(
  ipc: Pick<IpcMain, 'handle'>,
  gacha: PersistentGacha,
  isGachaWindow: (event: IpcMainInvokeEvent) => boolean,
  /** 보유 펫이 바뀐 뒤 부른다. 펫룸·오버레이가 새 명부를 읽게 하는 것은 앱의 일이다. */
  petsChanged: () => void,
): void {
  function respond<T>(event: IpcMainInvokeEvent, work: () => T): GachaResponse<T> {
    if (!isGachaWindow(event)) return { ok: false, message: '뽑기 창에서만 사용할 수 있습니다.' };
    try {
      return { ok: true, value: work() };
    } catch (error) {
      if (error instanceof GachaActionError)
        return { ok: false, message: error.message, code: error.code };
      console.error('[GACHA]', error);
      return { ok: false, message: '펫 정보를 불러오거나 저장하지 못했어요. 다시 시도해 주세요.' };
    }
  }
  ipc.handle('gacha:load', (event) => respond(event, () => gacha.load()));
  ipc.handle('gacha:draw', (event, count: unknown, requestId: unknown) =>
    respond(event, () => {
      if (count !== 1 && count !== 10) throw new Error('유효하지 않은 뽑기 횟수입니다.');
      if (typeof requestId !== 'string') throw new Error('유효하지 않은 소환 요청 ID입니다.');
      const result = gacha.draw(count, requestId);
      petsChanged();
      return result;
    }),
  );
}
