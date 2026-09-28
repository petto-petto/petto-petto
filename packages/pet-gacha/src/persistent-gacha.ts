import type { TokenClient, PetClient, Rarity } from '@pet/client';

import {
  createGachaEngine,
  secureRandomInt,
  type DrawCount,
  type DrawResult,
  type GachaGrade,
  type GachaState,
  type PetsByGrade,
  type RandomInt,
} from './gacha-engine.ts';

export interface GachaPet {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly grade: GachaGrade;
}

export interface GachaSnapshot extends GachaState {
  readonly pets: PetsByGrade<GachaPet>;
  readonly ownedCount: number;
  readonly balance: number;
}

export interface SavedGachaDraw extends DrawResult<GachaPet> {
  readonly ownedPetIds: readonly string[];
  readonly ownedCount: number;
  readonly balance: number;
}

export class GachaActionError extends Error {
  readonly code: 'tokens' | 'duplicate';

  constructor(code: 'tokens' | 'duplicate') {
    super(code === 'tokens' ? 'Token이 부족합니다.' : '이미 처리된 소환 요청입니다.');
    this.code = code;
  }
}

export interface PersistentGacha {
  load(): GachaSnapshot;
  draw(count: DrawCount, requestId?: string): SavedGachaDraw;
}

/** 후보와 획득 개체는 DB를 사용한다. 천장 상태는 앱 실행 중에만 유지한다. */
export function createPersistentGacha(
  pets: Pick<PetClient, 'listSpecies' | 'countOwnedPets' | 'createOwnedPets'>,
  currency: Pick<TokenClient, 'balance' | 'spendOnce'>,
  transaction: <T>(work: () => T) => T,
  randomInt: RandomInt = secureRandomInt,
): PersistentGacha {
  let state: GachaState = { pityCounter: 0, totalDrawCount: 0 };

  function load(): GachaSnapshot {
    const catalog: Record<GachaGrade, GachaPet[]> = { common: [], rare: [], epic: [] };
    for (const species of pets.listSpecies()) {
      const grade = gradeOf(species.rarity);
      catalog[grade].push({
        id: species.speciesId,
        slug: species.sprite,
        name: species.name,
        grade,
      });
    }
    for (const grade of ['common', 'rare', 'epic'] as const) {
      if (catalog[grade].length === 0)
        throw new Error(`${grade.toUpperCase()} 등급의 펫이 없습니다.`);
    }
    return {
      ...state,
      pets: catalog,
      ownedCount: pets.countOwnedPets(),
      balance: currency.balance(),
    };
  }

  return {
    load,
    draw(count, requestId = crypto.randomUUID()) {
      if (count !== 1 && count !== 10) throw new Error('뽑기 횟수는 1 또는 10이어야 합니다.');
      if (requestId.trim().length === 0 || requestId.length > 128) {
        throw new Error('유효하지 않은 소환 요청 ID입니다.');
      }
      const saved = transaction(() => {
        const snapshot = load();
        const next = createGachaEngine(snapshot.pets, randomInt, state).draw(count);
        const spend = currency.spendOnce(`gacha:${requestId}`, count * 100_000, '펫 뽑기');
        if (spend === 'insufficient') throw new GachaActionError('tokens');
        if (spend === 'already_spent') throw new GachaActionError('duplicate');
        const acquired = pets.createOwnedPets(next.results.map(({ pet }) => pet.id));
        return {
          ...next,
          ownedPetIds: acquired.map((pet) => pet.ownedPetId),
          ownedCount: snapshot.ownedCount + acquired.length,
          balance: currency.balance(),
        };
      });
      state = { pityCounter: saved.pityCounter, totalDrawCount: saved.totalDrawCount };
      return saved;
    },
  };
}

function gradeOf(rarity: Rarity): GachaGrade {
  switch (rarity) {
    case 'COMMON':
      return 'common';
    case 'RARE':
      return 'rare';
    case 'EPIC':
      return 'epic';
    default: {
      const unreachable: never = rarity;
      throw new Error(`알 수 없는 펫 등급입니다: ${String(unreachable)}`);
    }
  }
}
