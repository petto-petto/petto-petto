import type { PetClient } from '@pet/client';

import type { BattleGateway, BattleResult } from '../contracts.ts';
import { selectRandomPetSpectators } from '../view/scene.ts';

export interface GrowthXpNotification {
  ownedPetId: string;
  amount: number;
  nowMs: number;
}

/**
 * PetClient의 저장 모델을 전투 입력 계약으로 번역한다.
 * SQLite 생명주기와 성장 계산은 소유하지 않으며, 전투 진행도는 BattleGateway가 보존한다.
 */
export class PetBattleIntegration {
  readonly #pets: PetClient;
  readonly #battle: BattleGateway;
  readonly #random: () => number;

  constructor(pets: PetClient, battle: BattleGateway, random: () => number = Math.random) {
    this.#pets = pets;
    this.#battle = battle;
    this.#random = random;
  }

  async syncActivePet(nowMs = Date.now()): Promise<BattleResult> {
    const active = this.#pets.getActivePet();
    if (!active) return this.#battle.execute({ type: 'GET_STATE', nowMs });

    const spectators = selectRandomPetSpectators(
      this.#pets.listOwnedPets().map(toBattlePet),
      active.ownedPetId,
      this.#random,
    );
    for (const spectator of spectators) {
      await this.#battle.execute({ type: 'UPSERT_PET', ...spectator });
    }

    await this.#battle.execute({ type: 'UPSERT_PET', ...toBattlePet(active) });
    await this.#battle.execute({
      type: 'SET_PET_SPECTATORS',
      petIds: spectators.map((pet) => pet.petId),
    });
    return this.#battle.execute({ type: 'SET_ACTIVE_PET', petId: active.ownedPetId });
  }

  async applyGrowthXp(notification: GrowthXpNotification): Promise<BattleResult | null> {
    const active = this.#pets.getActivePet();
    if (!active || active.ownedPetId !== notification.ownedPetId) return null;

    await this.syncActivePet(notification.nowMs);
    return this.#battle.execute({
      type: 'GROWTH_XP_ADDED',
      petId: notification.ownedPetId,
      amount: notification.amount,
      nowMs: notification.nowMs,
    });
  }
}

function toBattlePet(pet: ReturnType<PetClient['getOwnedPet']>) {
  return {
    petId: pet.ownedPetId,
    displayName: pet.nickname ?? pet.name,
    rarity: pet.rarity,
    level: pet.level,
    sprite: pet.sprite,
    evolutionStage: pet.evolutionStage,
  };
}
