const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');

function temporaryDatabase(name) {
  const directory = mkdtempSync(join(tmpdir(), `petto-sqlite-${name}-`));
  return { directory, filePath: join(directory, 'petto.sqlite') };
}

test('서로 다른 기능은 같은 migration version을 독립적으로 사용한다', async () => {
  const { directory, filePath } = temporaryDatabase('scopes');
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const migrations = [
    {
      scope: 'overlay-growth',
      version: 1,
      name: 'create growth records',
      up(database) {
        database.exec('CREATE TABLE growth_records (id TEXT PRIMARY KEY)');
      },
    },
    {
      scope: 'battle',
      version: 1,
      name: 'create battle records',
      up(database) {
        database.exec('CREATE TABLE battle_records (id TEXT PRIMARY KEY)');
      },
    },
  ];
  const database = new SqliteFileDatabase({ filePath, migrations });

  try {
    database.open();
    const applied = database
      .prepare('SELECT scope, version FROM schema_migrations ORDER BY scope')
      .all();
    assert.deepEqual(applied, [
      { scope: 'battle', version: 1 },
      { scope: 'overlay-growth', version: 1 },
    ]);
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('growth_records').count,
      1,
    );
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('battle_records').count,
      1,
    );

    database.close();
    database.open();
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('기존 version 전용 migration 기록은 이름이 같은 기능 scope로 승격된다', async () => {
  const { directory, filePath } = temporaryDatabase('legacy-migration');
  const legacy = new Database(filePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'create pet growth profiles', '2026-01-01T00:00:00.000Z');
    CREATE TABLE pet_profiles (pet_key TEXT PRIMARY KEY, level INTEGER NOT NULL);
    INSERT INTO pet_profiles (pet_key, level) VALUES ('mole_digger', 7);
  `);
  legacy.close();

  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const database = new SqliteFileDatabase({
    filePath,
    migrations: [
      {
        scope: 'overlay-growth',
        version: 1,
        name: 'create pet growth profiles',
        up() {
          throw new Error('기존 migration은 다시 실행되면 안 됩니다.');
        },
      },
    ],
  });

  try {
    database.open();
    assert.deepEqual(
      database.prepare('SELECT scope, version, name, applied_at FROM schema_migrations').get(),
      {
        scope: 'overlay-growth',
        version: 1,
        name: 'create pet growth profiles',
        applied_at: '2026-01-01T00:00:00.000Z',
      },
    );
    assert.deepEqual(database.prepare('SELECT pet_key, level FROM pet_profiles').get(), {
      pet_key: 'mole_digger',
      level: 7,
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
