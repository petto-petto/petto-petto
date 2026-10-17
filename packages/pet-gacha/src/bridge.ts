import type { DrawCount } from './gacha-engine.ts';
import type { GachaSnapshot, SavedGachaDraw } from './persistent-gacha.ts';
import { GachaActionError } from './persistent-gacha.ts';

export type GachaResponse<T> =
  { ok: true; value: T } | { ok: false; message: string; code?: 'tokens' | 'duplicate' };

export interface GachaBridge {
  load(): Promise<GachaResponse<GachaSnapshot>>;
  draw(count: DrawCount, requestId: string): Promise<GachaResponse<SavedGachaDraw>>;
  /** 이 창을 닫고 그 자리에 펫룸을 띄운다. */
  backToRoom(): Promise<void>;
  /** 결과 화면의 `오버레이로 지정`. 오버레이 펫의 정본을 거친다. */
  setOverlayPet(ownedPetId: string): Promise<unknown>;
  /** 지금 오버레이 펫의 개체 id. 없으면 `null`. */
  overlayPetId(): Promise<string | null>;
  /** 결과 화면의 `펫룸에서 보기`. 이 창 자리에 펫룸을 열고 그 개체의 상세를 띄운다. */
  openInRoom(ownedPetId: string): Promise<void>;
}

export function unwrapGachaResponse<T>(response: GachaResponse<T>): T {
  if (!response.ok) {
    if (response.code) throw new GachaActionError(response.code);
    throw new Error(response.message);
  }
  return response.value;
}
