import { petId } from '@pet/core';
import type { PetClient } from '@pet/client';
import { stageOfLevel, type RoomCollection } from '@pet/room';
import { LEVEL_MAX, requiredXp } from '@pet/main-overlay/growth';
import type { SqliteFileDatabase } from './persistence/sqlite-file.ts';
import { RoomPetLinkRepository } from './persistence/repositories/room-pet-link-repository.ts';

/** App compatibility seam: import legacy identities once, then read the shared owner only. */
export class RoomPetBridge {
  readonly #database: SqliteFileDatabase;
  readonly #pets: PetClient;
  readonly #links: RoomPetLinkRepository;
  constructor(database: SqliteFileDatabase, pets: PetClient) {
    this.#database = database;
    this.#pets = pets;
    this.#links = new RoomPetLinkRepository(database);
  }

  initialize(legacy: RoomCollection): RoomCollection {
    return this.#database.transaction(() => {
      const existing = new Set(this.#pets.listOwnedPets().map((pet) => pet.ownedPetId));
      for (const pet of legacy.pets) {
        if (this.#links.find(pet.id)) continue;
        if (existing.has(pet.id)) {
          this.#links.save(pet.id, pet.id);
          continue;
        }
        if (!Number.isSafeInteger(pet.level) || pet.level < 1 || pet.level > LEVEL_MAX) {
          throw new Error(`펫룸 레벨을 이관할 수 없습니다: ${pet.id}`);
        }
        const created = this.#pets.createOwnedPets([pet.speciesPetId])[0];
        if (!created) throw new Error('펫룸 개체를 공통 목록에 생성하지 못했습니다.');
        // Legacy room has a level but no XP. Preserve it at the start of that level.
        const totalXp = Array.from({ length: pet.level - 1 }, (_, i) => requiredXp(i + 1)).reduce(
          (a, b) => a + b,
          0,
        );
        this.#pets.updateGrowth(created.ownedPetId, {
          level: pet.level,
          totalXp,
          xpIntoLevel: 0,
          evolutionStage: (stageOfLevel(pet.level) - 1) as 0 | 1 | 2,
        });
        if (pet.nickname !== undefined) this.#pets.updateNickname(created.ownedPetId, pet.nickname);
        this.#links.save(pet.id, created.ownedPetId);
        this.#links.save(created.ownedPetId, created.ownedPetId);
      }
      if (!this.#pets.getActivePet()) {
        const owned = this.#pets.listOwnedPets();
        const previous = this.#links.find(legacy.activePetId);
        const active = owned.find((pet) => pet.ownedPetId === previous) ?? owned[0];
        if (active) this.#pets.setActivePet(active.ownedPetId);
      }
      return this.collection();
    });
  }

  collection(): RoomCollection {
    const pets = this.#pets.listOwnedPets();
    return {
      activePetId: pets.find((pet) => pet.isActive)?.ownedPetId ?? '',
      pets: pets.map((pet) => ({
        id: pet.ownedPetId,
        speciesPetId: petId(pet.speciesId),
        level: pet.level,
        ...(pet.nickname === null ? {} : { nickname: pet.nickname }),
      })),
    };
  }

  select(id: string): RoomCollection {
    return this.#database.transaction(() => {
      this.#pets.setActivePet(id);
      return this.collection();
    });
  }
}
