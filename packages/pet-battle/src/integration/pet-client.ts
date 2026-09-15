import type { PetClient } from '@pet/client';

import type { BattleGateway, BattleResult } from '../contracts.ts';

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

  constructor(pets: PetClient, battle: BattleGateway) {
    this.#pets = pets;
    this.#battle = battle;
  }

  async syncActivePet(nowMs = Date.now()): Promise<BattleResult> {
    const active = this.#pets.getActivePet();
    if (!active) return this.#battle.execute({ type: 'GET_STATE', nowMs });

    await this.#battle.execute({
      type: 'UPSERT_PET',
      petId: active.ownedPetId,
      displayName: active.nickname ?? active.name,
      rarity: active.rarity,
      level: active.level,
      sprite: active.sprite,
      evolutionStage: active.evolutionStage,
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
