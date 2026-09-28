import type { PetClient } from '@pet/client';
import type { BattleCommand, BattleGateway, BattleResult, Rarity } from '../contracts.ts';
import { selectRandomPetSpectators } from '../view/scene.ts';

export interface BattleGrowthRules {
  levelXpCosts: number[];
  intervalLevels: Record<Rarity, number>;
}

/** Trusted PetClient snapshots are authoritative; renderer preview actions cannot grant XP. */
export class OwnedPetBattleGateway implements BattleGateway {
  readonly #pets: PetClient;
  readonly #engine: BattleGateway;
  readonly #rules: BattleGrowthRules;
  #queue: Promise<unknown> = Promise.resolve();
  #rosterKey = '';
  #spectators: string[] = [];

  constructor(pets: PetClient, engine: BattleGateway, rules: BattleGrowthRules) {
    this.#pets = pets;
    this.#engine = engine;
    this.#rules = rules;
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    const next = this.#queue.then(() => this.#execute(command));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #execute(command: BattleCommand): Promise<BattleResult> {
    const allowed = [
      'GET_STATE',
      'TOGGLE_BATTLE',
      'SET_BATTLE_RUNNING',
      'OVERLAY_CLICK',
      'TOGGLE_MENU',
      'PREVIEW_PET',
      'PREVIEW_ENEMY',
      'CYCLE_ENEMY_SIZE',
      'CYCLE_ENEMY_COLOR',
      'CYCLE_ENEMY_HP',
      'SET_DISPLAY_OPACITY',
      'CYCLE_PET_ASSET',
      'CYCLE_ATTACK_EFFECT',
      'TOGGLE_REDUCED_MOTION',
    ];
    if (!command || typeof command !== 'object' || !allowed.includes(command.type)) {
      throw new Error('전투 화면에서 성장·명부 변경은 허용하지 않습니다.');
    }
    const active = this.#pets.getActivePet();
    const pets = this.#pets.listOwnedPets().map((pet) => ({
      petId: pet.ownedPetId,
      displayName: pet.nickname ?? pet.name,
      rarity: pet.rarity,
      level: pet.level,
      sprite: pet.sprite,
      evolutionStage: pet.evolutionStage,
      totalXp: pet.totalXp,
    }));
    const rosterKey = JSON.stringify([active?.ownedPetId, pets.map((pet) => pet.petId)]);
    if (rosterKey !== this.#rosterKey) {
      this.#rosterKey = rosterKey;
      this.#spectators = active
        ? selectRandomPetSpectators(pets, active.ownedPetId).map((pet) => pet.petId)
        : [];
    }
    const sync = await this.#engine.execute({
      type: 'SYNC_OWNED_PETS',
      pets,
      activePetId: active?.ownedPetId ?? null,
      spectatorPetIds: this.#spectators,
      ...this.#rules,
      nowMs: Date.now(),
    });
    const result = await this.#engine.execute(
      'nowMs' in command ? { ...command, nowMs: Date.now() } : command,
    );
    return { state: result.state, events: [...sync.events, ...result.events] };
  }
}
