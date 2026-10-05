import type { BattleGrowthReader } from '@pet/battle/node';
import type { PetGrowthRepository } from '../persistence/repositories/pet-growth-repository.ts';

/** Expose only each room-owned pet's saved growth to battle; storage remains with the growth owner. */
export function createBattleGrowthReader(
  repository: Pick<PetGrowthRepository, 'loadAll'>,
): BattleGrowthReader {
  return {
    readOwnedPetGrowth(ownedPetIds) {
      const snapshots = repository.loadAll();
      const growth = new Map();
      for (const ownedPetId of ownedPetIds) {
        const snapshot = snapshots[ownedPetId];
        if (!snapshot) continue;
        growth.set(ownedPetId, {
          level: snapshot.pet.level,
          totalXp: snapshot.pet.totalXp,
          evolutionStage: snapshot.pet.evolutionStage,
        });
      }
      return growth;
    },
  };
}
