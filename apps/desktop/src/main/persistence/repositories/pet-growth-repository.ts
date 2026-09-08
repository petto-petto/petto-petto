import { existsSync } from 'node:fs';

import Database from 'better-sqlite3';

import type { EvolutionStage, PetGrowth, PetGrowthSeed } from '@pet/room';

import { LEGACY_SPECIES_PROFILE_TABLE } from '../migrations/overlay-growth.ts';
import { SqliteFileDatabase } from '../sqlite-file.ts';

const LEGACY_DATABASE_MIGRATION_KEY = 'migration.database.pet-overlay-v1';
const OWNED_PET_ADOPTION_KEY = 'migration.profiles.owned-pet-v1';

interface PersistedPet {
  id: string;
  name: string;
  level: number;
  xpIntoLevel: number;
  totalXp: number;
  evolutionStage: number;
  evolutionAvailable: boolean;
}

/** 한 개체의 성장 기록. `petKey`는 스프라이트를 고르는 종이고, 키는 개체 id다. */
export interface PetGrowthSnapshot {
  petKey: string;
  pet: PersistedPet;
  tokenBank: number;
  lastBaseXp: number;
}

/** 개체 id → 성장 기록. */
export type PetGrowthSnapshots = Record<string, PetGrowthSnapshot>;

export interface PetGrowthRepositoryOptions {
  legacyDatabasePaths?: readonly string[];
}

interface OwnedProfileRow {
  owned_pet_id: string;
  pet_key: string;
  display_name: string;
  level: number;
  xp_into_level: number;
  total_xp: number;
  evolution_stage: number;
  token_bank: number;
  last_base_xp: number;
}

interface SpeciesProfileRow {
  pet_key: string;
  display_name: string;
  level: number;
  xp_into_level: number;
  total_xp: number;
  evolution_stage: number;
  token_bank: number;
  last_base_xp: number;
}

/**
 * 오버레이의 성장·진화 기록을 공용 SQLite에 영속화한다.
 *
 * ## 이 저장소가 정본인 것
 *
 * 레벨·경험치·진화 횟수. 명부(`room-state.json`)에 같은 값이 있지만 그쪽은 **투영**이고,
 * 쓰기는 여기서 시작해 한 방향으로만 흐른다(`@pet/room`의 `withPetGrowth` 참조).
 *
 * ## 개체 단위인 이유
 *
 * 종을 키로 쓰면 같은 종 두 마리의 성장이 한 행에서 합쳐진다. v2 migration이 테이블을
 * 개체 키로 바꾸고, 종 단위였던 옛 행은 `adoptRoster`가 명부를 보고 한 번 이관한다.
 */
export class PetGrowthRepository {
  readonly #database: SqliteFileDatabase;
  readonly #legacyDatabasePaths: readonly string[];

  constructor(
    database: SqliteFileDatabase,
    { legacyDatabasePaths = [] }: PetGrowthRepositoryOptions = {},
  ) {
    this.#database = database;
    this.#legacyDatabasePaths = legacyDatabasePaths;
  }

  /** 별도 파일을 쓰던 구버전 overlay 데이터를 공용 DB로 한 번만 가져온다. */
  migrateLegacyData(): void {
    this.#migrateLegacyDatabase();
  }

  /**
   * 명부의 모든 개체가 성장 행을 갖게 하고, 그 성장값을 돌려준다.
   *
   * 첫 실행에서는 종 단위였던 옛 행을 **명부 순서대로 종별 한 마리씩** 물려준다. 어느 개체가
   * 그 종의 성장을 이어받을지는 임의 선택이 아니라 명부의 순서로 정해 재현 가능하게 둔다.
   *
   * 물려받을 것이 없는 개체는 명부가 말하는 레벨·진화 단계로 시작한다 — 시드 명부가 stage
   * 1·2·3을 모두 내도록 짜여 있어서(`seedCollection`), 0으로 깔면 펫룸이 stage1 한 종류로
   * 납작해진다.
   */
  adoptRoster(roster: readonly PetGrowthSeed[]): Map<string, PetGrowth> {
    // 빈 명부로 이관을 끝났다고 적으면, 물려줄 개체가 나타나기도 전에 옛 종 행이 영구
    // 고아가 된다. 받을 사람이 없으면 아무것도 하지 않는다.
    if (roster.length === 0) return this.growth();

    this.#database.transaction(() => {
      const unclaimed = this.#hasMetadata(OWNED_PET_ADOPTION_KEY)
        ? new Map<string, SpeciesProfileRow[]>()
        : this.#speciesRowsByKey();
      const existing = new Set(Object.keys(this.loadAll()));

      for (const seed of roster) {
        if (existing.has(seed.ownedPetId)) {
          // 성장 수치는 그대로 두고 명부가 소유한 값(표시명·종)만 따라가게 한다.
          this.#syncIdentity(seed);
          continue;
        }
        const inherited = unclaimed.get(seed.petKey)?.shift();
        this.#upsertAll({ [seed.ownedPetId]: snapshotFor(seed, inherited) });
        // 같은 id 가 명부에 두 번 있어도 두 번째가 첫 번째를 덮어쓰지 않는다.
        existing.add(seed.ownedPetId);
      }

      this.#setMetadata(OWNED_PET_ADOPTION_KEY, new Date().toISOString());
    });

    return this.growth();
  }

  /**
   * 명부의 모든 개체를 성장 이전 상태로 되돌린다.
   *
   * "저장 초기화"가 쓰는 경로다. 되돌릴 기준을 **명부에서 읽으면 안 된다** — 명부의 레벨은
   * 이미 성장이 투영된 값이라, 그걸 씨앗으로 쓰면 레벨만 살아남고 경험치만 0이 되는
   * 모순된 기록이 남는다. 초기화는 모두를 Lv.1 · 진화 0회로 되돌리는 것이다.
   *
   * 명부에 없는 개체의 행은 **회수 없이 사라진다.** 초기화의 뜻에 맞고, 지금은 이것이 고아
   * 행을 청소하는 유일한 경로이기도 하다.
   */
  resetGrowth(roster: readonly PetGrowthSeed[]): Map<string, PetGrowth> {
    this.#database.transaction(() => {
      this.#database.exec('DELETE FROM pet_profiles');
      for (const seed of roster) {
        this.#upsertAll({
          [seed.ownedPetId]: snapshotFor({ ...seed, level: 1, evolutionStage: 0 }, undefined),
        });
      }
    });
    return this.growth();
  }

  /** 성장 수치를 건드리지 않으므로 `updated_at` 도 올리지 않는다 — 그 칸은 성장이 바뀐 시각이다. */
  #syncIdentity(seed: PetGrowthSeed): void {
    this.#database
      .prepare<[string, string, string]>(
        'UPDATE pet_profiles SET pet_key = ?, display_name = ? WHERE owned_pet_id = ?',
      )
      .run(seed.petKey, seed.displayName, seed.ownedPetId);
  }

  /** 명부에 투영할 값만 추린 것. */
  growth(): Map<string, PetGrowth> {
    const growth = new Map<string, PetGrowth>();
    for (const [ownedPetId, snapshot] of Object.entries(this.loadAll())) {
      growth.set(ownedPetId, {
        level: snapshot.pet.level,
        evolutionStage: evolutionStageOf(snapshot.pet.evolutionStage),
      });
    }
    return growth;
  }

  loadAll(): PetGrowthSnapshots {
    const rows = this.#database
      .prepare<[], OwnedProfileRow>(
        `
        SELECT owned_pet_id, pet_key, display_name, level, xp_into_level, total_xp,
               evolution_stage, token_bank, last_base_xp
        FROM pet_profiles
      `,
      )
      .all();
    const snapshots: PetGrowthSnapshots = {};
    for (const row of rows) {
      snapshots[row.owned_pet_id] = {
        petKey: row.pet_key,
        pet: {
          id: row.owned_pet_id,
          name: row.display_name,
          level: row.level,
          xpIntoLevel: row.xp_into_level,
          totalXp: row.total_xp,
          evolutionStage: row.evolution_stage,
          evolutionAvailable: evolutionAvailable(row.level, row.evolution_stage),
        },
        tokenBank: row.token_bank,
        lastBaseXp: row.last_base_xp,
      };
    }
    return snapshots;
  }

  /** 아직 렌더링하지 않은 다른 개체의 DB 레코드는 보존한다. */
  saveAll(snapshots: unknown): void {
    const normalized = normalizeSnapshots(snapshots);
    this.#database.transaction(() => this.#upsertAll(normalized));
  }

  /** 종 단위였던 행을 종별 목록으로 모은다. 순서는 삽입 순서를 따른다. */
  #speciesRowsByKey(): Map<string, SpeciesProfileRow[]> {
    const grouped = new Map<string, SpeciesProfileRow[]>();
    if (!this.#hasTable(LEGACY_SPECIES_PROFILE_TABLE)) return grouped;

    const rows = this.#database
      .prepare<[], SpeciesProfileRow>(
        `
        SELECT pet_key, display_name, level, xp_into_level, total_xp,
               evolution_stage, token_bank, last_base_xp
        FROM ${LEGACY_SPECIES_PROFILE_TABLE}
        ORDER BY rowid
      `,
      )
      .all();
    for (const row of rows) {
      const bucket = grouped.get(row.pet_key);
      if (bucket) bucket.push(row);
      else grouped.set(row.pet_key, [row]);
    }
    return grouped;
  }

  /**
   * 옛 전용 DB 파일을 읽어 **종 단위 보관 테이블**에 넣는다.
   *
   * 개체 테이블에 바로 넣지 않는 이유: 종 행이 어느 개체의 것인지는 명부를 알아야 정할 수
   * 있고, 명부는 앱이 뒤늦게 건네준다. 두 종류의 옛 데이터가 같은 자리에 모이므로
   * `adoptRoster`가 한 규칙으로 이관한다.
   */
  #migrateLegacyDatabase(): void {
    if (this.#hasMetadata(LEGACY_DATABASE_MIGRATION_KEY)) return;
    this.#database.transaction(() => {
      for (const legacyDatabasePath of this.#legacyDatabasePaths) {
        for (const row of this.#readLegacyDatabase(legacyDatabasePath)) {
          this.#insertSpeciesRow(row);
        }
      }
      this.#setMetadata(LEGACY_DATABASE_MIGRATION_KEY, new Date().toISOString());
    });
  }

  #readLegacyDatabase(filePath: string): SpeciesProfileRow[] {
    if (!existsSync(filePath)) return [];
    let legacy: Database.Database | undefined;
    try {
      legacy = new Database(filePath, { readonly: true, fileMustExist: true });
      if (!hasTable(legacy, 'pet_profiles')) return [];
      return legacy
        .prepare<[], SpeciesProfileRow>(
          `
          SELECT pet_key, display_name, level, xp_into_level, total_xp,
                 evolution_stage, token_bank, last_base_xp
          FROM pet_profiles
        `,
        )
        .all();
    } catch (error) {
      console.warn(`[DB] 기존 오버레이 DB 이관을 건너뜁니다: ${String(error)}`);
      return [];
    } finally {
      legacy?.close();
    }
  }

  #insertSpeciesRow(row: SpeciesProfileRow): void {
    if (!this.#hasTable(LEGACY_SPECIES_PROFILE_TABLE)) return;
    this.#database
      .prepare<[string, string, number, number, number, number, number, number, string]>(
        `
        INSERT INTO ${LEGACY_SPECIES_PROFILE_TABLE} (
          pet_key, display_name, level, xp_into_level, total_xp,
          evolution_stage, token_bank, last_base_xp, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pet_key) DO NOTHING
      `,
      )
      .run(
        row.pet_key,
        row.display_name,
        row.level,
        row.xp_into_level,
        row.total_xp,
        row.evolution_stage,
        row.token_bank,
        row.last_base_xp,
        new Date().toISOString(),
      );
  }

  #hasTable(name: string): boolean {
    return (
      this.#database
        .prepare<[string], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(name) !== undefined
    );
  }

  #hasMetadata(key: string): boolean {
    return (
      this.#database
        .prepare<[string], { key: string }>('SELECT key FROM overlay_metadata WHERE key = ?')
        .get(key) !== undefined
    );
  }

  #setMetadata(key: string, value: string): void {
    this.#database
      .prepare<[string, string]>(
        `
        INSERT INTO overlay_metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      )
      .run(key, value);
  }

  #upsertAll(snapshots: PetGrowthSnapshots): void {
    const upsert = this.#database.prepare<
      [string, string, string, number, number, number, number, number, number, string]
    >(`
      INSERT INTO pet_profiles (
        owned_pet_id, pet_key, display_name, level, xp_into_level, total_xp,
        evolution_stage, token_bank, last_base_xp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owned_pet_id) DO UPDATE SET
        pet_key = excluded.pet_key,
        display_name = excluded.display_name,
        level = excluded.level,
        xp_into_level = excluded.xp_into_level,
        total_xp = excluded.total_xp,
        evolution_stage = excluded.evolution_stage,
        token_bank = excluded.token_bank,
        last_base_xp = excluded.last_base_xp,
        updated_at = excluded.updated_at
    `);
    const updatedAt = new Date().toISOString();
    for (const [ownedPetId, snapshot] of Object.entries(snapshots)) {
      const { pet } = snapshot;
      upsert.run(
        ownedPetId,
        snapshot.petKey,
        pet.name,
        pet.level,
        pet.xpIntoLevel,
        pet.totalXp,
        pet.evolutionStage,
        snapshot.tokenBank,
        snapshot.lastBaseXp,
        updatedAt,
      );
    }
  }
}

/**
 * 물려받을 종 행이 있으면 그 성장을, 없으면 명부가 말하는 시작값을 쓴다.
 *
 * 레벨을 한 번 더 다듬는 이유: 스키마가 `CHECK (level >= 1)`이라 0이나 소수가 들어오면
 * **앱 시작 경로에서 던진다.** 손댄 저장 파일 하나가 창을 못 뜨게 만드는 것보다, 쓸 수 있는
 * 값으로 맞춰 두고 앱이 뜨는 편이 낫다. 정상 입력에는 아무 영향이 없다.
 */
function snapshotFor(
  seed: PetGrowthSeed,
  inherited: SpeciesProfileRow | undefined,
): PetGrowthSnapshot {
  const level = usableLevel(inherited?.level ?? seed.level);
  const evolutionStage = inherited?.evolution_stage ?? seed.evolutionStage;
  return {
    petKey: seed.petKey,
    pet: {
      id: seed.ownedPetId,
      name: seed.displayName,
      level,
      xpIntoLevel: inherited?.xp_into_level ?? 0,
      totalXp: inherited?.total_xp ?? 0,
      evolutionStage,
      evolutionAvailable: evolutionAvailable(level, evolutionStage),
    },
    tokenBank: inherited?.token_bank ?? 0,
    lastBaseXp: inherited?.last_base_xp ?? 0,
  };
}

function hasTable(database: Database.Database, name: string): boolean {
  return (
    database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

/** 판정과 복구를 따로 쓴다. `Math.trunc(Infinity)`는 여전히 Infinity 라 상한이 필요하다. */
function usableLevel(value: number): number {
  if (Number.isSafeInteger(value) && value >= 1) return value;
  if (!Number.isFinite(value)) return 1;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.trunc(value)));
}

function evolutionStageOf(value: number): EvolutionStage {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  return 2;
}

function normalizeSnapshots(value: unknown): PetGrowthSnapshots {
  if (!isRecord(value)) throw new Error('성장 스냅샷은 개체 id별 객체여야 합니다.');
  const snapshots: PetGrowthSnapshots = {};
  for (const [ownedPetId, snapshot] of Object.entries(value)) {
    if (!isIdentifier(ownedPetId)) throw new Error('유효하지 않은 보유 펫 id입니다.');
    if (!isRecord(snapshot) || !isRecord(snapshot.pet)) {
      throw new Error(`유효하지 않은 펫 스냅샷: ${ownedPetId}`);
    }
    if (!isIdentifier(snapshot.petKey)) throw new Error(`유효하지 않은 펫 키: ${ownedPetId}`);
    const pet = snapshot.pet;
    if (typeof pet.name !== 'string') throw new Error(`유효하지 않은 펫 스냅샷: ${ownedPetId}`);
    const level = nonNegativeInteger(pet.level, `${ownedPetId}.level`, 1);
    const evolutionStage = boundedInteger(pet.evolutionStage, `${ownedPetId}.evolutionStage`, 0, 2);
    snapshots[ownedPetId] = {
      petKey: snapshot.petKey,
      pet: {
        id: ownedPetId,
        name: pet.name,
        level,
        xpIntoLevel: nonNegativeInteger(pet.xpIntoLevel, `${ownedPetId}.xpIntoLevel`),
        totalXp: nonNegativeInteger(pet.totalXp, `${ownedPetId}.totalXp`),
        evolutionStage,
        evolutionAvailable: evolutionAvailable(level, evolutionStage),
      },
      tokenBank: nonNegativeInteger(snapshot.tokenBank, `${ownedPetId}.tokenBank`),
      lastBaseXp: nonNegativeInteger(snapshot.lastBaseXp, `${ownedPetId}.lastBaseXp`),
    };
  }
  return snapshots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function nonNegativeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`유효하지 않은 ${name}`);
  }
  return value;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  const integer = nonNegativeInteger(value, name, minimum);
  if (integer > maximum) throw new Error(`유효하지 않은 ${name}`);
  return integer;
}

function evolutionAvailable(level: number, stage: number): boolean {
  return (stage === 0 && level >= 15) || (stage === 1 && level >= 35);
}
