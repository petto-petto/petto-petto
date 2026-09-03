const GROWTH_MIGRATIONS = [
  {
    version: 1,
    name: 'create pet growth profiles',
    up: (database) => {
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

const LEGACY_MIGRATION_KEY = 'migration.localstorage.pet-growth-v1';
const ACTIVE_PET_KEY = 'overlay.active-pet-key';

/** 펫 성장 스냅샷의 영속화만 담당하는 overlay feature repository. */
class PetGrowthRepository {
  #database;

  constructor(database) {
    this.#database = database;
  }

  open() {
    this.#database.open();
    this.#database.applyMigrations(GROWTH_MIGRATIONS);
  }

  close() {
    this.#database.close();
  }

  /** legacy localStorage 데이터를 한 번만 흡수한 뒤 현재 DB 상태를 돌려준다. */
  hydrate(legacySnapshots) {
    const alreadyMigrated = this.#database
      .prepare('SELECT 1 FROM overlay_metadata WHERE key = ?')
      .get(LEGACY_MIGRATION_KEY);
    let migratedLegacy = false;
    if (!alreadyMigrated) {
      this.#database.transaction(() => {
        const snapshots = normalizedSnapshots(legacySnapshots);
        this.#upsertAll(snapshots);
        this.#database
          .prepare('INSERT INTO overlay_metadata (key, value) VALUES (?, ?)')
          .run(LEGACY_MIGRATION_KEY, new Date().toISOString());
      });
      migratedLegacy = true;
    }
    return { snapshots: this.loadAll(), migratedLegacy };
  }

  loadAll() {
    const rows = this.#database
      .prepare(
        `
        SELECT pet_key, display_name, level, xp_into_level, total_xp,
               evolution_stage, token_bank, last_base_xp
        FROM pet_profiles
      `,
      )
      .all();
    const snapshots = {};
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

  /** 전달된 펫만 upsert한다. 아직 렌더러가 열지 않은 다른 펫의 DB 상태는 보존한다. */
  saveAll(snapshots) {
    const normalized = normalizedSnapshots(snapshots);
    this.#database.transaction(() => this.#upsertAll(normalized));
  }

  /** localStorage migration 기록은 유지해 reset 뒤 옛 데이터가 되살아나지 않게 한다. */
  clearAll() {
    this.#database.exec('DELETE FROM pet_profiles');
  }

  /** 마지막으로 활성화했던 펫은 성장 데이터와 독립된 overlay preference로 보관한다. */
  loadOverlayState() {
    const row = this.#database
      .prepare('SELECT value FROM overlay_metadata WHERE key = ?')
      .get(ACTIVE_PET_KEY);
    return { activePetKey: row?.value ?? null };
  }

  saveOverlayState({ activePetKey }) {
    if (
      typeof activePetKey !== 'string' ||
      activePetKey.length === 0 ||
      activePetKey.length > 100
    ) {
      throw new Error('유효하지 않은 활성 펫 키입니다.');
    }
    this.#database
      .prepare(
        `
        INSERT INTO overlay_metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      )
      .run(ACTIVE_PET_KEY, activePetKey);
  }

  #upsertAll(snapshots) {
    const upsert = this.#database.prepare(`
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
      const pet = snapshot.pet;
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

function normalizedSnapshots(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('성장 스냅샷은 펫 키별 객체여야 합니다.');
  }
  const snapshots = {};
  for (const [petKey, snapshot] of Object.entries(value)) {
    if (typeof petKey !== 'string' || petKey.length === 0 || petKey.length > 100) {
      throw new Error('유효하지 않은 펫 키입니다.');
    }
    const pet = snapshot?.pet;
    if (!pet || typeof pet !== 'object' || typeof pet.name !== 'string') {
      throw new Error(`유효하지 않은 펫 스냅샷: ${petKey}`);
    }
    snapshots[petKey] = {
      pet: {
        name: pet.name,
        level: nonNegativeInteger(pet.level, `${petKey}.level`, 1),
        xpIntoLevel: nonNegativeInteger(pet.xpIntoLevel, `${petKey}.xpIntoLevel`),
        totalXp: nonNegativeInteger(pet.totalXp, `${petKey}.totalXp`),
        evolutionStage: boundedInteger(pet.evolutionStage, `${petKey}.evolutionStage`, 0, 2),
      },
      tokenBank: nonNegativeInteger(snapshot.tokenBank, `${petKey}.tokenBank`),
      lastBaseXp: nonNegativeInteger(snapshot.lastBaseXp, `${petKey}.lastBaseXp`),
    };
  }
  return snapshots;
}

function nonNegativeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`유효하지 않은 ${name}`);
  return value;
}

function boundedInteger(value, name, minimum, maximum) {
  const integer = nonNegativeInteger(value, name, minimum);
  if (integer > maximum) throw new Error(`유효하지 않은 ${name}`);
  return integer;
}

function evolutionAvailable(level, stage) {
  return (stage === 0 && level >= 15) || (stage === 1 && level >= 35);
}

module.exports = { PetGrowthRepository };
