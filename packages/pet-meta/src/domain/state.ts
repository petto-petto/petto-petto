/**
 * meta 도메인의 전체 상태. 기획서 10장의 논리 모델 10종을 타입으로 옮긴 것이다.
 *
 * 조회에 맞춘 런타임 표현이다. 저장 형식은 `persistence/`가 따로 갖는다 — 그 이유는
 * 그쪽 문서에 있다.
 */

import {
  PROVIDERS,
  dateOfMinute,
  type LocalDate,
  type LocalMinute,
  type Provider,
} from '@pet/core';
import { type EventId, type DomainEvent } from '../events/index.ts';

import {
  applyEvent,
  buildFactSnapshot,
  createEventFacts,
  type EventFacts,
  type FactSnapshot,
  type UsageFacts,
} from './achievement/facts.ts';
import type { AchievementProgress, RewardRecord } from './achievement/progress.ts';
import { createProfile, type UserProfile } from './profile/index.ts';
import { defaultSettings, type MetaSettings } from './settings/index.ts';
import type { SnapshotRows } from './usage/collector.ts';
import { observed, type TokenCounts } from './usage/tokens.ts';

/**
 * 사용량 집계 행의 키: `<provider>|<날짜>|<원본 모델명>`.
 *
 * 기획서 5.2: 모델 행의 식별 기준은 `(도구, 원본 모델명)`이다. 문자열 키를 쓰는 이유는
 * JavaScript의 `Map`이 객체 키를 **참조**로 비교하기 때문이다. 튜플을 키로 쓰면 같은
 * 값이어도 다른 항목이 된다.
 */
export type UsageKey = string;

export const usageKey = (provider: Provider, date: LocalDate, rawModel: string): UsageKey =>
  `${provider}|${date}|${rawModel}`;

export function splitUsageKey(key: UsageKey): {
  provider: Provider;
  date: LocalDate;
  rawModel: string;
} {
  const first = key.indexOf('|');
  const second = key.indexOf('|', first + 1);
  return {
    provider: key.slice(0, first) as Provider,
    date: key.slice(first + 1, second) as LocalDate,
    // 모델명에 `|`가 들어 있어도 잘리지 않도록 앞의 두 구분자만 쓴다.
    rawModel: key.slice(second + 1),
  };
}

/** 소스 카드의 내부 상태. 기획서 6.1 표를 그대로 옮긴다. */
export type SourceStatus = 'connected' | 'not_found' | 'paused' | 'scanning' | 'error';

const STATUS_NAMES: Record<SourceStatus, string> = {
  connected: '수집 중',
  not_found: '기록을 찾을 수 없음',
  paused: '수집 중지',
  scanning: '확인 중',
  error: '집계 오류',
};

/** 기획서 6.1의 "사용자 표시" 열. */
export const sourceStatusName = (status: SourceStatus): string => STATUS_NAMES[status];

/**
 * 소스별 기준점(기획서 8.2).
 *
 * 누적 스냅샷을 통째로 보관한다. 총합만 저장하면 "어제 행이 늘었는지 오늘 행이 늘었는지"를
 * 구분할 수 없어 날짜별 통계를 만들 수 없다.
 */
export interface Baseline {
  rows: SnapshotRows;
  totalObserved: number;
  /** ISO 8601. */
  capturedAt: string;
}

/** 기획서 10장의 `collector_source_state`. */
export interface SourceState {
  provider: Provider;
  enabled: boolean;
  status: SourceStatus;
  baseline: Baseline | undefined;
  disabledAt: string | undefined;
  lastSuccessAt: string | undefined;
  lastError: string | undefined;
  /**
   * 이 소스가 한 번이라도 정상 감지된 적이 있는가.
   *
   * `baseline`과 따로 두는 이유: 소스를 껐다 켜면 기준점을 새로 잡아야 하므로
   * `baseline`이 비워진다(기획서 8.4). 그때 최초 실행으로 오인되면 안 되므로,
   * "최초 실행인가"의 판단은 이 값으로 한다.
   */
  everConnected: boolean;
}

export function createSourceState(provider: Provider): SourceState {
  return {
    provider,
    // 기획서 6.1: 자동 감지된 도구는 기본 활성화한다.
    enabled: true,
    status: 'scanning',
    baseline: undefined,
    disabledAt: undefined,
    lastSuccessAt: undefined,
    lastError: undefined,
    everConnected: false,
  };
}

/** meta 도메인 상태 전체. */
export interface MetaState {
  sources: Map<Provider, SourceState>;
  /** 기획서 10장의 `usage_daily`. 설치 이후 증가분만 쌓인다. */
  usageDaily: Map<UsageKey, TokenCounts>;
  /**
   * 기획서 10장의 `activity_minute`.
   *
   * `Set<LocalMinute>`인 것이 규칙 그 자체다. 로컬 분이 문자열이라 값 기준으로 중복이
   * 제거되고, 같은 분을 몇 번 넣어도 크기가 변하지 않는다. "같은 로컬 분에 세 소스가
   * 증가해도 활동 시간은 1분"(COLLECT-007)이 자료구조로 보장된다.
   */
  activityMinutes: Set<LocalMinute>;
  /** 기획서 10장의 `processed_source_delta`. 수집 멱등성 키. */
  processedDeltas: Set<string>;
  /**
   * 재화 도메인에 요청했지만 실패해 재시도해야 하는 보상 대상 토큰.
   *
   * 기획서 8.3은 4~7단계가 "중간 실패 후 재실행해도 동일 증가분을 두 번 반영하지
   * 않아야" 한다고 정한다. 기준점은 이미 전진했으므로 실패한 지급을 다시 계산할 수는
   * 없다. 그래서 멱등 키와 함께 남겨 두고 다음 집계에서 재시도한다.
   */
  pendingUsageGrants: Map<string, number>;
  /** 기획서 9.3: 같은 `eventId`는 한 번만 반영한다. */
  processedEvents: Set<EventId>;
  eventFacts: EventFacts;
  progress: Map<string, AchievementProgress>;
  rewards: Map<string, RewardRecord[]>;
  profile: UserProfile;
  settings: MetaSettings;
}

/** 새 설치 상태를 만든다. */
export function createMetaState(): MetaState {
  const sources = new Map<Provider, SourceState>();
  for (const provider of PROVIDERS) sources.set(provider, createSourceState(provider));

  return {
    sources,
    usageDaily: new Map(),
    activityMinutes: new Set(),
    processedDeltas: new Set(),
    pendingUsageGrants: new Map(),
    processedEvents: new Set(),
    eventFacts: createEventFacts(),
    progress: new Map(),
    rewards: new Map(),
    profile: createProfile(),
    settings: defaultSettings(),
  };
}

/** 소스 상태를 꺼내온다. 세 소스는 생성 시점에 모두 만들어지므로 항상 존재한다. */
export function sourceOf(state: MetaState, provider: Provider): SourceState {
  const existing = state.sources.get(provider);
  if (existing) return existing;
  const created = createSourceState(provider);
  state.sources.set(provider, created);
  return created;
}

/**
 * 기획서 4.3·SET-001: 세 소스가 모두 발견되지 않은 상태인가.
 *
 * "한 번도 정상 감지된 소스가 없다"가 기준이다. 단순 수집 오류, 앱 재실행, 사용자가
 * 소스를 껐다 켜는 것은 모두 최초 실행이 아니다.
 */
export function needsFirstRunCollectTab(state: MetaState): boolean {
  return [...state.sources.values()].every((source) => !source.everConnected);
}

/** 설치 이후 누적 관측 토큰. */
export function observedTotal(state: MetaState): number {
  let total = 0;
  for (const counts of state.usageDaily.values()) total += observed(counts);
  return total;
}

/** 특정 로컬 날짜의 관측 토큰. */
export function observedOn(state: MetaState, date: LocalDate): number {
  let total = 0;
  for (const [key, counts] of state.usageDaily) {
    if (splitUsageKey(key).date === date) total += observed(counts);
  }
  return total;
}

/** 세 CLI가 모두 토큰을 발생시킨 로컬 날짜의 수. 히든 업적의 사실이다. */
function threeToolsDays(state: MetaState): number {
  const perDate = new Map<LocalDate, Set<Provider>>();
  for (const [key, counts] of state.usageDaily) {
    if (observed(counts) === 0) continue;
    const { provider, date } = splitUsageKey(key);
    const providers = perDate.get(date) ?? new Set<Provider>();
    providers.add(provider);
    perDate.set(date, providers);
  }
  let days = 0;
  for (const providers of perDate.values()) {
    if (providers.size === PROVIDERS.length) days += 1;
  }
  return days;
}

/** 사용량에서 파생하는 사실(기획서 9.4). */
export function usageFacts(state: MetaState): UsageFacts {
  return {
    observedTokens: observedTotal(state),
    activityMinutes: state.activityMinutes.size,
    threeToolsDays: threeToolsDays(state),
  };
}

/** 현재 판정에 쓸 사실 전체. */
export function factSnapshot(state: MetaState): FactSnapshot {
  return buildFactSnapshot(state.eventFacts, usageFacts(state));
}

/**
 * 다른 도메인의 이벤트를 받는다.
 *
 * 이미 본 `eventId`면 아무 일도 하지 않고 `false`를 돌려준다. 기획서 9.3의
 * "같은 `eventId`는 한 번만 반영한다"가 이 한 곳에서 지켜진다.
 */
export function recordEvent(state: MetaState, event: DomainEvent): boolean {
  if (state.processedEvents.has(event.eventId)) return false;
  state.processedEvents.add(event.eventId);
  applyEvent(state.eventFacts, event.payload);
  return true;
}

/** 활동 분이 속한 날짜. 통계에서 쓴다. */
export { dateOfMinute };
