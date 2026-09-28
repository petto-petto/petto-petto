import type { SqliteFileDatabase } from '../sqlite-file.ts';

export class GrowthTokenRepository {
  readonly database: SqliteFileDatabase;
  constructor(database: SqliteFileDatabase) {
    this.database = database;
  }

  remainder(ownedPetId: string): number {
    return (
      this.database
        .prepare<[string], { remainder: number }>(
          'SELECT remainder FROM growth_token_remainders WHERE owned_pet_id = ?',
        )
        .get(ownedPetId)?.remainder ?? 0
    );
  }

  save(ownedPetId: string, remainder: number): void {
    this.database
      .prepare(
        `INSERT INTO growth_token_remainders(owned_pet_id, remainder) VALUES (?, ?)
      ON CONFLICT(owned_pet_id) DO UPDATE SET remainder = excluded.remainder`,
      )
      .run(ownedPetId, remainder);
  }
}
