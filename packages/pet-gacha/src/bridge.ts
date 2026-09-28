import type { DrawCount } from './gacha-engine.ts';
import type { GachaSnapshot, SavedGachaDraw } from './persistent-gacha.ts';
import { GachaActionError } from './persistent-gacha.ts';

export type GachaResponse<T> =
  { ok: true; value: T } | { ok: false; message: string; code?: 'tokens' | 'duplicate' };

export interface GachaBridge {
  load(): Promise<GachaResponse<GachaSnapshot>>;
  draw(count: DrawCount, requestId: string): Promise<GachaResponse<SavedGachaDraw>>;
}

export function unwrapGachaResponse<T>(response: GachaResponse<T>): T {
  if (!response.ok) {
    if (response.code) throw new GachaActionError(response.code);
    throw new Error(response.message);
  }
  return response.value;
}
