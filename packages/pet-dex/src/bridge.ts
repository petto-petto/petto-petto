import type { DexView } from './domain/dex.ts';

export type DexResponse<T> = { ok: true; value: T } | { ok: false; message: string };

/** 도감 창 preload 가 노출하는 API. 채널 이름은 `dex:*`이고 도감이 소유한다. */
export interface DexBridge {
  load(): Promise<DexResponse<DexView>>;
  /** 상세를 연 신규 발견을 확인 처리한다. */
  markSeen(speciesId: string): Promise<DexResponse<null>>;
  /** 이 창을 닫고 펫룸으로 돌아가 그 종의 개체 상세를 연다. */
  openInRoom(speciesId: string): Promise<DexResponse<null>>;
  /** 이 창을 닫고 그 자리에 뽑기 화면을 띄운다. */
  goGacha(): Promise<void>;
  /** 이 창을 닫고 그 자리에 펫룸을 띄운다. */
  backToRoom(): Promise<void>;
}

export function unwrapDexResponse<T>(response: DexResponse<T>): T {
  if (!response.ok) throw new Error(response.message);
  return response.value;
}
