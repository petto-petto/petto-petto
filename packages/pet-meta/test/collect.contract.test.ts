/**
 * 기획서 12장 `수집` 인수 조건(COLLECT-002 ~ COLLECT-009)의 실행 증거.
 *
 * 각 테스트 이름과 주석에 대응하는 요구사항 ID를 적는다(META-005).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FixedClock, PROVIDERS, type Provider } from '@pet/core';
import {
  CollectError,
  FixtureCollector,
  createMetaState,
  defaultLogLocation,
  factSnapshot,
  observedTotal,
  rescanSource,
  runAggregation,
  setSourceEnabled,
  sourceOf,
  tokenCounts,
  type AggregationRun,
  type MetaState,
  type SourceRunResult,
} from '@pet/meta';
import { InMemoryCurrency } from '@pet/stubs';

const NOW = '2026-08-24T14:37:12+09:00';

class Harness {
  state: MetaState;
  collector: FixtureCollector;
  currency: InMemoryCurrency;
  clock: FixedClock;

  constructor() {
    this.collector = FixtureCollector.withEmptySnapshots();
    this.clock = new FixedClock(NOW);
    this.currency = new InMemoryCurrency();
    this.currency.setNow(this.clock.now());
    this.state = createMetaState(1);
  }

  runFull(): AggregationRun {
    return runAggregation(this.state, this.collector, this.currency, this.clock);
  }

  run(): SourceRunResult[] {
    return this.runFull().outcomes.map((outcome) => outcome.result);
  }

  runFor(provider: Provider): SourceRunResult {
    const run = rescanSource(this.state, this.collector, this.currency, this.clock, provider);
    const outcome = run.outcomes[0];
    assert.ok(outcome, '소스 하나의 결과가 있어야 한다');
    return outcome.result;
  }

  static resultFor(results: SourceRunResult[], provider: Provider): SourceRunResult {
    const index = PROVIDERS.indexOf(provider);
    const result = results[index];
    assert.ok(result, '알려진 소스여야 한다');
    return result;
  }
}

const tokens = (input: number, output = 0, cacheCreate = 0, cacheRead = 0) =>
  tokenCounts(input, output, cacheCreate, cacheRead);

test('COLLECT-002: 첫 정상 스캔이 통계·코인·활동 시간·업적을 증가시키지 않는다', () => {
  const harness = new Harness();
  // 설치 전에 이미 쌓여 있던 대량의 기록.
  harness.collector.accumulate('claude_code', '2026-05-01', 'claude-opus-5', tokens(9_000_000));

  const results = harness.run();

  assert.deepEqual(Harness.resultFor(results, 'claude_code'), { kind: 'baseline_captured' });
  assert.equal(observedTotal(harness.state), 0, '설치 전 기록은 통계에 잡히지 않는다');
  assert.equal(harness.state.activityMinutes.size, 0, '활동 시간도 늘지 않는다');
  assert.equal(harness.currency.grantedKeyCount, 0, '코인도 지급되지 않는다');
  assert.equal(factSnapshot(harness.state).observed_tokens, 0, '업적 사실도 0이어야 한다');
});

test('COLLECT-003: 재스캔이 주기 집계와 같은 수집 경계를 쓴다', () => {
  const harness = new Harness();

  // 수동 재스캔이 최초 스캔이어도 기준점 규칙이 동일하게 적용된다.
  harness.collector.accumulate('codex', '2026-08-01', 'gpt-5.4-codex', tokens(5_000, 5_000));
  assert.deepEqual(harness.runFor('codex'), { kind: 'baseline_captured' });
  assert.equal(observedTotal(harness.state), 0);

  // 이후 증가분도 주기 집계와 같은 방식으로 반영된다.
  harness.collector.accumulate('codex', '2026-08-24', 'gpt-5.4-codex', tokens(1_000, 1_000));
  assert.deepEqual(harness.runFor('codex'), {
    kind: 'applied',
    observedDelta: 2_000,
    rewardTokens: 2_000,
  });
  assert.equal(observedTotal(harness.state), 2_000);
});

test('COLLECT-004: 집계를 반복해도 각 값이 한 번만 변한다', () => {
  const harness = new Harness();
  harness.run(); // 기준점 확보

  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokens(500_000, 200_000, 300_000, 1_000_000),
  );

  harness.run();
  const observedAfterFirst = observedTotal(harness.state);
  const minutesAfterFirst = harness.state.activityMinutes.size;
  const grantsAfterFirst = harness.currency.grantedKeyCount;

  for (let index = 0; index < 4; index += 1) harness.run();

  assert.equal(observedTotal(harness.state), observedAfterFirst);
  assert.equal(harness.state.activityMinutes.size, minutesAfterFirst);
  assert.equal(harness.currency.grantedKeyCount, grantsAfterFirst);
});

test('COLLECT-004: 기준점 갱신 직전에 죽어도 같은 증가분을 두 번 세지 않는다', () => {
  // 기획서 8.3: 4~7단계 중간 실패 후 재실행해도 같은 증가분을 두 번 반영하지 않는다.
  const harness = new Harness();
  harness.run();

  const before = sourceOf(harness.state, 'claude_code').baseline;
  assert.ok(before, '기준점이 있어야 한다');
  const snapshotBefore = {
    rows: new Map(before.rows),
    totalObserved: before.totalObserved,
    capturedAt: before.capturedAt,
  };

  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(10_000, 5_000));
  harness.run();
  const observedOnce = observedTotal(harness.state);
  assert.equal(observedOnce, 15_000);

  // 기준점만 예전 값으로 되돌린다 = 저장은 됐지만 7단계가 반영되지 않은 상태.
  sourceOf(harness.state, 'claude_code').baseline = snapshotBefore;

  const results = harness.run();

  assert.deepEqual(
    Harness.resultFor(results, 'claude_code'),
    { kind: 'duplicate' },
    '이미 처리한 증가분은 중복 키 검사에서 걸러진다',
  );
  assert.equal(observedTotal(harness.state), observedOnce, '사용량이 두 번 반영되면 안 된다');
});

test('COLLECT-005: 한 소스의 실패가 다른 두 소스를 막지 않는다', () => {
  const harness = new Harness();
  harness.run();

  harness.collector.setError('codex', new CollectError('execution_failed'));
  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(1_000, 1_000));
  harness.collector.accumulate('gemini_cli', '2026-08-24', 'gemini-3-pro', tokens(2_000, 2_000));

  const results = harness.run();

  assert.deepEqual(Harness.resultFor(results, 'claude_code'), {
    kind: 'applied',
    observedDelta: 2_000,
    rewardTokens: 2_000,
  });
  const codex = Harness.resultFor(results, 'codex');
  assert.equal(codex.kind, 'failed');
  assert.deepEqual(Harness.resultFor(results, 'gemini_cli'), {
    kind: 'applied',
    observedDelta: 4_000,
    rewardTokens: 4_000,
  });
  assert.equal(observedTotal(harness.state), 6_000);
});

test('COLLECT-006: 관측 토큰과 보상 대상 토큰이 각자의 계약값으로 쓰인다', () => {
  const harness = new Harness();
  harness.run();

  // 관측 = 500k + 200k + 300k + 1_000k = 2_000_000
  // 보상 = 500k + 200k + 300k           = 1_000_000  (캐시 읽기 제외)
  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokens(500_000, 200_000, 300_000, 1_000_000),
  );

  const results = harness.run();
  const result = Harness.resultFor(results, 'claude_code');
  assert.equal(result.kind, 'applied');
  assert.equal(result.observedDelta, 2_000_000);
  assert.equal(result.rewardTokens, 1_000_000);
  assert.notEqual(result.observedDelta, result.rewardTokens, '두 값은 분리되어야 한다');

  // 정보는 관측 토큰을 쓴다.
  assert.equal(observedTotal(harness.state), 2_000_000);

  // 코인은 보상 대상 토큰에서 나온다. 대역의 환산 비율은 10,000 토큰당 1코인이므로
  // 관측 토큰 기준이면 200, 보상 대상 기준이면 100이다.
  assert.equal(
    harness.currency.grantedAmount('claude_code:0->2000000'),
    100,
    '코인 환산에 관측 토큰이 아니라 보상 대상 토큰이 쓰여야 한다',
  );
});

test('COLLECT-007: 같은 로컬 분에 세 소스가 증가해도 활동 시간은 1분만 증가한다', () => {
  const harness = new Harness();
  harness.run();

  for (const [provider, model] of [
    ['claude_code', 'claude-opus-5'],
    ['codex', 'gpt-5.4-codex'],
    ['gemini_cli', 'gemini-3-pro'],
  ] as const) {
    harness.collector.accumulate(provider, '2026-08-24', model, tokens(1_000, 1_000));
  }

  harness.run();
  assert.equal(harness.state.activityMinutes.size, 1, '세 소스가 늘어도 1분');

  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(500, 500));
  harness.run();
  assert.equal(harness.state.activityMinutes.size, 1, '같은 분의 추가 증가도 1분');

  harness.clock.advanceSeconds(60);
  harness.collector.accumulate('codex', '2026-08-24', 'gpt-5.4-codex', tokens(500, 500));
  harness.run();
  assert.equal(harness.state.activityMinutes.size, 2);
});

test('COLLECT-007: 증가가 없는 집계는 활동 분을 더하지 않는다', () => {
  const harness = new Harness();
  harness.run();
  harness.clock.advanceSeconds(60);
  harness.run();
  assert.equal(harness.state.activityMinutes.size, 0);
});

test('COLLECT-008 / SET-003: 비활성 기간 기록은 되살아나지 않고 과거 통계는 유지된다', () => {
  const harness = new Harness();
  harness.run();

  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(3_000, 2_000));
  harness.run();
  const beforeDisable = observedTotal(harness.state);
  assert.equal(beforeDisable, 5_000);

  setSourceEnabled(harness.state, harness.clock, 'claude_code', false);

  // 꺼져 있는 동안 CLI를 많이 썼다.
  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokens(400_000, 400_000),
  );
  assert.deepEqual(Harness.resultFor(harness.run(), 'claude_code'), { kind: 'skipped' });
  assert.equal(observedTotal(harness.state), beforeDisable, '꺼진 동안에는 집계하지 않는다');

  // 다시 켠다. 현재 상태가 새 기준점이 된다.
  setSourceEnabled(harness.state, harness.clock, 'claude_code', true);
  assert.deepEqual(Harness.resultFor(harness.run(), 'claude_code'), { kind: 'baseline_captured' });
  assert.equal(
    observedTotal(harness.state),
    beforeDisable,
    'SET-003: 과거 통계는 유지되고 비활성 기간은 소급되지 않는다',
  );

  // 재활성 이후의 증가분만 반영된다.
  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(1_000));
  harness.run();
  assert.equal(observedTotal(harness.state), beforeDisable + 1_000);
});

test('COLLECT-008: 소스를 껐다 켜는 것은 최초 실행이 아니다', () => {
  const harness = new Harness();
  harness.run();

  for (const provider of PROVIDERS) {
    setSourceEnabled(harness.state, harness.clock, provider, false);
    setSourceEnabled(harness.state, harness.clock, provider, true);
  }
  assert.equal(
    harness.state.sources.get('claude_code')?.everConnected,
    true,
    '껐다 켠 것은 최초 실행이 아니다',
  );
});

test('COLLECT-009: 누적 원천값 감소가 저장된 통계를 줄이지 않는다', () => {
  const harness = new Harness();
  harness.run();

  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokens(600_000, 400_000),
  );
  harness.run();
  const before = observedTotal(harness.state);
  assert.equal(before, 1_000_000);

  // 사용자가 원본 로그를 지웠다. 수집기의 누적값이 줄어든다.
  harness.collector.setSnapshot({ provider: 'claude_code', rows: new Map() });
  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(1_000));

  assert.deepEqual(Harness.resultFor(harness.run(), 'claude_code'), { kind: 'rebased' });
  assert.equal(observedTotal(harness.state), before, '저장된 통계는 줄어들지 않는다');

  // 새 기준점에서 다시 증가분이 잡힌다.
  harness.collector.accumulate('claude_code', '2026-08-25', 'claude-opus-5', tokens(2_000));
  harness.run();
  assert.equal(observedTotal(harness.state), before + 2_000);
});

test('COLLECT-009: 행 하나가 줄어도 그 행의 저장값이 깎이지 않는다', () => {
  const harness = new Harness();
  harness.collector.accumulate('claude_code', '2026-08-20', 'claude-opus-5', tokens(10_000));
  harness.run();

  // 어제 행은 줄고 오늘 행이 크게 늘었다.
  harness.collector.setSnapshot({ provider: 'claude_code', rows: new Map() });
  harness.collector.accumulate('claude_code', '2026-08-20', 'claude-opus-5', tokens(4_000));
  harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(50_000));
  harness.run();

  assert.equal(
    observedTotal(harness.state),
    50_000,
    '줄어든 행은 0으로 잘리고 늘어난 행만 반영된다',
  );
});

test('실패한 재화 지급은 같은 멱등 키로 재시도된다', () => {
  const harness = new Harness();
  harness.run();

  harness.collector.accumulate(
    'claude_code',
    '2026-08-24',
    'claude-opus-5',
    tokens(500_000, 500_000),
  );
  harness.currency.failNextGrant();

  const run = harness.runFull();
  assert.ok(
    run.outcomes.some((outcome) => outcome.currencyError !== undefined),
    '지급 실패가 결과에 드러나야 한다',
  );
  assert.equal(harness.currency.grantedKeyCount, 0);
  assert.equal(harness.state.pendingUsageGrants.size, 1, '실패한 지급은 재시도 대기로 남는다');
  assert.equal(observedTotal(harness.state), 1_000_000, '사용량 자체는 이미 반영됐다');

  harness.clock.advanceSeconds(60);
  harness.run();
  assert.equal(harness.currency.grantedKeyCount, 1);
  assert.equal(harness.state.pendingUsageGrants.size, 0);

  harness.run();
  assert.equal(harness.currency.grantedKeyCount, 1, '한 번 더 돌려도 중복 지급되지 않는다');
});

test('증가분마다 자기 멱등 키로 지급받는다', () => {
  // 회귀 방지. 멱등 키는 `<provider>:<이전 총합>-><현재 총합>` 문자열인데, 저장된 키
  // 집합에서 "이 소스의 마지막 키"를 사전순으로 찾으면 틀린다. `90->100`이
  // `100->250`보다 뒤에 오기 때문이다.
  const harness = new Harness();
  harness.run();

  const steps = [90, 10, 150];
  steps.forEach((step, index) => {
    harness.collector.accumulate('claude_code', '2026-08-24', 'claude-opus-5', tokens(step));
    harness.clock.advanceSeconds(60);
    harness.run();
    assert.equal(
      harness.currency.grantedKeyCount,
      index + 1,
      `${index + 1}번째 증가분이 자기 멱등 키로 지급받지 못했다`,
    );
  });

  assert.equal(observedTotal(harness.state), 250);
  assert.equal(harness.state.pendingUsageGrants.size, 0);
});

test('기록을 못 찾은 소스가 내부 정보 대신 기본 위치와 분류된 오류를 보여준다', () => {
  // 기획서 11.1: 사용자에게 원본 로그 내용과 내부 명령 출력 대신 도구 이름, 오류 종류,
  // 마지막 정상 집계 시각, 재시도 행동만 보여준다.
  assert.equal(defaultLogLocation('claude_code'), '~/.claude/projects');
  assert.equal(new CollectError('not_found').userMessage(), '기록을 찾을 수 없음');
  assert.equal(new CollectError('unsupported_schema').userMessage(), '앱 업데이트가 필요합니다');
});
