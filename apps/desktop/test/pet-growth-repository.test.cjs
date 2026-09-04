const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const Database = require('../node_modules/better-sqlite3');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-desktop-${name}-`));
}

function createLegacyDatabase(filePath) {
  const database = new Database(filePath);
  database.exec(`
    CREATE TABLE pet_profiles (
      pet_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      level INTEGER NOT NULL,
      xp_into_level INTEGER NOT NULL,
      total_xp INTEGER NOT NULL,
      evolution_stage INTEGER NOT NULL,
      token_bank INTEGER NOT NULL,
      last_base_xp INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE overlay_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  database
    .prepare(
      `
      INSERT INTO pet_profiles (
        pet_key, display_name, level, xp_into_level, total_xp,
        evolution_stage, token_bank, last_base_xp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run('mole_digger', '두더지', 7, 3, 63, 0, 9_000, 3, '2026-01-01T00:00:00.000Z');
  database
    .prepare('INSERT INTO overlay_metadata (key, value) VALUES (?, ?)')
    .run('overlay.active-pet-key', 'mole_digger');
  database.close();
}

test('공용 저장소는 기존 오버레이 SQLite를 한 번 이관하고 localStorage가 덮어쓰지 못하게 한다', async () => {
  const directory = temporaryDirectory('growth-migration');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  const targetPath = join(directory, 'petto.sqlite');
  createLegacyDatabase(legacyPath);

  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { PetGrowthRepository } = await import('../dist/main/overlay/pet-growth-repository.js');
  const repository = new PetGrowthRepository(new SqliteFileDatabase({ filePath: targetPath }), {
    legacyDatabasePaths: [join(directory, 'missing.sqlite'), legacyPath],
  });

  try {
    repository.open();
    const hydrated = repository.hydrate({
      mole_digger: {
        pet: {
          name: '오래된 두더지',
          level: 1,
          xpIntoLevel: 0,
          totalXp: 0,
          evolutionStage: 0,
        },
        tokenBank: 0,
        lastBaseXp: 0,
      },
    });
    assert.equal(hydrated.migratedLegacy, true);
    assert.equal(hydrated.snapshots.mole_digger.pet.level, 7);
    assert.equal(hydrated.snapshots.mole_digger.pet.totalXp, 63);
    assert.deepEqual(repository.loadOverlayState(), { activePetKey: 'mole_digger' });

    repository.saveAll({
      star_wizard: {
        pet: {
          name: '별빛마법사',
          level: 4,
          xpIntoLevel: 1,
          totalXp: 41,
          evolutionStage: 0,
        },
        tokenBank: 7_000,
        lastBaseXp: 1,
      },
    });
    assert.equal(repository.loadAll().star_wizard.pet.level, 4);
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
