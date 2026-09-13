import type { SqliteMigration } from '../sqlite-file.ts';

export const PET_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'pet',
    version: 1,
    name: 'create pet catalog and owned pets',
    up(database) {
      database.exec(`
        CREATE TABLE pet_species (
          species_id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          rarity TEXT NOT NULL CHECK (rarity IN ('COMMON', 'RARE', 'EPIC')),
          sprite TEXT NOT NULL UNIQUE
        );
        CREATE INDEX pet_species_rarity ON pet_species(rarity);

        CREATE TABLE owned_pets (
          owned_pet_id TEXT PRIMARY KEY NOT NULL,
          species_id TEXT NOT NULL REFERENCES pet_species(species_id) ON DELETE RESTRICT,
          nickname TEXT,
          level INTEGER NOT NULL DEFAULT 1 CHECK (typeof(level) = 'integer' AND level >= 1),
          total_xp INTEGER NOT NULL DEFAULT 0 CHECK (typeof(total_xp) = 'integer' AND total_xp >= 0),
          xp_into_level INTEGER NOT NULL DEFAULT 0 CHECK (typeof(xp_into_level) = 'integer' AND xp_into_level >= 0),
          evolution_stage INTEGER NOT NULL DEFAULT 0 CHECK (evolution_stage IN (0, 1, 2)),
          is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
        );
        CREATE INDEX owned_pets_species ON owned_pets(species_id);
        CREATE UNIQUE INDEX one_active_pet ON owned_pets(is_active) WHERE is_active = 1;

        INSERT INTO pet_species (species_id, name, rarity, sprite) VALUES
          ('001', '도토리다람쥐', 'EPIC', 'acorn_squirrel'),
          ('002', '미드나잇얼룩말', 'RARE', 'midnight_zebra'),
          ('003', '두더지', 'COMMON', 'mole_digger'),
          ('004', '새싹나무', 'COMMON', 'sprout_treant'),
          ('005', '볼주머니햄', 'RARE', 'cheek_hamster'),
          ('006', '별빛마법사', 'EPIC', 'star_wizard');
      `);
    },
  },
];
