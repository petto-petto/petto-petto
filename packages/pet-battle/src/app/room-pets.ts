import type { OwnedPet, PetClient } from '@pet/client';
import type { GrowthReadClient } from '@pet/main-overlay/client';
import type { RoomSelectionClient } from '@pet/room';
import type { BattleCommand, BattleState } from '../contracts.ts';

type GrowthPet = Extract<BattleCommand, { type: 'SYNC_OWNED_PETS' }>['pets'][number];

export function ownedGrowthPet(pet: OwnedPet): GrowthPet {
  return {
    petId: pet.ownedPetId,
    displayName: pet.nickname ?? pet.name,
    rarity: pet.rarity,
    level: pet.level,
    sprite: pet.sprite,
    evolutionStage: pet.evolutionStage,
    totalXp: pet.totalXp,
  };
}

/** Room owns selection, PetClient owns the roster, and Overlay owns saved growth. */
export class RoomBattlePetAdapter {
  readonly #selection: RoomSelectionClient;
  readonly #pets: Pick<PetClient, 'listOwnedPets'>;
  readonly #growth: GrowthReadClient;

  constructor(
    selection: RoomSelectionClient,
    pets: Pick<PetClient, 'listOwnedPets'>,
    growth: GrowthReadClient,
  ) {
    this.#selection = selection;
    this.#pets = pets;
    this.#growth = growth;
  }

  getSnapshot(): {
    pets: GrowthPet[];
    activePetId: string | null;
    growthStatus: Exclude<BattleState['growthStatus'], undefined>;
  } {
    const room = this.#selection.getSnapshot();
    const owned = new Map(this.#pets.listOwnedPets().map((pet) => [pet.ownedPetId, pet]));
    const persisted = this.#growth.readOwnedPetGrowth(room.pets.map((pet) => pet.ownedPetId));
    const pets = room.pets.map((pet): GrowthPet => {
      const linked = owned.get(pet.ownedPetId);
      const saved = persisted.get(pet.ownedPetId);
      if (linked) {
        if (linked.speciesId !== pet.petId || linked.sprite !== pet.slug) {
          throw new Error(`펫 개체 정보 불일치: ${pet.ownedPetId}`);
        }
        return {
          ...ownedGrowthPet(linked),
          level: saved?.level ?? linked.level,
          evolutionStage: saved?.evolutionStage ?? linked.evolutionStage,
          totalXp: saved?.totalXp ?? linked.totalXp,
        };
      }
      return {
        petId: pet.ownedPetId,
        displayName: pet.name,
        rarity: pet.rarity,
        level: saved?.level ?? pet.level,
        sprite: pet.slug,
        evolutionStage: saved?.evolutionStage ?? (pet.stage === 3 ? 2 : pet.stage === 2 ? 1 : 0),
        // Legacy room JSON has no XP. Do not turn its level into fabricated growth.
        totalXp: saved?.totalXp ?? null,
      };
    });
    const active = pets.find((pet) => pet.petId === room.activePetId);
    if (room.activePetId !== null && !active) throw new Error('펫룸 활성 개체가 명부에 없습니다');
    return {
      pets,
      activePetId: room.activePetId,
      growthStatus: active ? (active.totalXp === null ? 'UNLINKED' : 'LINKED') : null,
    };
  }
}
