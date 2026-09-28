const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-meta-${name}-`));
}

async function modules() {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { MetaRepository } =
    await import('../dist/main/persistence/repositories/meta-repository.js');
  const { SqliteMetaStore, importLegacyMetaSnapshot } = await import('../dist/main/meta-store.js');
  return {
    SqliteFileDatabase,
    APP_MIGRATIONS,
    MetaRepository,
    SqliteMetaStore,
    importLegacyMetaSnapshot,
  };
}

async function open(directory) {
  const m = await modules();
  const database = new m.SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: m.APP_MIGRATIONS,
  });
  database.open();
  return { ...m, database, repository: new m.MetaRepository(database) };
}

const counts = (input) => ({ input, output: input / 2, cacheCreate: 0, cacheRead: 3 });

/** 모든 표에 한 줄 이상이 들어간 스냅샷. 빠진 표가 있으면 그 표의 왕복을 검증하지 못한다. */
function sample() {
  return {
    schemaVersion: 2,
    sources: [
      {
        provider: 'claude_code',
        enabled: true,
        status: 'connected',
        baseline: {
          rows: [
            { date: '2026-09-01', rawModel: 'claude-opus-5', counts: counts(100) },
            { date: '2026-09-02', rawModel: 'claude-sonnet-5', counts: counts(40) },
          ],
          totalObserved: 140,
          capturedAt: '2026-09-01T09:00:00.000Z',
        },
        disabledAt: null,
        lastSuccessAt: '2026-09-17T10:00:00.000Z',
        lastError: null,
        everConnected: true,
      },
      {
        provider: 'codex',
        enabled: false,
        status: 'paused',
        baseline: null,
        disabledAt: '2026-09-10T00:00:00.000Z',
        lastSuccessAt: null,
        lastError: '경로를 찾지 못했어요',
        everConnected: false,
      },
    ],
    usageDaily: [
      {
        provider: 'claude_code',
        date: '2026-09-16',
        rawModel: 'claude-opus-5',
        counts: counts(900),
      },
      { provider: 'codex', date: '2026-09-17', rawModel: 'gpt-5.4-codex', counts: counts(300) },
    ],
    activityMinutes: ['2026-09-17T10:01', '2026-09-17T10:02'],
    processedDeltas: ['claude_code:0->900'],
    pendingUsageGrants: [{ dedupeKey: 'codex:0->300', rewardTokens: 300 }],
    processedEvents: ['battle-1'],
    eventFacts: {
      firstPet: 1,
      firstEpic: 0,
      dexOwned: 2,
      dexTotal: 20,
      dexComplete: 0,
      fusionCount: 0,
      commonFusionEpic: 0,
      maxPetLevel: 21,
      maxLevelReached: 0,
      evolutionCount: 1,
      battleWins: 3,
      maxStreak: 2,
    },
    progress: [
      {
        achievementId: 'collection.first_pet',
        progress: 1,
        unlockedAt: '2026-09-17T10:00:00.000Z',
      },
      { achievementId: 'battle.win_50', progress: 3, unlockedAt: null },
    ],
    rewards: [
      {
        achievementId: 'collection.first_pet',
        rewardKey: 'achievement:collection.first_pet',
        kind: 'coin',
        status: 'done',
        attempts: 1,
        lastError: null,
        detail: null,
      },
      {
        achievementId: 'collection.first_pet',
        rewardKey: 'achievement-title:collection.first_pet',
        kind: 'title',
        status: 'pending',
        attempts: 2,
        lastError: '일시 오류',
        detail: '초보 조련사',
      },
    ],
    profile: { equippedTitle: '초보 조련사', ownedTitles: ['초보 조련사', '토큰 헤비유저'] },
    settings: {
      overlayVisible: true,
      petSize: 'normal',
      autostart: false,
      notifyLevelup: true,
      notifyAchievement: true,
      notifyGachaReady: false,
    },
  };
}

const clone = (value) => structuredClone(value);

test('meta 표와 모든 열의 설명이 DB 스키마에 남는다', async () => {
  const directory = temporaryDirectory('comments');
  const { database } = await open(directory);
  try {
    // SQLite 에는 COMMENT 문법이 없다. CREATE TABLE 괄호 안의 `--` 주석만 스키마 원문에 보존되므로
    // DB 도구로 표 정의를 열었을 때 보이는 설명은 이것뿐이다.
    const tables = database
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
      .all()
      .filter((table) => table.name.startsWith('meta_'));
    assert.ok(tables.length > 0);

    for (const { name, sql } of tables) {
      const lines = sql.split('\n');
      assert.match(lines[0], /--\s*\S/, `${name}: 표 설명이 없다`);
      for (const { name: column } of database.prepare(`PRAGMA table_info(${name})`).all()) {
        const line = lines.find((text) => text.trim().startsWith(`${column} `));
        assert.match(line ?? '', /--\s*\S/, `${name}.${column}: 열 설명이 없다`);
      }
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('저장한 meta 스냅샷이 닫고 다시 열어도 순서까지 같다', async () => {
  const directory = temporaryDirectory('roundtrip');
  const first = await open(directory);
  try {
    assert.equal(first.repository.load(), undefined, '빈 DB 는 새 설치다');
    first.repository.write(undefined, sample());
  } finally {
    first.database.close();
  }

  const second = await open(directory);
  try {
    assert.deepEqual(second.repository.load(), sample());
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('연산 하나는 바뀐 행만 쓴다', async () => {
  const directory = temporaryDirectory('diff');
  const { database, repository } = await open(directory);
  try {
    const before = sample();
    repository.write(undefined, before);

    const after = clone(before);
    after.settings.notifyLevelup = false;
    const stats = repository.write(before, after);

    // 설정 토글 하나에 표 열두 개를 다시 쓰면 실시간 저장이 매번 전체 재작성이 된다.
    assert.deepEqual(stats, { upserted: 1, deleted: 0 });
    assert.equal(repository.load().settings.notifyLevelup, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('쓰기 도중 실패하면 DB 는 이전 상태 그대로다', async () => {
  const directory = temporaryDirectory('atomic');
  const { database, repository } = await open(directory);
  try {
    const before = sample();
    repository.write(undefined, before);

    const broken = clone(before);
    // 먼저 쓰이는 표를 바꾸고, 마지막에 쓰이는 설정에 NOT NULL 위반을 넣는다.
    // 트랜잭션이 아니라면 사용량 행만 남은 반쪽 상태가 된다.
    broken.usageDaily.push({
      provider: 'gemini_cli',
      date: '2026-09-17',
      rawModel: 'gemini-3-pro',
      counts: counts(10),
    });
    broken.processedDeltas.push('gemini_cli:0->10');
    broken.settings.petSize = null;

    assert.throws(() => repository.write(before, broken));
    assert.deepEqual(repository.load(), before, '반쪽짜리 쓰기가 남지 않는다');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('사라진 행은 DB 에서도 지워진다', async () => {
  const directory = temporaryDirectory('delete');
  const { database, repository } = await open(directory);
  try {
    const before = sample();
    repository.write(undefined, before);

    const after = clone(before);
    after.pendingUsageGrants = []; // 지급이 끝나 대기에서 빠졌다
    after.sources[0].baseline.rows = [
      { date: '2026-09-17', rawModel: 'claude-opus-5', counts: counts(5) },
    ]; // 기준점이 통째로 다시 잡혔다

    repository.write(before, after);
    assert.deepEqual(repository.load(), after);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('실패한 저장의 변경은 다음 저장에서 함께 쓰인다', async () => {
  const directory = temporaryDirectory('retry');
  const opened = await open(directory);
  try {
    const store = new opened.SqliteMetaStore(opened.repository);
    assert.equal(store.load(), undefined);
    store.save(sample());

    const failing = sample();
    failing.eventFacts.battleWins = 9; // 이 변경이 살아남아야 한다
    failing.settings.petSize = null;
    assert.throws(() => store.save(failing));

    // 확정본이 실패한 저장으로 앞서 나가면, 다음 저장이 battleWins 를 “이미 쓴 것”으로 보고 빠뜨린다.
    const next = sample();
    next.eventFacts.battleWins = 9;
    next.settings.autostart = true;
    store.save(next);
  } finally {
    opened.database.close();
  }

  const reopened = await open(directory);
  try {
    const loaded = reopened.repository.load();
    assert.equal(loaded.eventFacts.battleWins, 9);
    assert.equal(loaded.settings.autostart, true);
  } finally {
    reopened.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('옛 meta-state.json 은 한 번만 옮기고 이름을 바꾼다', async () => {
  const directory = temporaryDirectory('import');
  const legacyPath = join(directory, 'meta-state.json');
  writeFileSync(legacyPath, JSON.stringify(sample()));
  const opened = await open(directory);
  try {
    const store = new opened.SqliteMetaStore(opened.repository);
    store.load();

    assert.equal(opened.importLegacyMetaSnapshot(directory, store), 'imported');
    assert.equal(existsSync(legacyPath), false, '옮긴 파일은 남기지 않는다');
    assert.equal(existsSync(`${legacyPath}.migrated`), true, '지우지 않고 이름만 바꾼다');
    assert.deepEqual(opened.repository.load(), sample());

    assert.equal(
      opened.importLegacyMetaSnapshot(directory, store),
      'none',
      '두 번째 실행은 할 일이 없다',
    );
  } finally {
    opened.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('옮긴 뒤 이름을 바꾸기 전에 꺼졌다면 다시 옮기지 않는다', async () => {
  const directory = temporaryDirectory('import-crash');
  const legacyPath = join(directory, 'meta-state.json');
  const opened = await open(directory);
  try {
    const store = new opened.SqliteMetaStore(opened.repository);
    store.load();
    const current = sample();
    current.settings.autostart = true; // DB 에는 그 뒤로 바뀐 값이 있다
    store.save(current);

    // 옛 파일이 남아 있다 — 가져오기는 끝났지만 이름을 바꾸기 전에 앱이 꺼진 경우다.
    writeFileSync(legacyPath, JSON.stringify(sample()));

    assert.equal(opened.importLegacyMetaSnapshot(directory, store), 'renamed');
    assert.equal(
      opened.repository.load().settings.autostart,
      true,
      '옛 파일이 새 값을 덮지 않는다',
    );
    assert.equal(existsSync(`${legacyPath}.migrated`), true);
  } finally {
    opened.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
