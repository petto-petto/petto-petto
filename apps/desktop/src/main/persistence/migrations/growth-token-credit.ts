import type { SqliteMigration } from '../sqlite-file.ts';

export const GROWTH_TOKEN_CREDIT_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'growth-token-credit',
    version: 1,
    name: 'retain per pet growth token remainder',
    up(database) {
      database.exec(`CREATE TABLE growth_token_remainders (
      owned_pet_id TEXT PRIMARY KEY NOT NULL,
      remainder INTEGER NOT NULL CHECK(typeof(remainder) = 'integer' AND remainder >= 0 AND remainder < 5000)
    )`);
    },
  },
];
