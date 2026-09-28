import type { SqliteMigration } from '../sqlite-file.ts';

export const ROOM_PET_CLIENT_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'room-pet-client',
    version: 1,
    name: 'link legacy room identities to shared pets',
    up(database) {
      // Keep the mapping after a pet is removed: restarting must not recreate it.
      database.exec(`CREATE TABLE room_pet_client_links (
      room_pet_id TEXT PRIMARY KEY NOT NULL,
      owned_pet_id TEXT NOT NULL
    )`);
    },
  },
];
