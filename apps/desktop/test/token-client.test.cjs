const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-token-${name}-`));
}

async function openClient(directory) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  return { database, tokens: new SqliteTokenClient(new TokenRepository(database)) };
}

function usage(overrides) {
  return {
    provider: 'claude_code',
    observed: 1_000,
    reward: 700,
    dedupeKey: 'claude_code:0->1000',
    occurredAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * 통계와 내역이 같은 값을 가리키는지 확인한다.
 *
 * 이 등식이 깨지면 어느 쪽이 진실인지 정할 방법이 없으므로, 모든 시나리오 끝에서 검사한다.
 */
function assertStatsMatchHistory(database, tokens) {
  const perProvider = new Map();
  for (const entry of tokens.recentHistory(1_000)) {
    const sum = perProvider.get(entry.provider) ?? { observed: 0, reward: 0 };
    sum.observed += entry.observed;
    sum.reward += entry.reward;
    perProvider.set(entry.provider, sum);
  }

  for (const stats of tokens.statsByProvider()) {
    const sum = perProvider.get(stats.provider);
    assert.ok(sum, `${stats.provider} 통계 행에 대응하는 내역이 없다`);
    assert.equal(stats.observed, sum.observed, `${stats.provider} observed 불일치`);
    assert.equal(stats.reward, sum.reward, `${stats.provider} reward 불일치`);
  }
  assert.equal(
    tokens.statsByProvider().length,
    perProvider.size,
    '내역이 있는 도구 수와 통계 행 수가 다르다',
  );
}

test('사용량을 적재하면 통계와 내역이 함께 생긴다', async () => {
  const directory = temporaryDirectory('record');
  const { database, tokens } = await openClient(directory);
  try {
    assert.equal(tokens.recordUsage(usage()), true);

    assert.deepEqual(tokens.statsByProvider(), [
      {
        provider: 'claude_code',
        observed: 1_000,
        reward: 700,
        updatedAt: '2026-09-21T00:00:00.000Z',
      },
    ]);
    assert.deepEqual(tokens.totals(), { observed: 1_000, reward: 700 });
    assert.equal(tokens.recentHistory(10).length, 1);
    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('같은 멱등 키로 두 번 적재하면 통계도 내역도 늘지 않는다', async () => {
  const directory = temporaryDirectory('idempotent');
  const { database, tokens } = await openClient(directory);
  try {
    assert.equal(tokens.recordUsage(usage()), true);
    assert.equal(tokens.recordUsage(usage({ occurredAt: '2026-09-21T00:05:00.000Z' })), false);

    assert.deepEqual(tokens.totals(), { observed: 1_000, reward: 700 }, '두 배가 되지 않는다');
    assert.equal(tokens.recentHistory(10).length, 1);
    const [stats] = tokens.statsByProvider();
    assert.equal(stats.updatedAt, '2026-09-21T00:00:00.000Z', '중복 호출은 시각도 바꾸지 않는다');
    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('도구마다 통계 행이 따로 쌓인다', async () => {
  const directory = temporaryDirectory('providers');
  const { database, tokens } = await openClient(directory);
  try {
    tokens.recordUsage(usage({ provider: 'claude_code', dedupeKey: 'cc:1' }));
    tokens.recordUsage(
      usage({ provider: 'claude_code', dedupeKey: 'cc:2', observed: 500, reward: 400 }),
    );
    tokens.recordUsage(
      usage({ provider: 'codex', dedupeKey: 'cx:1', observed: 2_000, reward: 1_500 }),
    );

    assert.deepEqual(
      tokens.statsByProvider().map((row) => [row.provider, row.observed, row.reward]),
      [
        ['claude_code', 1_500, 1_100],
        ['codex', 2_000, 1_500],
      ],
      'provider 오름차순으로 도구별 누적을 돌려준다',
    );
    assert.deepEqual(tokens.totals(), { observed: 3_500, reward: 2_600 });
    assert.equal(tokens.statsByProvider().length, 2, '기록이 없는 gemini_cli는 행이 생기지 않는다');
    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('닫고 다시 열어도 통계와 내역이 남는다', async () => {
  const directory = temporaryDirectory('restart');
  const first = await openClient(directory);
  try {
    first.tokens.recordUsage(usage({ dedupeKey: 'cc:1' }));
    first.tokens.recordUsage(usage({ provider: 'codex', dedupeKey: 'cx:1', observed: 30 }));
  } finally {
    first.database.close();
  }

  const second = await openClient(directory);
  try {
    assert.deepEqual(second.tokens.totals(), { observed: 1_030, reward: 1_400 });
    assert.equal(second.tokens.recentHistory(10).length, 2);
    assert.equal(
      second.tokens.recordUsage(usage({ dedupeKey: 'cc:1' })),
      false,
      '멱등 키는 재연결 후에도 유효하다',
    );
    assertStatsMatchHistory(second.database, second.tokens);
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('잘못된 입력은 거부하고 아무것도 남기지 않는다', async () => {
  const directory = temporaryDirectory('invalid');
  const { database, tokens } = await openClient(directory);
  try {
    const rejected = [
      ['알 수 없는 도구', usage({ provider: 'chatgpt' })],
      ['음수 토큰', usage({ observed: -1 })],
      ['소수 토큰', usage({ reward: 1.5 })],
      ['안전 정수 초과', usage({ observed: Number.MAX_SAFE_INTEGER + 2 })],
      ['빈 멱등 키', usage({ dedupeKey: '  ' })],
      ['탭·줄바꿈만 있는 멱등 키', usage({ dedupeKey: '\t\n' })],
    ];
    for (const [label, entry] of rejected) {
      assert.throws(() => tokens.recordUsage(entry), undefined, `${label}를 거부해야 한다`);
    }

    assert.deepEqual(tokens.totals(), { observed: 0, reward: 0 });
    assert.deepEqual(tokens.statsByProvider(), []);
    assert.deepEqual(tokens.recentHistory(10), []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('적재 중 실패하면 통계와 내역이 함께 rollback된다', async () => {
  const directory = temporaryDirectory('rollback');
  const { database, tokens } = await openClient(directory);
  try {
    tokens.recordUsage(usage({ dedupeKey: 'cc:1' }));

    // 통계 행의 CHECK 상한을 넘겨 UPSERT만 실패시킨다. 내역 INSERT는 이미 성공한 뒤다.
    assert.throws(() =>
      tokens.recordUsage(usage({ dedupeKey: 'cc:overflow', observed: Number.MAX_SAFE_INTEGER })),
    );

    assert.deepEqual(
      tokens.totals(),
      { observed: 1_000, reward: 700 },
      '실패한 적재는 통계를 바꾸지 않는다',
    );
    assert.equal(tokens.recentHistory(10).length, 1, '실패한 적재의 내역 행도 남지 않는다');
    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('token migration은 다시 열어도 한 번만 적용된다', async () => {
  const directory = temporaryDirectory('migration');
  const first = await openClient(directory);
  first.database.close();
  const second = await openClient(directory);
  try {
    const applied = second.database
      .prepare("SELECT version, name FROM schema_migrations WHERE scope = 'token'")
      .all();
    assert.deepEqual(applied, [{ version: 1, name: 'create token stats and history' }]);
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('기존 기능의 테이블과 같은 파일에 공존한다', async () => {
  const directory = temporaryDirectory('coexist');
  const { database, tokens } = await openClient(directory);
  try {
    tokens.recordUsage(usage());

    const scopes = database
      .prepare('SELECT DISTINCT scope FROM schema_migrations ORDER BY scope')
      .all()
      .map((row) => row.scope);
    assert.deepEqual(scopes, ['currency', 'overlay-growth', 'pet', 'token']);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('멱등 키의 앞뒤 공백은 같은 키로 본다', async () => {
  const directory = temporaryDirectory('dedupe-trim');
  const { database, tokens } = await openClient(directory);
  try {
    assert.equal(tokens.recordUsage(usage({ dedupeKey: '  cc:1  ' })), true);
    assert.equal(
      tokens.recordUsage(usage({ dedupeKey: 'cc:1' })),
      false,
      '공백 차이만으로 중복이 통과하면 안 된다',
    );

    assert.deepEqual(tokens.totals(), { observed: 1_000, reward: 700 });
    assert.equal(tokens.recentHistory(10)[0].dedupeKey, 'cc:1', '공백을 제거해서 저장한다');
    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('늦게 도착한 과거 인입이 마지막 기록 시각을 되돌리지 않는다', async () => {
  const directory = temporaryDirectory('out-of-order');
  const { database, tokens } = await openClient(directory);
  try {
    tokens.recordUsage(usage({ dedupeKey: 'cc:10시', occurredAt: '2026-09-21T10:00:00.000Z' }));
    tokens.recordUsage(
      usage({
        dedupeKey: 'cc:9시-지각',
        observed: 500,
        reward: 400,
        occurredAt: '2026-09-21T09:00:00.000Z',
      }),
    );

    const [stats] = tokens.statsByProvider();
    assert.equal(stats.updatedAt, '2026-09-21T10:00:00.000Z', '시각은 최신값을 유지한다');
    assert.equal(stats.observed, 1_500, '누적은 도착 순서와 무관하게 더해진다');

    // 더 최신 인입은 시각을 앞으로 옮긴다.
    tokens.recordUsage(usage({ dedupeKey: 'cc:11시', occurredAt: '2026-09-21T11:00:00.000Z' }));
    assert.equal(tokens.statsByProvider()[0].updatedAt, '2026-09-21T11:00:00.000Z');

    assertStatsMatchHistory(database, tokens);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
