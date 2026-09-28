import type { PetClient } from '@pet/client';
import type { BattleCommand, BattleGateway, BattleResult } from '../contracts.ts';
import { OwnedPetBattleGateway, type BattleGrowthRules } from './owned-pet-gateway.ts';

export interface GrowthXpNotification {
  ownedPetId: string;
  /** Compatibility only: never add this delta. Read committed totalXp from PetClient. */
  amount: number;
  nowMs: number;
}

/**
 * Read-only consumer of the owner's PetClient contract.
 * Host injects the client, Rust engine, and the growth owner's level XP curve.
 * No database access, token conversion, pet creation, or growth writes happen here.
 */
export class PetBattleIntegration implements BattleGateway {
  readonly #pets: PetClient;
  readonly #gateway: OwnedPetBattleGateway;

  constructor(pets: PetClient, engine: BattleGateway, rules: BattleGrowthRules) {
    this.#pets = pets;
    this.#gateway = new OwnedPetBattleGateway(pets, engine, rules);
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    return this.#gateway.execute(command);
  }

  syncActivePet(nowMs = Date.now()): Promise<BattleResult> {
    return this.execute({ type: 'GET_STATE', nowMs });
  }

  /** Call after the growth owner successfully saves. Duplicate notifications are harmless. */
  async applyGrowthXp(notification: GrowthXpNotification): Promise<BattleResult | null> {
    const active = this.#pets.getActivePet();
    if (!active || active.ownedPetId !== notification.ownedPetId) return null;
    return this.syncActivePet(notification.nowMs);
  }
}
