const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

/**
 * meta 가 수집한 사용량이 공용 토큰 표와 재화 원장에 닿는지를 실제 SQLite 로 확인한다.
 *
 * 수집기만 픽스처다. 그 뒤의 `TokenClient` 와 저장소는 앱이 조립하는 것과 같은 것을 쓴다 — meta 는
 * 사용량 적재도 재화 지급도 뽑기·합성과 같은 `TokenClient` 하나로 한다.
 */
async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const { FixedClock } = await import('@pet/core');
  const meta = await import('@pet/meta');

  const directory = mkdtempSync(join(tmpdir(), 'petto-meta-token-ingest-'));
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.open();

  const clock = new FixedClock('2026-10-05T09:30:00+09:00');
  const ledger = new CurrencyRepository(database);
  const tokens = new SqliteTokenClient(new TokenRepository(database), ledger, () =>
    clock.now().toISOString(),
  );
  const collector = meta.FixtureCollector.withEmptySnapshots();
  const state = meta.createMetaState();
  const run = () => meta.runAggregation(state, collector, tokens, clock);
  return { database, meta, state, collector, tokens, ledger, clock, run };
}

test('수집한 증가분이 토큰 표에 쌓이고 보상 대상 토큰이 그대로 재화가 된다', async (t) => {
  const { meta, collector, tokens, ledger, clock, run } = await fixture(t);

  // 첫 집계는 기준점만 잡는다. 앱을 켜기 전 기록은 어디에도 쌓이지 않는다.
  collector.accumulate('claude_code', '2026-10-01', 'claude-opus-5', meta.tokenCounts(9_000_000));
  run();
  assert.deepEqual(tokens.totals(), { observed: 0, reward: 0 });
  assert.equal(tokens.balance(), 0);

  // 입력 400,000 + 출력 100,000 + 캐시 생성 200,000 + 캐시 읽기 5,000,000.
  collector.accumulate(
    'claude_code',
    '2026-10-05',
    'claude-opus-5',
    meta.tokenCounts(400_000, 100_000, 200_000, 5_000_000),
  );
  collector.accumulate('codex', '2026-10-05', 'gpt-5.4-codex', meta.tokenCounts(30_000, 10_000));
  run();
  // 같은 누적값으로 다시 집계해도 두 배가 되지 않는다.
  run();

  assert.deepEqual(tokens.statsByProvider(), [
    {
      provider: 'claude_code',
      observed: 5_700_000,
      reward: 700_000,
      updatedAt: clock.now().toISOString(),
    },
    { provider: 'codex', observed: 40_000, reward: 40_000, updatedAt: clock.now().toISOString() },
  ]);
  assert.equal(tokens.recentHistory(10).length, 2, '도구마다 증가분 하나씩');

  // 뽑기·합성이 읽는 바로 그 잔액이다. 캐시 읽기를 뺀 토큰 수가 환산 없이 그대로 들어온다.
  assert.equal(tokens.balance(), 740_000);
  assert.equal(tokens.earnedSince('2026-10-05T00:00:00.000Z'), 740_000);
  assert.deepEqual(
    ledger
      .recent(10)
      .map((entry) => [entry.reason, entry.delta])
      .sort(),
    [
      ['사용량 보상', 40_000],
      ['사용량 보상', 700_000],
    ],
  );
});

test('사용량 보상으로 쌓인 재화로 뽑기 1회 값을 치를 수 있다', async (t) => {
  const { meta, collector, tokens, run } = await fixture(t);
  run();
  collector.accumulate('claude_code', '2026-10-05', 'claude-opus-5', meta.tokenCounts(120_000));
  run();

  // 뽑기 1회는 100,000이다. 예전의 1/10,000 환산에서는 12밖에 쌓이지 않아 치를 수 없었다.
  assert.equal(tokens.spendOnce('gacha:test-request', 100_000, '펫 뽑기'), 'spent');
  assert.equal(tokens.balance(), 20_000);
  assert.deepEqual(
    tokens.totals(),
    { observed: 120_000, reward: 120_000 },
    '사용량은 소비해도 줄지 않는다',
  );
});

test('토큰 표 적재가 실패하면 사용량도 재화도 반영하지 않고 다음 집계에서 채운다', async (t) => {
  const { database, meta, state, collector, tokens, run } = await fixture(t);
  run();
  collector.accumulate('codex', '2026-10-05', 'gpt-5.4-codex', meta.tokenCounts(3_000, 1_000));

  // 토큰 내역 표가 쓰기에 실패하는 상황을 만든다.
  database.exec(`
    CREATE TRIGGER fail_token_history BEFORE INSERT ON token_history
    BEGIN SELECT RAISE(ABORT, 'forced token failure'); END;
  `);
  const failed = run().outcomes.find((outcome) => outcome.provider === 'codex');

  assert.equal(failed.result.kind, 'failed');
  assert.equal(meta.observedTotal(state), 0);
  assert.equal(tokens.balance(), 0);

  database.exec('DROP TRIGGER fail_token_history');
  const retried = run().outcomes.find((outcome) => outcome.provider === 'codex');

  assert.equal(retried.result.kind, 'applied');
  assert.equal(meta.observedTotal(state), 4_000);
  assert.deepEqual(tokens.totals(), { observed: 4_000, reward: 4_000 });
  assert.equal(tokens.balance(), 4_000);
});
