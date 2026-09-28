import type { SqliteFileDatabase } from '../sqlite-file.ts';

/** Only this bridge's identity links live here. Pet rows are accessed through PetClient. */
export class RoomPetLinkRepository {
  readonly #database: SqliteFileDatabase;
  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }
  find(id: string): string | undefined {
    return this.#database
      .prepare<[string], { owned_pet_id: string }>(
        'SELECT owned_pet_id FROM room_pet_client_links WHERE room_pet_id = ?',
      )
      .get(id)?.owned_pet_id;
  }
  save(roomId: string, ownedId: string): void {
    this.#database
      .prepare<[string, string]>(
        'INSERT INTO room_pet_client_links (room_pet_id, owned_pet_id) VALUES (?, ?)',
      )
      .run(roomId, ownedId);
  }
}
