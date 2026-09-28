import type { TokenClient, OwnedPet, PetClient, PetSpecies, Rarity } from '@pet/client';

import { combineCost, type CombineGrade, type RandomInt } from './combine-engine.ts';

export interface CombineSnapshot {
  readonly species: readonly PetSpecies[];
  readonly ownedPets: readonly OwnedPet[];
  readonly balance: number;
}

export interface SavedCombine extends CombineSnapshot {
  readonly result: OwnedPet;
}

export interface PersistentCombine {
  load(): CombineSnapshot;
  combine(grade: CombineGrade, materialIds: readonly string[], requestId?: string): SavedCombine;
}

export type CombineActionCode = 'selection' | 'tokens' | 'candidates' | 'duplicate';

const ACTION_MESSAGES: Readonly<Record<CombineActionCode, string>> = {
  selection: '같은 등급의 비활성 펫 10마리를 재료로 선택해 주세요.',
  tokens: 'Token이 부족합니다.',
  candidates: '결과 펫 풀이 비어 있습니다.',
  duplicate: '이미 처리된 합성 요청입니다.',
};

export class CombineActionError extends Error {
  readonly code: CombineActionCode;

  constructor(code: CombineActionCode) {
    super(ACTION_MESSAGES[code]);
    this.code = code;
  }
}

/** 재료·결과 후보 규칙은 feature가 검사하고, 저장은 주입된 두 Client가 수행한다. */
export function createPersistentCombine(
  pets: Pick<PetClient, 'listSpecies' | 'listOwnedPets' | 'replaceOwnedPets'>,
  currency: Pick<TokenClient, 'balance' | 'spendOnce'>,
  transaction: <T>(work: () => T) => T,
  randomInt: RandomInt = (max) => Math.floor(Math.random() * max),
): PersistentCombine {
  const load = (): CombineSnapshot => ({
    species: pets.listSpecies(),
    ownedPets: pets.listOwnedPets(),
    balance: currency.balance(),
  });

  return {
    load,
    combine(grade, materialIds, requestId = crypto.randomUUID()) {
      if (grade !== 'common' && grade !== 'rare') throw new CombineActionError('selection');
      if (requestId.trim().length === 0 || requestId.length > 128) {
        throw new CombineActionError('selection');
      }
      return transaction(() => {
        const snapshot = load();
        const targetRarity: Rarity = grade === 'common' ? 'RARE' : 'EPIC';
        const materialRarity: Rarity = grade === 'common' ? 'COMMON' : 'RARE';
        const ownedById = new Map(snapshot.ownedPets.map((pet) => [pet.ownedPetId, pet]));
        if (
          materialIds.length !== 10 ||
          new Set(materialIds).size !== 10 ||
          materialIds.some((id) => {
            const pet = ownedById.get(id);
            return !pet || pet.isActive || pet.rarity !== materialRarity;
          })
        ) {
          throw new CombineActionError('selection');
        }
        const candidates = snapshot.species.filter((species) => species.rarity === targetRarity);
        if (candidates.length === 0) throw new CombineActionError('candidates');
        const resultSpecies = candidates[randomInt(candidates.length)];
        if (!resultSpecies) throw new Error('난수 생성기가 후보 범위를 벗어났습니다.');
        const spend = currency.spendOnce(`combine:${requestId}`, combineCost(grade), '펫 합성');
        if (spend === 'insufficient') throw new CombineActionError('tokens');
        if (spend === 'already_spent') throw new CombineActionError('duplicate');
        const result = pets.replaceOwnedPets(materialIds, resultSpecies.speciesId);
        return { ...load(), result };
      });
    },
  };
}
