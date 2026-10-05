import type { BattlePet, BattleState } from '../contracts.ts';

export type BattlePetSprites = NonNullable<BattleState['petSprites']>[string];

/** Resolves battle-owned images without reaching into the shared pet asset directory. */
export interface BattleSpritePort {
  resolve(pet: BattlePet): BattlePetSprites;
}
