import { existsSync } from 'node:fs';

import Database from 'better-sqlite3';

import { SqliteFileDatabase, type SqliteMigration } from '../sqlite-file.ts';

const LOCAL_STORAGE_MIGRATION_KEY = 'migration.localstorage.pet-growth-v1';
const LEGACY_DATABASE_MIGRATION_KEY = 'migration.database.pet-overlay-v1';
const ACTIVE_PET_KEY = 'overlay.active-pet-key';

const GROWTH_MIGRATIONS: readonly SqliteMigration[] = [
  {
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

interface PersistedPet {
  id: string;
  name: string;
  level: number;
  xpIntoLevel: number;
  totalXp: number;
  evolutionStage: number;
  evolutionAvailable: boolean;
}

export interface PetGrowthSnapshot {
  pet: PersistedPet;
  tokenBank: number;
  lastBaseXp: number;
}

export type PetGrowthSnapshots = Record<string, PetGrowthSnapshot>;

export interface OverlayState {
  activePetKey: string | null;
}

export interface PetGrowthRepositoryOptions {
  legacyDatabasePaths?: readonly string[];
}

interface PetProfileRow {
  pet_key: string;
  display_name: string;
  level: number;
  xp_into_level: number;
  total_xp: number;
  evolution_stage: number;
  token_bank: number;
  last_base_xp: number;
}

interface MetadataRow {
  value: string;
}

interface LegacyDatabaseState {
  snapshots: PetGrowthSnapshots;
  activePetKey: string | null;
}

/** 메인 오버레이의 성장·진화·활성 펫 상태를 공용 SQLite에 영속화한다. */
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

  open(): void {
    this.#database.open();
    this.#database.applyMigrations(GROWTH_MIGRATIONS);
    this.#migrateLegacyDatabase();
  }

  close(): void {
    this.#database.close();
  }

  /** 브라우저 미리보기 시절의 localStorage는 DB가 비어 있을 때만 한 번 가져온다. */
  hydrate(legacySnapshots: unknown): { snapshots: PetGrowthSnapshots; migratedLegacy: boolean } {
    const migratedLegacy = !this.#hasMetadata(LOCAL_STORAGE_MIGRATION_KEY);
    if (migratedLegacy) {
      this.#database.transaction(() => {
        if (this.#profileCount() === 0) this.#upsertAll(normalizeSnapshots(legacySnapshots));
        this.#setMetadata(LOCAL_STORAGE_MIGRATION_KEY, new Date().toISOString());
      });
    }
    return { snapshots: this.loadAll(), migratedLegacy };
  }

  loadAll(): PetGrowthSnapshots {
    const rows = this.#database
      .prepare<[], PetProfileRow>(
        `
        SELECT pet_key, display_name, level, xp_into_level, total_xp,
               evolution_stage, token_bank, last_base_xp
        FROM pet_profiles
      `,
      )
      .all();
    const snapshots: PetGrowthSnapshots = {};
    for (const row of rows) {
      snapshots[row.pet_key] = {
        pet: {
          id: row.pet_key,
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

  /** 아직 렌더링하지 않은 다른 펫의 DB 레코드는 보존한다. */
  saveAll(snapshots: unknown): void {
    const normalized = normalizeSnapshots(snapshots);
    this.#database.transaction(() => this.#upsertAll(normalized));
  }

  /** migration 기록은 남겨, 초기화 뒤 옛 localStorage 값이 되살아나지 않게 한다. */
  clearAll(): void {
    this.#database.exec('DELETE FROM pet_profiles');
  }

  loadOverlayState(): OverlayState {
    const row = this.#database
      .prepare<[string], MetadataRow>('SELECT value FROM overlay_metadata WHERE key = ?')
      .get(ACTIVE_PET_KEY);
    return { activePetKey: row?.value ?? null };
  }

  saveOverlayState(state: unknown): void {
    if (!isRecord(state) || !isValidPetKey(state.activePetKey)) {
      throw new Error('유효하지 않은 활성 펫 키입니다.');
    }
    this.#setMetadata(ACTIVE_PET_KEY, state.activePetKey);
  }

  #migrateLegacyDatabase(): void {
    if (this.#hasMetadata(LEGACY_DATABASE_MIGRATION_KEY)) return;
    this.#database.transaction(() => {
      for (const legacyDatabasePath of this.#legacyDatabasePaths) {
        const legacy = this.#readLegacyDatabase(legacyDatabasePath);
        if (legacy && this.#profileCount() === 0) this.#upsertAll(legacy.snapshots);
        if (legacy?.activePetKey && this.loadOverlayState().activePetKey === null) {
          this.#setMetadata(ACTIVE_PET_KEY, legacy.activePetKey);
        }
      }
      this.#setMetadata(LEGACY_DATABASE_MIGRATION_KEY, new Date().toISOString());
    });
  }

  #readLegacyDatabase(filePath: string): LegacyDatabaseState | undefined {
    if (!existsSync(filePath)) return undefined;
    let legacy: Database.Database | undefined;
    try {
      legacy = new Database(filePath, { readonly: true, fileMustExist: true });
      if (!hasTable(legacy, 'pet_profiles')) return undefined;
      const rows = legacy
        .prepare<[], PetProfileRow>(
          `
          SELECT pet_key, display_name, level, xp_into_level, total_xp,
                 evolution_stage, token_bank, last_base_xp
          FROM pet_profiles
        `,
        )
        .all();
      const candidates: Record<string, unknown> = {};
      for (const row of rows) {
        candidates[row.pet_key] = {
          pet: {
            name: row.display_name,
            level: row.level,
            xpIntoLevel: row.xp_into_level,
            totalXp: row.total_xp,
            evolutionStage: row.evolution_stage,
          },
          tokenBank: row.token_bank,
          lastBaseXp: row.last_base_xp,
        };
      }
      const activePetKey = hasTable(legacy, 'overlay_metadata')
        ? (legacy
            .prepare<[string], MetadataRow>('SELECT value FROM overlay_metadata WHERE key = ?')
            .get(ACTIVE_PET_KEY)?.value ?? null)
        : null;
      return { snapshots: normalizeSnapshots(candidates), activePetKey };
    } catch (error) {
      console.warn(`[DB] 기존 오버레이 DB 이관을 건너뜁니다: ${String(error)}`);
      return undefined;
    } finally {
      legacy?.close();
    }
  }

  #profileCount(): number {
    const row = this.#database
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM pet_profiles')
      .get();
    return row?.count ?? 0;
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
      [string, string, number, number, number, number, number, number, string]
    >(`
      INSERT INTO pet_profiles (
        pet_key, display_name, level, xp_into_level, total_xp,
        evolution_stage, token_bank, last_base_xp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pet_key) DO UPDATE SET
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
    for (const [petKey, snapshot] of Object.entries(snapshots)) {
      const { pet } = snapshot;
      upsert.run(
        petKey,
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

function hasTable(database: Database.Database, name: string): boolean {
  return (
    database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

function normalizeSnapshots(value: unknown): PetGrowthSnapshots {
  if (!isRecord(value)) throw new Error('성장 스냅샷은 펫 키별 객체여야 합니다.');
  const snapshots: PetGrowthSnapshots = {};
  for (const [petKey, snapshot] of Object.entries(value)) {
    if (!isValidPetKey(petKey)) throw new Error('유효하지 않은 펫 키입니다.');
    if (!isRecord(snapshot) || !isRecord(snapshot.pet)) {
      throw new Error(`유효하지 않은 펫 스냅샷: ${petKey}`);
    }
    const pet = snapshot.pet;
    if (typeof pet.name !== 'string') throw new Error(`유효하지 않은 펫 스냅샷: ${petKey}`);
    const level = nonNegativeInteger(pet.level, `${petKey}.level`, 1);
    const evolutionStage = boundedInteger(pet.evolutionStage, `${petKey}.evolutionStage`, 0, 2);
    snapshots[petKey] = {
      pet: {
        id: petKey,
        name: pet.name,
        level,
        xpIntoLevel: nonNegativeInteger(pet.xpIntoLevel, `${petKey}.xpIntoLevel`),
        totalXp: nonNegativeInteger(pet.totalXp, `${petKey}.totalXp`),
        evolutionStage,
        evolutionAvailable: evolutionAvailable(level, evolutionStage),
      },
      tokenBank: nonNegativeInteger(snapshot.tokenBank, `${petKey}.tokenBank`),
      lastBaseXp: nonNegativeInteger(snapshot.lastBaseXp, `${petKey}.lastBaseXp`),
    };
  }
  return snapshots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidPetKey(value: unknown): value is string {
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
