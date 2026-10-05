import type { PetClient } from '@pet/client';
import type { RoomSelectionClient } from '@pet/room';
import type { BattleCommand, BattleResult } from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import { OwnedPetBattleGateway, type BattleGrowthRules } from './owned-pet-gateway.ts';

export interface GrowthXpNotification {
  ownedPetId: string;
  /** Compatibility only: never add this delta. Read committed totalXp from PetClient. */
  amount: number;
  nowMs: number;
}

/**
 * Read-only consumer of the owner's PetClient contract.
 * Host injects the client, battle engine, and the growth owner's level XP curve.
 * No database access, token conversion, pet creation, or growth writes happen here.
 */
export class PetBattleIntegration implements BattleGateway {
  readonly #pets: Pick<PetClient, 'getActivePet' | 'listOwnedPets' | 'readOwnedPetGrowth'>;
  readonly #gateway: OwnedPetBattleGateway;
  readonly #selection: RoomSelectionClient | undefined;

  constructor(
    pets: Pick<PetClient, 'getActivePet' | 'listOwnedPets' | 'readOwnedPetGrowth'>,
    engine: BattleGateway,
    rules: BattleGrowthRules,
    selection?: RoomSelectionClient,
  ) {
    this.#pets = pets;
    this.#selection = selection;
    this.#gateway = new OwnedPetBattleGateway(pets, engine, rules, selection);
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    return this.#gateway.execute(command);
  }

  syncActivePet(nowMs = Date.now()): Promise<BattleResult> {
    return this.execute({ type: 'GET_STATE', nowMs });
  }

  /** Call after the growth owner successfully saves. Duplicate notifications are harmless. */
  async applyGrowthXp(notification: GrowthXpNotification): Promise<BattleResult | null> {
    const activePetId = this.#selection
      ? this.#selection.getSnapshot().activePetId
      : this.#pets.getActivePet()?.ownedPetId;
    if (activePetId !== notification.ownedPetId) return null;
    return this.syncActivePet(notification.nowMs);
  }
}
