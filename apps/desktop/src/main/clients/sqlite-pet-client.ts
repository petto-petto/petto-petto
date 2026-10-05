import type {
  OwnedPet,
  OwnedPetGrowthSnapshot,
  PetClient,
  PetGrowth,
  PetSpecies,
  Rarity,
} from '@pet/client';

import { PetRepository } from '../persistence/repositories/pet-repository.ts';
import { PetGrowthRepository } from '../persistence/repositories/pet-growth-repository.ts';

/** 소비자는 PetClient만 의존하고, host가 열린 DB의 Repository를 이 구현체에 주입한다. */
export class SqlitePetClient implements PetClient {
  readonly #repository: PetRepository;
  readonly #growthRepository: PetGrowthRepository;

  constructor(repository: PetRepository, growthRepository: PetGrowthRepository) {
    this.#repository = repository;
    this.#growthRepository = growthRepository;
  }

  listSpecies(rarity?: Rarity): PetSpecies[] {
    return this.#repository.listSpecies(rarity);
  }

  countSpecies(rarity?: Rarity): number {
    return this.#repository.countSpecies(rarity);
  }

  listOwnedPets(speciesId?: string): OwnedPet[] {
    return this.#repository.listOwnedPets(speciesId);
  }

  readOwnedPetGrowth(ownedPetIds: readonly string[]): ReadonlyMap<string, OwnedPetGrowthSnapshot> {
    const snapshots = this.#growthRepository.loadAll();
    const growth = new Map<string, OwnedPetGrowthSnapshot>();
    for (const ownedPetId of ownedPetIds) {
      const snapshot = snapshots[ownedPetId];
      if (!snapshot) continue;
      growth.set(ownedPetId, {
        level: snapshot.pet.level,
        totalXp: snapshot.pet.totalXp,
        evolutionStage:
          snapshot.pet.evolutionStage <= 0 ? 0 : snapshot.pet.evolutionStage === 1 ? 1 : 2,
      });
    }
    return growth;
  }

  getOwnedPet(ownedPetId: string): OwnedPet {
    return this.#repository.getOwnedPet(ownedPetId);
  }

  countOwnedPets(): number {
    return this.#repository.countOwnedPets();
  }

  countOwnedSpecies(): number {
    return this.#repository.countOwnedSpecies();
  }

  getHighestLevel(): number {
    return this.#repository.getHighestLevel();
  }

  getActivePet(): OwnedPet | null {
    return this.#repository.getActivePet();
  }

  createOwnedPets(speciesIds: readonly string[]): OwnedPet[] {
    return this.#repository.createOwnedPets(speciesIds);
  }

  updateNickname(ownedPetId: string, nickname: string | null): OwnedPet {
    return this.#repository.updateNickname(ownedPetId, nickname);
  }

  updateGrowth(ownedPetId: string, growth: PetGrowth): OwnedPet {
    return this.#repository.updateGrowth(ownedPetId, growth);
  }

  setActivePet(ownedPetId: string): OwnedPet {
    return this.#repository.setActivePet(ownedPetId);
  }

  replaceOwnedPets(materialOwnedPetIds: readonly string[], resultSpeciesId: string): OwnedPet {
    return this.#repository.replaceOwnedPets(materialOwnedPetIds, resultSpeciesId);
  }
}
