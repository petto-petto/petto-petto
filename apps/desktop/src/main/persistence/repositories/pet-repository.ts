import { randomUUID } from 'node:crypto';

import type { OwnedPet, PetGrowth, PetSpecies, Rarity } from '@pet/client';

import { SqliteFileDatabase } from '../sqlite-file.ts';

interface OwnedPetRow extends Omit<OwnedPet, 'isActive'> {
  isActive: number;
}

const SPECIES_SELECT = `SELECT species_id AS speciesId, name, rarity, sprite FROM pet_species`;
const OWNED_SELECT = `
  SELECT p.owned_pet_id AS ownedPetId, p.species_id AS speciesId,
         s.name, s.rarity, s.sprite, p.nickname, p.level,
         p.total_xp AS totalXp, p.xp_into_level AS xpIntoLevel,
         p.evolution_stage AS evolutionStage, p.is_active AS isActive
  FROM owned_pets p JOIN pet_species s ON s.species_id = p.species_id
`;

/** 공용 DB의 펫 테이블만 접근하는 구체 Repository. 연결 수명주기는 host가 소유한다. */
export class PetRepository {
  readonly #database: SqliteFileDatabase;

  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }

  listSpecies(rarity?: Rarity): PetSpecies[] {
    if (rarity === undefined) {
      return this.#database.prepare<[], PetSpecies>(`${SPECIES_SELECT} ORDER BY species_id`).all();
    }
    validateRarity(rarity);
    return this.#database
      .prepare<[Rarity], PetSpecies>(`${SPECIES_SELECT} WHERE rarity = ? ORDER BY species_id`)
      .all(rarity);
  }

  countSpecies(rarity?: Rarity): number {
    if (rarity === undefined) return this.#count('SELECT COUNT(*) AS count FROM pet_species');
    validateRarity(rarity);
    return this.#count('SELECT COUNT(*) AS count FROM pet_species WHERE rarity = ?', [rarity]);
  }

  listOwnedPets(speciesId?: string): OwnedPet[] {
    const rows =
      speciesId === undefined
        ? this.#database.prepare<[], OwnedPetRow>(`${OWNED_SELECT} ORDER BY p.owned_pet_id`).all()
        : this.#database
            .prepare<[string], OwnedPetRow>(
              `${OWNED_SELECT} WHERE p.species_id = ? ORDER BY p.owned_pet_id`,
            )
            .all(speciesId);
    return rows.map(toOwnedPet);
  }

  getOwnedPet(ownedPetId: string): OwnedPet {
    const row = this.#database
      .prepare<[string], OwnedPetRow>(`${OWNED_SELECT} WHERE p.owned_pet_id = ?`)
      .get(ownedPetId);
    if (!row) throw new Error(`보유 펫을 찾을 수 없습니다: ${ownedPetId}`);
    return toOwnedPet(row);
  }

  countOwnedPets(): number {
    return this.#count('SELECT COUNT(*) AS count FROM owned_pets');
  }

  countOwnedSpecies(): number {
    return this.#count('SELECT COUNT(DISTINCT species_id) AS count FROM owned_pets');
  }

  getHighestLevel(): number {
    return this.#count('SELECT COALESCE(MAX(level), 0) AS count FROM owned_pets');
  }

  getActivePet(): OwnedPet | null {
    const row = this.#database
      .prepare<[], OwnedPetRow>(`${OWNED_SELECT} WHERE p.is_active = 1`)
      .get();
    return row ? toOwnedPet(row) : null;
  }

  createOwnedPets(speciesIds: readonly string[]): OwnedPet[] {
    return this.#database.transaction(() => speciesIds.map((id) => this.#insertPet(id)));
  }

  updateNickname(ownedPetId: string, nickname: string | null): OwnedPet {
    return this.#database.transaction(() => {
      this.#database
        .prepare<[string | null, string]>(
          'UPDATE owned_pets SET nickname = ? WHERE owned_pet_id = ?',
        )
        .run(nickname?.trim() || null, ownedPetId);
      return this.getOwnedPet(ownedPetId);
    });
  }

  updateGrowth(ownedPetId: string, growth: PetGrowth): OwnedPet {
    validateGrowth(growth);
    return this.#database.transaction(() => {
      this.#database
        .prepare<[number, number, number, number, string]>(
          `
        UPDATE owned_pets SET level = ?, total_xp = ?, xp_into_level = ?, evolution_stage = ?
        WHERE owned_pet_id = ?
      `,
        )
        .run(growth.level, growth.totalXp, growth.xpIntoLevel, growth.evolutionStage, ownedPetId);
      return this.getOwnedPet(ownedPetId);
    });
  }

  setActivePet(ownedPetId: string): OwnedPet {
    return this.#database.transaction(() => {
      this.getOwnedPet(ownedPetId);
      this.#database.exec('UPDATE owned_pets SET is_active = 0 WHERE is_active = 1');
      this.#database
        .prepare<[string]>('UPDATE owned_pets SET is_active = 1 WHERE owned_pet_id = ?')
        .run(ownedPetId);
      return this.getOwnedPet(ownedPetId);
    });
  }

  replaceOwnedPets(materialOwnedPetIds: readonly string[], resultSpeciesId: string): OwnedPet {
    if (
      materialOwnedPetIds.length === 0 ||
      new Set(materialOwnedPetIds).size !== materialOwnedPetIds.length
    ) {
      throw new Error('합성 재료는 비어 있지 않은 서로 다른 개체 ID여야 합니다.');
    }
    return this.#database.transaction(() => {
      const remove = this.#database.prepare<[string]>(
        'DELETE FROM owned_pets WHERE owned_pet_id = ? AND is_active = 0',
      );
      for (const id of materialOwnedPetIds) {
        if (remove.run(id).changes !== 1) {
          throw new Error(`합성 재료가 없거나 활성 펫입니다: ${id}`);
        }
      }
      // FK 위반·INSERT 실패도 앞서 삭제한 재료와 함께 rollback된다.
      return this.#insertPet(resultSpeciesId);
    });
  }

  #insertPet(speciesId: string): OwnedPet {
    const ownedPetId = randomUUID();
    this.#database
      .prepare<[string, string]>('INSERT INTO owned_pets (owned_pet_id, species_id) VALUES (?, ?)')
      .run(ownedPetId, speciesId);
    return this.getOwnedPet(ownedPetId);
  }

  #count(sql: string, parameters: string[] = []): number {
    const row = this.#database.prepare<string[], { count: number }>(sql).get(...parameters);
    if (!row) throw new Error('펫 집계 결과를 읽을 수 없습니다.');
    return row.count;
  }
}

function toOwnedPet(row: OwnedPetRow): OwnedPet {
  return { ...row, isActive: row.isActive === 1 };
}

function validateRarity(rarity: Rarity): void {
  if (rarity !== 'COMMON' && rarity !== 'RARE' && rarity !== 'EPIC') {
    throw new Error(`유효하지 않은 펫 등급입니다: ${String(rarity)}`);
  }
}

function validateGrowth(growth: PetGrowth): void {
  if (
    !Number.isSafeInteger(growth.level) ||
    growth.level < 1 ||
    !Number.isSafeInteger(growth.totalXp) ||
    growth.totalXp < 0 ||
    !Number.isSafeInteger(growth.xpIntoLevel) ||
    growth.xpIntoLevel < 0 ||
    !Number.isInteger(growth.evolutionStage) ||
    growth.evolutionStage < 0 ||
    growth.evolutionStage > 2
  ) {
    throw new Error('펫 성장 값은 유효한 정수와 진화 단계여야 합니다.');
  }
}
