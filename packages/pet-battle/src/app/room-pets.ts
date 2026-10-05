import type { OwnedPet, PetClient } from '@pet/client';
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

/** Room owns selection; PetClient owns real growth. Battle only projects the two reads. */
export class RoomBattlePetAdapter {
  readonly #selection: RoomSelectionClient;
  readonly #growth: Pick<PetClient, 'listOwnedPets'>;

  constructor(selection: RoomSelectionClient, growth: Pick<PetClient, 'listOwnedPets'>) {
    this.#selection = selection;
    this.#growth = growth;
  }

  getSnapshot(): {
    pets: GrowthPet[];
    activePetId: string | null;
    growthStatus: Exclude<BattleState['growthStatus'], undefined>;
  } {
    const room = this.#selection.getSnapshot();
    const owned = new Map(this.#growth.listOwnedPets().map((pet) => [pet.ownedPetId, pet]));
    const pets = room.pets.map((pet): GrowthPet => {
      const linked = owned.get(pet.ownedPetId);
      if (linked) {
        if (linked.speciesId !== pet.petId || linked.sprite !== pet.slug) {
          throw new Error(`펫 개체 정보 불일치: ${pet.ownedPetId}`);
        }
        return ownedGrowthPet(linked);
      }
      return {
        petId: pet.ownedPetId,
        displayName: pet.name,
        rarity: pet.rarity,
        level: pet.level,
        sprite: pet.slug,
        evolutionStage: pet.stage === 3 ? 2 : pet.stage === 2 ? 1 : 0,
        // Legacy room JSON has no XP. Do not turn its level into fabricated growth.
        totalXp: null,
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
