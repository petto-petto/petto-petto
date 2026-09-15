import type { OwnedPet, PetClient, PetGrowth, PetSpecies, Rarity } from '@pet/client';

import { PetRepository } from '../persistence/repositories/pet-repository.ts';

/** 소비자는 PetClient만 의존하고, host가 열린 DB의 Repository를 이 구현체에 주입한다. */
export class SqlitePetClient implements PetClient {
  readonly #repository: PetRepository;

  constructor(repository: PetRepository) {
    this.#repository = repository;
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
