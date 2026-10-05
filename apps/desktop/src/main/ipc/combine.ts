import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { CombineActionError, type CombineResponse, type PersistentCombine } from '@pet/combine';

/** 합성 창에만 조회와 개체 ID 기반 합성을 허용한다. */
export function registerCombineIpc(
  ipc: Pick<IpcMain, 'handle'>,
  combine: PersistentCombine,
  isCombineWindow: (event: IpcMainInvokeEvent) => boolean,
  /** 보유 펫이 바뀐 뒤 부른다. 펫룸·오버레이가 새 명부를 읽게 하는 것은 앱의 일이다. */
  petsChanged: () => void,
): void {
  function respond<T>(event: IpcMainInvokeEvent, work: () => T): CombineResponse<T> {
    if (!isCombineWindow(event)) return { ok: false, message: '합성 창에서만 사용할 수 있습니다.' };
    try {
      return { ok: true, value: work() };
    } catch (error) {
      if (error instanceof CombineActionError)
        return { ok: false, message: error.message, code: error.code };
      console.error('[COMBINE]', error);
      return {
        ok: false,
        message: '합성 정보를 불러오거나 저장하지 못했어요. 다시 시도해 주세요.',
      };
    }
  }

  ipc.handle('combine:load', (event) => respond(event, () => combine.load()));
  ipc.handle('combine:combine', (event, grade: unknown, ids: unknown, requestId: unknown) =>
    respond(event, () => {
      if (
        (grade !== 'common' && grade !== 'rare') ||
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string') ||
        typeof requestId !== 'string'
      ) {
        throw new CombineActionError('selection');
      }
      const result = combine.combine(grade, ids, requestId);
      petsChanged();
      return result;
    }),
  );
}
