const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { SqliteFileDatabase } = require('../../electron/database/sqlite-file.cjs');
const { PetGrowthRepository } = require('../../electron/persistence/pet-growth-repository.cjs');

function temporaryDatabase(name) {
  const directory = mkdtempSync(join(tmpdir(), `pet-overlay-${name}-`));
  return { directory, path: join(directory, 'state.sqlite') };
}

test('generic database applies migrations once and rolls back a failed transaction', () => {
  const temporary = temporaryDatabase('generic');
  const database = new SqliteFileDatabase({
    filePath: temporary.path,
    migrations: [
      {
        version: 1,
        name: 'create counters',
        up: (db) => db.exec('CREATE TABLE counters (value INTEGER NOT NULL)'),
      },
    ],
  });

  try {
    database.open();
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      1,
    );
    assert.throws(() => {
      database.transaction(() => {
        database.prepare('INSERT INTO counters (value) VALUES (?)').run(1);
        throw new Error('rollback');
      });
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM counters').get().count, 0);
    database.close();

    database.open();
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      1,
    );
  } finally {
    database.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('a migration failure does not quarantine a healthy database file', () => {
  const temporary = temporaryDatabase('migration-failure');
  const database = new SqliteFileDatabase({
    filePath: temporary.path,
    migrations: [
      {
        version: 1,
        name: 'broken migration',
        up: () => {
          throw new Error('broken migration');
        },
      },
    ],
  });

  try {
    assert.throws(() => database.open(), /broken migration/);
    assert.equal(
      readdirSync(temporary.directory).some((name) => name.includes('.corrupt-')),
      false,
    );
  } finally {
    database.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('a corrupt SQLite file is quarantined and recreated', () => {
  const temporary = temporaryDatabase('corrupt');
  writeFileSync(temporary.path, 'not a SQLite database');
  const database = new SqliteFileDatabase({ filePath: temporary.path, migrations: [] });

  try {
    database.open();
    assert.equal(database.prepare('SELECT 1 AS value').get().value, 1);
    assert.equal(
      readdirSync(temporary.directory).some((name) => name.includes('.corrupt-')),
      true,
    );
  } finally {
    database.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test('pet growth repository migrates legacy data once and preserves other pets on later saves', () => {
  const temporary = temporaryDatabase('growth');
  const database = new SqliteFileDatabase({ filePath: temporary.path, migrations: [] });
  const repository = new PetGrowthRepository(database);
  let reopenedRepository;
  const legacy = {
    mole_digger: {
      pet: {
        name: '두더지',
        level: 3,
        xpIntoLevel: 2,
        totalXp: 22,
        evolutionStage: 0,
        evolutionAvailable: false,
      },
      tokenBank: 11_000,
      lastBaseXp: 2,
    },
  };

  try {
    repository.open();
    const migrated = repository.hydrate(legacy);
    assert.equal(migrated.migratedLegacy, true);
    assert.equal(migrated.snapshots.mole_digger.pet.level, 3);

    repository.saveAll({
      star_wizard: {
        pet: {
          name: '별빛마법사',
          level: 4,
          xpIntoLevel: 1,
          totalXp: 41,
          evolutionStage: 0,
          evolutionAvailable: false,
        },
        tokenBank: 7_000,
        lastBaseXp: 1,
      },
    });
    repository.close();
    reopenedRepository = new PetGrowthRepository(
      new SqliteFileDatabase({ filePath: temporary.path, migrations: [] }),
    );
    reopenedRepository.open();
    const reloaded = reopenedRepository.hydrate({});
    assert.equal(reloaded.migratedLegacy, false);
    assert.equal(reloaded.snapshots.mole_digger.pet.totalXp, 22);
    assert.equal(reloaded.snapshots.star_wizard.pet.level, 4);
    reopenedRepository.saveOverlayState({ activePetKey: 'star_wizard' });
    assert.deepEqual(reopenedRepository.loadOverlayState(), { activePetKey: 'star_wizard' });
  } finally {
    reopenedRepository?.close();
    repository.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
