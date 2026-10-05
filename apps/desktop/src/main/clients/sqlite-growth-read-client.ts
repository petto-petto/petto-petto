import type { GrowthReadClient, OwnedPetGrowthSnapshot } from '@pet/main-overlay/client';

import { PetGrowthRepository } from '../persistence/repositories/pet-growth-repository.ts';

/** Overlay growth owner adapter. Exposes committed growth without allowing writes. */
export class SqliteGrowthReadClient implements GrowthReadClient {
  readonly #repository: PetGrowthRepository;

  constructor(repository: PetGrowthRepository) {
    this.#repository = repository;
  }

  readOwnedPetGrowth(ownedPetIds: readonly string[]): ReadonlyMap<string, OwnedPetGrowthSnapshot> {
    const snapshots = this.#repository.loadAll();
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
}
