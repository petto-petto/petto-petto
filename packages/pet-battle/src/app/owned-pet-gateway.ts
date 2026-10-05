import type { PetClient } from '@pet/client';
import type { RoomSelectionClient } from '@pet/room';
import type { BattleCommand, BattleResult, Rarity } from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import { assertBattleClientCommand } from './client-policy.ts';
import { selectRandomPetSpectators } from '../view/scene.ts';
import { ownedGrowthPet, RoomBattlePetAdapter } from './room-pets.ts';

export interface BattleGrowthRules {
  levelXpCosts: number[];
  /** Legacy wire compatibility; owned-pet progression uses the same [2, 2, 3] for every rarity. */
  intervalLevels: Record<Rarity, number>;
}

/** Trusted PetClient snapshots are authoritative; renderer preview actions cannot grant XP. */
export class OwnedPetBattleGateway implements BattleGateway {
  readonly #pets: Pick<PetClient, 'getActivePet' | 'listOwnedPets'>;
  readonly #engine: BattleGateway;
  readonly #rules: BattleGrowthRules;
  readonly #room: RoomBattlePetAdapter | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #rosterKey = '';
  #spectators: string[] = [];

  constructor(
    pets: Pick<PetClient, 'getActivePet' | 'listOwnedPets'>,
    engine: BattleGateway,
    rules: BattleGrowthRules,
    selection?: RoomSelectionClient,
  ) {
    this.#pets = pets;
    this.#engine = engine;
    this.#rules = rules;
    this.#room = selection && new RoomBattlePetAdapter(selection, pets);
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    const next = this.#queue.then(() => this.#execute(command));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #execute(command: BattleCommand): Promise<BattleResult> {
    assertBattleClientCommand(command);
    const room = this.#room?.getSnapshot();
    const activePetId = room ? room.activePetId : (this.#pets.getActivePet()?.ownedPetId ?? null);
    const pets = room ? room.pets : this.#pets.listOwnedPets().map(ownedGrowthPet);
    const rosterKey = JSON.stringify([activePetId, pets.map((pet) => pet.petId)]);
    if (rosterKey !== this.#rosterKey) {
      this.#rosterKey = rosterKey;
      this.#spectators =
        activePetId !== null
          ? selectRandomPetSpectators(pets, activePetId).map((pet) => pet.petId)
          : [];
    }
    const sync = await this.#engine.execute({
      type: 'SYNC_OWNED_PETS',
      pets,
      activePetId,
      spectatorPetIds: this.#spectators,
      ...this.#rules,
      nowMs: Date.now(),
    });
    const result = await this.#engine.execute(
      'nowMs' in command ? { ...command, nowMs: Date.now() } : command,
    );
    return {
      state: room
        ? { ...result.state, selectionSource: 'ROOM', growthStatus: room.growthStatus }
        : result.state,
      events: [...sync.events, ...result.events],
    };
  }
}
