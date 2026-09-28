import type { CombineGrade } from './combine-engine.ts';
import type { CombineActionCode, CombineSnapshot, SavedCombine } from './persistent-combine.ts';

export type CombineResponse<T> =
  { ok: true; value: T } | { ok: false; message: string; code?: CombineActionCode };

export interface CombineBridge {
  load(): Promise<CombineResponse<CombineSnapshot>>;
  combine(
    grade: CombineGrade,
    materialIds: readonly string[],
    requestId: string,
  ): Promise<CombineResponse<SavedCombine>>;
}
