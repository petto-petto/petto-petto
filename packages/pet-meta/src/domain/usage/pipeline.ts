/**
 * 수집 파이프라인. 기획서 8장이 전부 여기 있다.
 *
 * ## 한 번의 집계가 하는 일 (기획서 8.3)
 *
 * 1. 고정 버전 수집기 실행과 JSON 검증
 * 2. 소스별 기준점 이후 증가분 계산
 * 3. 중복 키 검사
 * 4. 사용량·활동 분·업적 사실 저장
 * 5. 보상 대상 토큰을 재화 도메인에 멱등 요청
 * 6. `usage.aggregated` 발행
 * 7. 소스별 기준점과 마지막 성공 시각 갱신
 *
 * ## 왜 "기준점 + 누적 스냅샷" 방식인가
 *
 * 수집기는 실행할 때마다 **전체 누적 기록**을 돌려준다. 증가분만 주는 게 아니다.
 * 그래서 "설치 전 기록을 제외한다"(기획서 8.2)를 지키려면, 첫 스캔 결과를 진행량으로
 * 적립하지 않고 **기준점**으로만 저장한 다음, 이후 스캔에서 기준점과의 차이만 반영하면
 * 된다. 로그 파일을 지우거나 앱을 다시 깔지 않아도 되고, 원천 로그를 건드리지도 않는다.
 */

import { PROVIDERS, localMinuteOf, type Clock, type Provider } from '@pet/core';
import { domainEvent, eventId, type DomainEvent } from '../../events/index.ts';

import type { CurrencyPort } from '../../ports/index.ts';
import { sourceOf, usageKey, type MetaState } from '../state.ts';
import {
  CollectError,
  snapshotTotal,
  splitRowKey,
  type SnapshotRows,
  type UsageCollector,
} from './collector.ts';
import { addTokens, isZero, observed, rewardTokens, subtractTokens } from './tokens.ts';

/** 소스 하나의 집계 결과. */
export type SourceRunResult =
  /** 첫 정상 스캔. 기준점만 저장하고 아무것도 적립하지 않았다(COLLECT-002). */
  | { kind: 'baseline_captured' }
  /** 증가분을 반영했다. */
  | { kind: 'applied'; observedDelta: number; rewardTokens: number }
  /** 기준점과 누적값이 같다. 새 사용이 없었다. */
  | { kind: 'no_change' }
  /** 이미 처리한 증가분이다(COLLECT-004). */
  | { kind: 'duplicate' }
  /** 누적값이 기준점보다 작아져 기준점을 다시 잡았다(기획서 8.8). */
  | { kind: 'rebased' }
  /** 소스가 꺼져 있어 실행하지 않았다(기획서 8.4). */
  | { kind: 'skipped' }
  /** 수집 실패. 다른 소스에는 영향을 주지 않는다(COLLECT-005). */
  | { kind: 'failed'; error: CollectError };

export interface SourceOutcome {
  provider: Provider;
  result: SourceRunResult;
  /**
   * 이번에 반영한 증가분의 멱등 키. `applied`일 때만 채워진다.
   *
   * 나중에 저장소에서 되찾지 않고 **여기 실어 나른다.** 키는
   * `<provider>:<이전 총합>-><현재 총합>` 문자열이라 저장 순서가 사전순이고,
   * `90->100`이 `100->250`보다 뒤에 온다. "마지막 키"를 뒤늦게 찾으면 틀린 키를 집어
   * 이미 지급된 것으로 처리돼 새 증가분의 코인이 사라진다.
   */
  appliedDedupeKey: string | undefined;
  /** 재화 지급 실패. 사용량 반영 자체는 성공했으므로 결과와 분리한다. */
  currencyError: string | undefined;
}

export interface AggregationRun {
  outcomes: SourceOutcome[];
  /** 이번 집계가 활동 분을 **새로** 적립했는가. */
  activityMinuteAdded: boolean;
  /** 발행할 이벤트. 호출자가 이벤트 버스로 넘긴다. */
  events: DomainEvent[];
}

const dedupeKeyOf = (provider: Provider, from: number, to: number): string =>
  `${provider}:${from}->${to}`;

/** 앱 시작·1분 주기 집계. 세 소스를 정해진 순서로 처리한다. */
export function runAggregation(
  state: MetaState,
  collector: UsageCollector,
  currency: CurrencyPort,
  clock: Clock,
): AggregationRun {
  return runProviders(state, collector, currency, clock, PROVIDERS);
}

/**
 * 카드별 수동 재스캔.
 *
 * 기획서 COLLECT-003은 앱 시작·1분 주기·수동 재스캔이 **같은 수집 경계**를 쓰라고 정한다.
 * 그래서 별도 구현을 두지 않고 대상 소스만 하나로 줄여 같은 함수를 부른다.
 */
export function rescanSource(
  state: MetaState,
  collector: UsageCollector,
  currency: CurrencyPort,
  clock: Clock,
  provider: Provider,
): AggregationRun {
  return runProviders(state, collector, currency, clock, [provider]);
}

function runProviders(
  state: MetaState,
  collector: UsageCollector,
  currency: CurrencyPort,
  clock: Clock,
  providers: readonly Provider[],
): AggregationRun {
  const now = clock.now();

  // 지난 집계에서 실패한 재화 지급을 먼저 재시도한다. 멱등 키가 같으므로
  // 이미 지급된 것이 다시 지급되지는 않는다.
  retryPendingGrants(state, currency);

  const outcomes: SourceOutcome[] = [];
  const events: DomainEvent[] = [];

  for (const provider of providers) {
    const outcome = runSingleSource(state, collector, provider, now);

    if (outcome.result.kind === 'applied' && outcome.appliedDedupeKey !== undefined) {
      const key = outcome.appliedDedupeKey;

      // 5단계: 보상 대상 토큰을 재화 도메인에 멱등 요청.
      try {
        currency.grantUsageTokens(key, outcome.result.rewardTokens, '사용량 보상');
      } catch (error) {
        state.pendingUsageGrants.set(key, outcome.result.rewardTokens);
        outcome.currencyError = error instanceof Error ? error.message : String(error);
      }

      // 6단계: `usage.aggregated` 발행.
      //
      // 이벤트 ID를 시각이 아니라 멱등 키에서 만든다. 기획서 9.1은 `eventId`가 재전송해도
      // 바뀌지 않아야 한다고 정하는데, 시각 기반 ID는 같은 밀리초에 두 번 집계하면
      // 충돌하고 재전송 시에는 달라진다. 멱등 키는 증가분 하나를 유일하게 가리킨다.
      events.push(
        domainEvent(eventId(`usage:${key}`), now, {
          eventType: 'usage.aggregated',
          aggregationId: key,
          provider,
          observedDelta: outcome.result.observedDelta,
          observedTotal: totalObserved(state),
          activityMinuteAdded: false,
        }),
      );
    }

    outcomes.push(outcome);
  }

  // 4단계의 활동 분. 소스별로 세지 않고 **집계 묶음당 한 번**만 판단하는 것이 핵심이다.
  //
  // 기획서 8.6: "같은 분에 여러 소스가 증가해도 활동 분은 하나다." 활동 분이 집합이므로
  // 여기서 여러 번 넣어도 결과는 같지만, 의도를 코드에 드러내기 위해 한 번만 넣는다.
  const anyGrowth = outcomes.some(
    (outcome) => outcome.result.kind === 'applied' && outcome.result.observedDelta > 0,
  );
  let activityMinuteAdded = false;
  if (anyGrowth) {
    const minute = localMinuteOf(now);
    activityMinuteAdded = !state.activityMinutes.has(minute);
    state.activityMinutes.add(minute);
  }

  // 발행하는 이벤트에 활동 분 적립 여부를 채운다.
  for (const event of events) {
    if (event.payload.eventType === 'usage.aggregated') {
      event.payload.activityMinuteAdded = activityMinuteAdded;
    }
  }

  return { outcomes, activityMinuteAdded, events };
}

function totalObserved(state: MetaState): number {
  let total = 0;
  for (const counts of state.usageDaily.values()) total += observed(counts);
  return total;
}

function runSingleSource(
  state: MetaState,
  collector: UsageCollector,
  provider: Provider,
  now: Date,
): SourceOutcome {
  const source = sourceOf(state, provider);
  const timestamp = now.toISOString();

  // 기획서 8.4: 꺼진 소스는 자동·수동 집계를 실행하지 않는다.
  if (!source.enabled) {
    source.status = 'paused';
    return {
      provider,
      result: { kind: 'skipped' },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  // 1단계: 수집기 실행과 검증.
  let snapshot;
  try {
    snapshot = collector.collect(provider);
  } catch (error) {
    // 기획서 8.8·11.1: 마지막 정상 데이터와 기준점을 유지한다.
    const collectError =
      error instanceof CollectError ? error : new CollectError('execution_failed');
    source.status = collectError.kind === 'not_found' ? 'not_found' : 'error';
    source.lastError = collectError.userMessage();
    return {
      provider,
      result: { kind: 'failed', error: collectError },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  const currentTotal = snapshotTotal(snapshot);
  const baseline = source.baseline;

  if (baseline === undefined) {
    // 기획서 8.2: 첫 정상 스캔은 기준점만 저장한다. 이 스캔의 값은 정보, 코인,
    // 활동 시간, 업적에 반영하지 않는다.
    source.baseline = { rows: snapshot.rows, totalObserved: currentTotal, capturedAt: timestamp };
    source.status = 'connected';
    source.lastSuccessAt = timestamp;
    source.lastError = undefined;
    source.everConnected = true;
    return {
      provider,
      result: { kind: 'baseline_captured' },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  // 기획서 8.8: 누적값이 기준점보다 작아진 소스는 `source_rebased`로 표시하고
  // 현재 값을 새 기준점으로 삼는다. 저장된 통계는 건드리지 않는다.
  if (currentTotal < baseline.totalObserved) {
    source.baseline = { rows: snapshot.rows, totalObserved: currentTotal, capturedAt: timestamp };
    source.status = 'error';
    source.lastError = '기록이 줄어들어 기준점을 다시 잡았어요';
    source.lastSuccessAt = timestamp;
    return {
      provider,
      result: { kind: 'rebased' },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  // 3단계: 중복 키 검사. 누적 총합은 단조 증가하므로 `(이전 총합 → 현재 총합)` 전이가
  // 증가분을 유일하게 식별한다.
  const dedupeKey = dedupeKeyOf(provider, baseline.totalObserved, currentTotal);

  if (currentTotal === baseline.totalObserved) {
    source.status = 'connected';
    source.lastSuccessAt = timestamp;
    source.lastError = undefined;
    return {
      provider,
      result: { kind: 'no_change' },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  if (state.processedDeltas.has(dedupeKey)) {
    source.status = 'connected';
    source.lastSuccessAt = timestamp;
    return {
      provider,
      result: { kind: 'duplicate' },
      appliedDedupeKey: undefined,
      currencyError: undefined,
    };
  }

  // 2단계: 행별 증가분 계산.
  const delta = computeDelta(snapshot.rows, baseline.rows);

  // 4단계: 사용량 저장.
  let observedDelta = 0;
  let reward = 0;
  for (const [key, counts] of delta) {
    observedDelta += observed(counts);
    reward += rewardTokens(counts);
    const { date, rawModel } = splitRowKey(key);
    const target = usageKey(provider, date, rawModel);
    const existing = state.usageDaily.get(target);
    state.usageDaily.set(target, existing ? addTokens(existing, counts) : counts);
  }

  state.processedDeltas.add(dedupeKey);

  // 7단계: 기준점과 마지막 성공 시각 갱신.
  source.baseline = { rows: snapshot.rows, totalObserved: currentTotal, capturedAt: timestamp };
  source.status = 'connected';
  source.lastSuccessAt = timestamp;
  source.lastError = undefined;
  source.everConnected = true;

  return {
    provider,
    result: { kind: 'applied', observedDelta, rewardTokens: reward },
    appliedDedupeKey: dedupeKey,
    currencyError: undefined,
  };
}

/** 행별 증가분. 감소한 행은 0으로 잘라 저장 통계가 줄어들지 않게 한다(COLLECT-009). */
function computeDelta(current: SnapshotRows, baseline: SnapshotRows): SnapshotRows {
  const delta: SnapshotRows = new Map();
  for (const [key, counts] of current) {
    const previous = baseline.get(key);
    const difference = previous ? subtractTokens(counts, previous) : counts;
    if (!isZero(difference)) delta.set(key, difference);
  }
  return delta;
}

/** 지난 집계에서 실패한 재화 지급을 재시도한다. */
function retryPendingGrants(state: MetaState, currency: CurrencyPort): void {
  if (state.pendingUsageGrants.size === 0) return;
  for (const [key, tokens] of [...state.pendingUsageGrants]) {
    try {
      currency.grantUsageTokens(key, tokens, '사용량 보상 재시도');
      state.pendingUsageGrants.delete(key);
    } catch {
      // 다음 집계에서 다시 시도한다.
    }
  }
}

/** 소스 토글. 기획서 8.4의 비활성 기간 규칙이 여기 한 곳에 있다. */
export function setSourceEnabled(
  state: MetaState,
  clock: Clock,
  provider: Provider,
  enabled: boolean,
): void {
  const source = sourceOf(state, provider);
  const timestamp = clock.now().toISOString();

  if (enabled) {
    source.enabled = true;
    source.disabledAt = undefined;
    source.status = 'scanning';
    // 다시 켤 때 현재 상태를 새 기준점으로 잡으므로 비활성 기간의 기록은 영구 제외된다.
    // 기준점을 비우면 다음 집계가 곧바로 새 기준점을 만든다.
    //
    // 이미 집계한 과거 데이터(`usageDaily`)는 손대지 않는다 — 기획서 8.4의
    // "과거에 이미 집계한 값은 유지한다".
    source.baseline = undefined;
  } else {
    source.enabled = false;
    source.disabledAt = timestamp;
    source.status = 'paused';
  }
}
