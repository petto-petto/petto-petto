import type { OwnedPet, PetClient, TokenClient, UsageEntry } from '@pet/client';
import { applyTokenGrowth } from '@pet/main-overlay/growth';
import type { SqliteFileDatabase } from './persistence/sqlite-file.ts';
import { GrowthTokenRepository } from './persistence/repositories/growth-token-repository.ts';

/** Ingress owns deduplication; growth owns conversion; battle only reads committed PetClient XP. */
export class TokenGrowthLink {
  readonly #database: SqliteFileDatabase;
  readonly #tokens: TokenClient;
  readonly #pets: PetClient;
  readonly #carry: GrowthTokenRepository;

  constructor(database: SqliteFileDatabase, tokens: TokenClient, pets: PetClient) {
    this.#database = database;
    this.#tokens = tokens;
    this.#pets = pets;
    this.#carry = new GrowthTokenRepository(database);
  }

  record(entry: UsageEntry, inputOutputTokens: number): OwnedPet | null {
    if (
      !Number.isSafeInteger(inputOutputTokens) ||
      inputOutputTokens < 0 ||
      inputOutputTokens > entry.reward
    ) {
      throw new Error('입력·출력 토큰 증가분이 올바르지 않습니다.');
    }
    return this.#database.transaction(() => {
      if (!this.#tokens.recordUsage(entry)) return null;
      const active = this.#pets.getActivePet();
      if (!active) return null; // No pet: retain usage, never backfill XP to a future pet.
      const result = applyTokenGrowth(
        { ...active, id: active.ownedPetId, evolutionAvailable: false },
        inputOutputTokens,
        this.#carry.remainder(active.ownedPetId),
      );
      this.#carry.save(active.ownedPetId, result.remainder);
      if (result.gainedXp === 0) return active;
      const next = result.pet;
      return this.#pets.updateGrowth(active.ownedPetId, {
        level: next.level,
        totalXp: next.totalXp,
        xpIntoLevel: next.xpIntoLevel,
        evolutionStage: active.evolutionStage,
      });
    });
  }
}
