const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-desktop-${name}-`));
}

/** 종을 키로 쓰던 시절의 오버레이 전용 DB. */
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
    .run('mole_digger', '두더지', 7, 3, 63, 1, 9_000, 3, '2026-01-01T00:00:00.000Z');
  database
    .prepare('INSERT INTO overlay_metadata (key, value) VALUES (?, ?)')
    .run('overlay.active-pet-key', 'mole_digger');
  database.close();
}

async function openRepository(directory, legacyPath) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetGrowthRepository } =
    await import('../dist/main/persistence/repositories/pet-growth-repository.js');
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  const repository = new PetGrowthRepository(database, {
    legacyDatabasePaths: [join(directory, 'missing.sqlite'), legacyPath],
  });
  return { database, repository };
}

/** 명부 한 마리분. `growthSeeds()`가 내는 모양과 같다. */
const seed = (ownedPetId, petKey, displayName, level, evolutionStage) => ({
  ownedPetId,
  petKey,
  displayName,
  level,
  evolutionStage,
});

test('종 단위였던 옛 성장 기록은 명부의 개체가 물려받고, 오버레이의 활성 펫 키는 사라진다', async () => {
  const directory = temporaryDirectory('growth-adoption');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  createLegacyDatabase(legacyPath);
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.migrateLegacyData();

    const growth = repository.adoptRoster([
      seed('seed-001', 'mole_digger', '두더지', 3, 0),
      seed('seed-006', 'star_wizard', '별빛마법사', 25, 2),
    ]);

    // 물려받은 개체는 옛 성장 수치를 그대로 이어받는다.
    const snapshots = repository.loadAll();
    assert.equal(snapshots['seed-001'].pet.level, 7);
    assert.equal(snapshots['seed-001'].pet.totalXp, 63);
    assert.equal(snapshots['seed-001'].pet.evolutionStage, 1);
    assert.equal(snapshots['seed-001'].tokenBank, 9_000);
    assert.equal(snapshots['seed-001'].petKey, 'mole_digger');

    // 물려받을 것이 없는 개체는 명부가 말하는 값으로 시작한다.
    assert.equal(snapshots['seed-006'].pet.level, 25);
    assert.equal(snapshots['seed-006'].pet.evolutionStage, 2);
    assert.equal(snapshots['seed-006'].petKey, 'star_wizard');

    // 명부에 투영할 값도 같은 것을 말한다.
    assert.deepEqual(growth.get('seed-001'), { level: 7, evolutionStage: 1 });
    assert.deepEqual(growth.get('seed-006'), { level: 25, evolutionStage: 2 });

    // 활성 펫의 정본은 명부 하나다. 오버레이가 들고 있던 키는 남아 있으면 안 된다.
    const leftover = database
      .prepare('SELECT value FROM overlay_metadata WHERE key = ?')
      .get('overlay.active-pet-key');
    assert.equal(leftover, undefined);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('같은 종 두 마리는 성장을 나눠 갖는다 — 한 기록에서 합쳐지지 않는다', async () => {
  const directory = temporaryDirectory('growth-same-species');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  createLegacyDatabase(legacyPath);
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.migrateLegacyData();
    repository.adoptRoster([
      seed('mole-a', 'mole_digger', '두더지', 3, 0),
      seed('mole-b', 'mole_digger', '두더지', 5, 0),
    ]);

    const snapshots = repository.loadAll();
    // 옛 종 기록은 명부 순서대로 첫 마리에게만 간다. 둘째는 자기 시작값을 쓴다.
    assert.equal(snapshots['mole-a'].pet.level, 7);
    assert.equal(snapshots['mole-b'].pet.level, 5);

    // 한 마리를 키워도 다른 마리는 그대로다.
    repository.saveAll({
      'mole-a': {
        petKey: 'mole_digger',
        pet: { name: '두더지', level: 9, xpIntoLevel: 2, totalXp: 90, evolutionStage: 1 },
        tokenBank: 100,
        lastBaseXp: 4,
      },
    });
    const after = repository.loadAll();
    assert.equal(after['mole-a'].pet.level, 9);
    assert.equal(after['mole-b'].pet.level, 5);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('이관은 한 번만 일어나고, 뒤늦게 들어온 개체도 성장 행을 받는다', async () => {
  const directory = temporaryDirectory('growth-idempotent');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  createLegacyDatabase(legacyPath);
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.migrateLegacyData();
    repository.adoptRoster([seed('seed-001', 'mole_digger', '두더지', 3, 0)]);

    // 키운 뒤 다시 받아들여도 옛 값으로 되돌아가지 않는다.
    repository.saveAll({
      'seed-001': {
        petKey: 'mole_digger',
        pet: { name: '두더지', level: 12, xpIntoLevel: 0, totalXp: 200, evolutionStage: 1 },
        tokenBank: 0,
        lastBaseXp: 0,
      },
    });
    const growth = repository.adoptRoster([
      seed('seed-001', 'mole_digger', '두더지', 3, 0),
      seed('seed-002', 'sprout_treant', '새싹나무', 7, 0),
    ]);

    assert.deepEqual(growth.get('seed-001'), { level: 12, evolutionStage: 1 });
    // 새로 들어온 개체는 종 기록을 물려받지 않는다 — 이관은 이미 끝났다.
    assert.deepEqual(growth.get('seed-002'), { level: 7, evolutionStage: 0 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('종 key 가 없는 스냅샷은 거부한다 — 스프라이트를 고를 수 없는 기록은 쓰지 않는다', async () => {
  const directory = temporaryDirectory('growth-validation');
  const legacyPath = join(directory, 'missing-legacy.sqlite');
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    assert.throws(
      () =>
        repository.saveAll({
          'seed-001': {
            pet: { name: '두더지', level: 1, xpIntoLevel: 0, totalXp: 0, evolutionStage: 0 },
            tokenBank: 0,
            lastBaseXp: 0,
          },
        }),
      /유효하지 않은 펫 키/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('저장 초기화는 명부 전원을 Lv.1 · 진화 0회로 되돌린다', async () => {
  const directory = temporaryDirectory('growth-reset');
  const legacyPath = join(directory, 'missing-legacy.sqlite');
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    const roster = [
      seed('seed-001', 'mole_digger', '두더지', 3, 0),
      seed('seed-006', 'star_wizard', '별빛마법사', 25, 2),
    ];
    repository.adoptRoster(roster);

    // 키운 뒤 초기화한다. 명부의 레벨은 이미 성장이 투영된 값이라 씨앗으로 쓰면 안 된다.
    repository.saveAll({
      'seed-006': {
        petKey: 'star_wizard',
        pet: { name: '별빛마법사', level: 40, xpIntoLevel: 0, totalXp: 900, evolutionStage: 2 },
        tokenBank: 500,
        lastBaseXp: 9,
      },
    });
    const grown = [
      seed('seed-001', 'mole_digger', '두더지', 3, 0),
      seed('seed-006', 'star_wizard', '별빛마법사', 40, 2),
    ];

    const growth = repository.resetGrowth(grown);
    assert.deepEqual(growth.get('seed-001'), { level: 1, evolutionStage: 0 });
    assert.deepEqual(growth.get('seed-006'), { level: 1, evolutionStage: 0 });

    // 레벨만 살아남고 경험치만 0인 모순된 기록이 남으면 안 된다.
    const after = repository.loadAll();
    assert.equal(after['seed-006'].pet.totalXp, 0);
    assert.equal(after['seed-006'].tokenBank, 0);
    assert.equal(Object.keys(after).length, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('빈 명부로는 이관을 끝냈다고 적지 않는다 — 옛 종 기록이 고아가 된다', async () => {
  const directory = temporaryDirectory('growth-empty-roster');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  createLegacyDatabase(legacyPath);
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.migrateLegacyData();

    assert.equal(repository.adoptRoster([]).size, 0);

    // 명부가 뒤늦게 도착해도 옛 성장을 그대로 물려받는다.
    const growth = repository.adoptRoster([seed('seed-001', 'mole_digger', '두더지', 3, 0)]);
    assert.deepEqual(growth.get('seed-001'), { level: 7, evolutionStage: 1 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('명부에 같은 id 가 둘이면 뒤엣것이 앞엣것의 성장을 덮어쓰지 않는다', async () => {
  const directory = temporaryDirectory('growth-duplicate-id');
  const legacyPath = join(directory, 'pet-overlay.sqlite');
  createLegacyDatabase(legacyPath);
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.migrateLegacyData();
    const growth = repository.adoptRoster([
      seed('dup', 'mole_digger', '두더지', 3, 0),
      seed('dup', 'mole_digger', '두더지', 3, 0),
    ]);
    // 물려받은 Lv.7 이 시드값 Lv.3 으로 되감기지 않는다.
    assert.deepEqual(growth.get('dup'), { level: 7, evolutionStage: 1 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('명부가 이름을 바꾸면 성장 기록의 표시명도 따라간다 — 성장 수치는 그대로다', async () => {
  const directory = temporaryDirectory('growth-rename');
  const legacyPath = join(directory, 'missing-legacy.sqlite');
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    repository.adoptRoster([seed('seed-006', 'star_wizard', '별빛마법사', 25, 2)]);
    repository.adoptRoster([seed('seed-006', 'star_wizard', '별이', 25, 2)]);

    const after = repository.loadAll();
    assert.equal(after['seed-006'].pet.name, '별이');
    assert.equal(after['seed-006'].pet.level, 25);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('쓸 수 없는 레벨이 명부를 뚫고 와도 앱 시작을 막지 않는다', async () => {
  const directory = temporaryDirectory('growth-bad-level');
  const legacyPath = join(directory, 'missing-legacy.sqlite');
  const { database, repository } = await openRepository(directory, legacyPath);

  try {
    database.open();
    // 스키마의 CHECK (level >= 1) 에 걸리면 창이 하나도 안 뜬 채 프로세스가 죽는다.
    const growth = repository.adoptRoster([
      seed('zero', 'mole_digger', '두더지', 0, 0),
      seed('fraction', 'sprout_treant', '새싹나무', 3.7, 0),
    ]);
    assert.equal(growth.get('zero').level, 1);
    assert.equal(growth.get('fraction').level, 3);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
