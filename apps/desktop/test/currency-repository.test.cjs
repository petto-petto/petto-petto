const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-currency-${name}-`));
}

async function openRepository(directory) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  return { database, repository: new CurrencyRepository(database) };
}

test('같은 멱등 키로 두 번 지급하면 두 번째는 기록되지 않는다', async () => {
  const directory = temporaryDirectory('idempotent');
  const { database, repository } = await openRepository(directory);
  try {
    assert.equal(
      repository.recordGrant('achievement:first_pet', 10, '첫 만남', '2026-09-08T00:00:00.000Z'),
      true,
    );
    assert.equal(
      repository.recordGrant('achievement:first_pet', 10, '첫 만남', '2026-09-08T00:01:00.000Z'),
      false,
    );

    assert.equal(repository.balance(), 10, '두 번 더해지지 않는다');
    assert.equal(repository.recent(10).length, 1);
    assert.equal(repository.grantedAmount('achievement:first_pet'), 10);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('재화가 닫고 다시 열어도 남는다', async () => {
  const directory = temporaryDirectory('restart');
  const first = await openRepository(directory);
  try {
    first.repository.recordGrant(
      'usage:claude_code:1',
      42,
      '사용량 보상',
      '2026-09-08T00:00:00.000Z',
    );
    first.repository.recordSpend(12, '뽑기', '2026-09-08T00:05:00.000Z');
  } finally {
    first.database.close();
  }

  const second = await openRepository(directory);
  try {
    // 이 테스트가 존재하는 이유: 예전 구현은 인메모리라 여기서 0이 나왔고, meta 는 멱등
    // 키를 자기 스냅샷에 남겨 다시 지급하지도 않았다. 코인이 영구히 사라지는 상태였다.
    assert.equal(second.repository.balance(), 30);
    assert.deepEqual(second.repository.totals(), { earned: 42, spent: 12, balance: 30 });
    assert.equal(second.repository.recent(10).length, 2);

    // 재실행 후에도 같은 키는 다시 지급되지 않는다.
    assert.equal(
      second.repository.recordGrant(
        'usage:claude_code:1',
        42,
        '사용량 보상',
        '2026-09-08T01:00:00.000Z',
      ),
      false,
    );
    assert.equal(second.repository.balance(), 30);
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('소비는 멱등 키가 없어 같은 이유로 여러 번 기록된다', async () => {
  const directory = temporaryDirectory('spend');
  const { database, repository } = await openRepository(directory);
  try {
    repository.recordGrant('grant', 100, '적립', '2026-09-08T00:00:00.000Z');
    repository.recordSpend(30, '뽑기', '2026-09-08T00:01:00.000Z');
    repository.recordSpend(30, '뽑기', '2026-09-08T00:02:00.000Z');

    assert.equal(repository.balance(), 40, 'NULL 멱등 키는 UNIQUE 제약에 걸리지 않는다');
    assert.deepEqual(repository.totals(), { earned: 100, spent: 60, balance: 40 });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('최근 원장은 최신순이고 요청한 개수만 준다', async () => {
  const directory = temporaryDirectory('recent');
  const { database, repository } = await openRepository(directory);
  try {
    for (let index = 0; index < 5; index += 1) {
      // 시각이 모두 같아도 순서가 정해져야 한다 — `entry_id` 로 정렬하는 이유다.
      repository.recordGrant(
        `key-${index}`,
        index + 1,
        `지급 ${index}`,
        '2026-09-08T00:00:00.000Z',
      );
    }

    const recent = repository.recent(3);
    assert.equal(recent.length, 3);
    assert.deepEqual(
      recent.map((row) => row.reason),
      ['지급 4', '지급 3', '지급 2'],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('다른 scope 의 같은 version 이 함께 적용된다', async () => {
  const directory = temporaryDirectory('scopes');
  const { database } = await openRepository(directory);
  try {
    const rows = database
      .prepare('SELECT scope, version FROM schema_migrations ORDER BY scope')
      .all();
    const applied = rows.map((row) => `${row.scope}/${row.version}`);
    assert.ok(applied.includes('currency/1'), `currency/1 이 적용되지 않았다: ${applied}`);
    assert.ok(
      applied.includes('overlay-growth/1'),
      `overlay-growth/1 이 적용되지 않았다: ${applied}`,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
