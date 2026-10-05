import { randomUUID } from 'node:crypto';

import type { DexEntry, OwnedPet, PetGrowth, PetSpecies, Rarity } from '@pet/client';
import { systemClock, type Clock } from '@pet/core';

import { SqliteFileDatabase } from '../sqlite-file.ts';

interface OwnedPetRow extends Omit<OwnedPet, 'isActive'> {
  isActive: number;
}

interface DexRow extends PetSpecies {
  discoveredAt: string | null;
  seenAt: string | null;
  ownedCount: number;
  highestLevel: number;
  highestStage: PetGrowth['evolutionStage'] | null;
}

const SPECIES_SELECT = `SELECT species_id AS speciesId, name, rarity, sprite FROM pet_species`;
const OWNED_SELECT = `
  SELECT p.owned_pet_id AS ownedPetId, p.species_id AS speciesId,
         s.name, s.rarity, s.sprite, p.nickname, p.level,
         p.total_xp AS totalXp, p.xp_into_level AS xpIntoLevel,
         p.evolution_stage AS evolutionStage, p.is_active AS isActive
  FROM owned_pets p JOIN pet_species s ON s.species_id = p.species_id
`;
const DEX_SELECT = `
  SELECT s.species_id AS speciesId, s.name, s.rarity, s.sprite,
         d.discovered_at AS discoveredAt, d.seen_at AS seenAt,
         COUNT(p.owned_pet_id) AS ownedCount,
         COALESCE(MAX(p.level), 0) AS highestLevel,
         MAX(p.evolution_stage) AS highestStage
  FROM pet_species s
  LEFT JOIN pet_discoveries d ON d.species_id = s.species_id
  LEFT JOIN owned_pets p ON p.species_id = s.species_id
  GROUP BY s.species_id
  ORDER BY CASE s.rarity WHEN 'COMMON' THEN 0 WHEN 'RARE' THEN 1 ELSE 2 END, s.species_id
`;

/** 공용 DB의 펫 테이블만 접근하는 구체 Repository. 연결 수명주기는 host가 소유한다. */
export class PetRepository {
  readonly #database: SqliteFileDatabase;
  /** 도감의 첫 만남·확인 시각. 테스트가 고정할 수 있게 주입받는다. */
  readonly #clock: Clock;

  constructor(database: SqliteFileDatabase, clock: Clock = systemClock) {
    this.#database = database;
    this.#clock = clock;
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

  listDexEntries(): DexEntry[] {
    return this.#database.prepare<[], DexRow>(DEX_SELECT).all().map(toDexEntry);
  }

  markDexSeen(speciesId: string): void {
    this.#database.transaction(() => {
      const found = this.#database
        .prepare<[string], { seenAt: string | null }>(
          'SELECT seen_at AS seenAt FROM pet_discoveries WHERE species_id = ?',
        )
        .get(speciesId);
      if (!found) throw new Error(`발견하지 않은 종입니다: ${speciesId}`);
      if (found.seenAt !== null) return;
      this.#database
        .prepare<[string, string]>('UPDATE pet_discoveries SET seen_at = ? WHERE species_id = ?')
        .run(this.#clock.now().toISOString(), speciesId);
    });
  }

  /** 개체 생성은 언제나 이 길을 지난다. 발견을 같은 트랜잭션에 남겨, 펫만 생기고 발견이 빠지지 않게 한다. */
  #insertPet(speciesId: string): OwnedPet {
    const ownedPetId = randomUUID();
    this.#database
      .prepare<[string, string]>('INSERT INTO owned_pets (owned_pet_id, species_id) VALUES (?, ?)')
      .run(ownedPetId, speciesId);
    this.#database
      .prepare<[string, string]>(
        'INSERT OR IGNORE INTO pet_discoveries (species_id, discovered_at, seen_at) VALUES (?, ?, NULL)',
      )
      .run(speciesId, this.#clock.now().toISOString());
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

function toDexEntry(row: DexRow): DexEntry {
  return {
    species: { speciesId: row.speciesId, name: row.name, rarity: row.rarity, sprite: row.sprite },
    discoveredAt: row.discoveredAt,
    ownedCount: row.ownedCount,
    highestLevel: row.highestLevel,
    highestStage: row.highestStage,
    isNew: row.discoveredAt !== null && row.seenAt === null,
  };
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
