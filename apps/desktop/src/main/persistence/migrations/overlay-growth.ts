import type { SqliteMigration } from '../sqlite-file.ts';

export const OVERLAY_GROWTH_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'overlay-growth',
    version: 1,
    name: 'create pet growth profiles',
    up(database) {
      database.exec(`
        CREATE TABLE pet_profiles (
          pet_key TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          level INTEGER NOT NULL CHECK (level >= 1),
          xp_into_level INTEGER NOT NULL CHECK (xp_into_level >= 0),
          total_xp INTEGER NOT NULL CHECK (total_xp >= 0),
          evolution_stage INTEGER NOT NULL CHECK (evolution_stage BETWEEN 0 AND 2),
          token_bank INTEGER NOT NULL CHECK (token_bank >= 0),
          last_base_xp INTEGER NOT NULL CHECK (last_base_xp >= 0),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE overlay_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];
