/**
 * 로컬 저장. 서버도 DB 서버도 두지 않고 사용자 기기의 파일 하나에 담는다.
 *
 * ## 왜 `MetaState`를 그대로 저장하지 않는가
 *
 * 저장 형식과 런타임 표현을 분리한다. Java로 치면 엔티티와 DTO를 나누는 것과 같다.
 *
 * - `MetaState`는 **빠른 조회**에 맞춰져 있다. `Map`과 `Set`을 쓴다.
 * - 그런데 `JSON.stringify(new Map())`은 `{}`를 준다. `Map`과 `Set`은 JSON에 그대로
 *   실리지 않는다. 배열로 펴 주는 계층이 반드시 필요하다.
 * - `MetaSnapshot`은 그 배열 형식이고, 각 항목이 자기 키를 필드로 들고 있어 파일만
 *   열어 봐도 내용을 읽을 수 있다.
 *
 * 분리해 두면 나중에 런타임 자료구조를 바꿔도 저장 파일이 깨지지 않는다. 반대로 저장
 * 형식을 바꿔야 할 때는 `SNAPSHOT_SCHEMA_VERSION`을 올리고 변환을 한곳에서 처리한다.
 *
 * ## 무엇이 저장되고 무엇이 저장되지 않는가
 *
 * 기획서가 "재실행 후에도 유지"를 요구하는 것만 담는다.
 *
 * | 저장한다 | 근거 |
 * |---|---|
 * | 소스별 기준점·상태 | 8.2 "재스캔과 앱 재실행은 정상 기준점을 과거로 되돌리지 않는다" |
 * | 사용량·활동 분 | 5.2, 8.6 |
 * | 수집 멱등 키 | 8.3 "중간 실패 후 재실행해도 두 번 반영하지 않는다" |
 * | 업적 사실·진행률·보상 | 9.4 "영속적으로 투영한다", ACH-004 소급 판정 |
 * | 조련사 이름·칭호 | 5.1 "생성 결과는 저장하며 실행할 때마다 바꾸지 않는다" |
 * | 설정 | SET-007 "오버레이 숨김 상태가 재실행 후 유지" |
 *
 * 반대로 **업적 카테고리 필터**는 저장하지 않는다. 기획서 4.2가 "현재 실행 중에만
 * 기억하고 앱을 다시 시작하면 `전체`로 돌아간다"고 정하므로 애초에 `MetaState` 밖에 있다.
 */

import { PROVIDERS, type LocalDate, type LocalMinute, type Provider } from '@pet/core';
import { type EventId } from '../events/index.ts';

import type { EventFacts } from '../domain/achievement/facts.ts';
import type { AchievementProgress, RewardRecord } from '../domain/achievement/progress.ts';
import type { UserProfile } from '../domain/profile/index.ts';
import type { MetaSettings } from '../domain/settings/index.ts';
import { rowKey, splitRowKey, type SnapshotRows } from '../domain/usage/collector.ts';
import type { TokenCounts } from '../domain/usage/tokens.ts';
import {
  createMetaState,
  createSourceState,
  splitUsageKey,
  usageKey,
  type MetaState,
  type SourceState,
  type SourceStatus,
} from '../domain/state.ts';

/**
 * 저장 형식의 버전.
 *
 * 처음부터 넣는다. 나중에 넣으면 "버전 없는 파일"을 위한 특수 처리가 영구히 남는다.
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/** 사용량 한 줄. 맵의 합성 키를 필드로 펴 놓은 것이다. */
export interface UsageRow {
  provider: Provider;
  date: LocalDate;
  rawModel: string;
  counts: TokenCounts;
}

/** 기준점 스냅샷의 한 줄. 소스가 이미 정해져 있으므로 `provider`가 없다. */
export interface BaselineRow {
  date: LocalDate;
  rawModel: string;
  counts: TokenCounts;
}

export interface BaselineSnapshot {
  rows: BaselineRow[];
  totalObserved: number;
  capturedAt: string;
}

export interface SourceSnapshotRow {
  provider: Provider;
  enabled: boolean;
  status: SourceStatus;
  baseline: BaselineSnapshot | null;
  disabledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  everConnected: boolean;
}

export interface PendingGrant {
  dedupeKey: string;
  rewardTokens: number;
}

/**
 * 저장 형식의 프로필.
 *
 * 도메인의 `UserProfile`을 그대로 쓰지 않는 이유: 그쪽은 "없음"을 `undefined`로 표현하는데
 * **JSON에는 `undefined`가 없다.** `JSON.stringify`는 그런 프로퍼티를 통째로 지워 버려서,
 * 저장하고 읽으면 키 자체가 사라진다. 저장 형식은 "없음"을 `null`로 명시한다.
 */
export interface ProfileSnapshot {
  equippedTitle: string | null;
  ownedTitles: string[];
}

/**
 * 저장 형식의 업적 진행률. 위와 같은 이유로 `unlockedAt`이 `null`이다.
 */
export interface ProgressSnapshot {
  achievementId: string;
  progress: number;
  unlockedAt: string | null;
}

/** 저장 형식의 보상 기록. 위와 같은 이유로 선택 필드가 `null`이다. */
export interface RewardSnapshot {
  achievementId: string;
  rewardKey: string;
  kind: RewardRecord['kind'];
  status: RewardRecord['status'];
  attempts: number;
  lastError: string | null;
  detail: string | null;
}

/** 파일에 담기는 전체 상태. */
export interface MetaSnapshot {
  schemaVersion: number;
  sources: SourceSnapshotRow[];
  usageDaily: UsageRow[];
  activityMinutes: LocalMinute[];
  processedDeltas: string[];
  pendingUsageGrants: PendingGrant[];
  processedEvents: EventId[];
  eventFacts: EventFacts;
  progress: ProgressSnapshot[];
  rewards: RewardSnapshot[];
  profile: ProfileSnapshot;
  settings: MetaSettings;
}

/** 런타임 상태를 저장 형식으로 편다. */
export function snapshotOf(state: MetaState): MetaSnapshot {
  const usageDaily: UsageRow[] = [];
  for (const [key, counts] of state.usageDaily) {
    const { provider, date, rawModel } = splitUsageKey(key);
    usageDaily.push({ provider, date, rawModel, counts });
  }

  const sources: SourceSnapshotRow[] = [];
  for (const source of state.sources.values()) {
    const baselineRows: BaselineRow[] = [];
    if (source.baseline) {
      for (const [key, counts] of source.baseline.rows) {
        const { date, rawModel } = splitRowKey(key);
        baselineRows.push({ date, rawModel, counts });
      }
    }
    sources.push({
      provider: source.provider,
      enabled: source.enabled,
      status: source.status,
      baseline: source.baseline
        ? {
            rows: baselineRows,
            totalObserved: source.baseline.totalObserved,
            capturedAt: source.baseline.capturedAt,
          }
        : null,
      disabledAt: source.disabledAt ?? null,
      lastSuccessAt: source.lastSuccessAt ?? null,
      lastError: source.lastError ?? null,
      everConnected: source.everConnected,
    });
  }

  const rewards: RewardSnapshot[] = [];
  for (const records of state.rewards.values()) {
    for (const record of records) {
      rewards.push({
        achievementId: record.achievementId,
        rewardKey: record.rewardKey,
        kind: record.kind,
        status: record.status,
        attempts: record.attempts,
        lastError: record.lastError ?? null,
        detail: record.detail ?? null,
      });
    }
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sources,
    usageDaily,
    activityMinutes: [...state.activityMinutes],
    processedDeltas: [...state.processedDeltas],
    pendingUsageGrants: [...state.pendingUsageGrants].map(([dedupeKey, tokens]) => ({
      dedupeKey,
      rewardTokens: tokens,
    })),
    processedEvents: [...state.processedEvents],
    eventFacts: { ...state.eventFacts },
    progress: [...state.progress.values()].map((entry) => ({
      achievementId: entry.achievementId,
      progress: entry.progress,
      unlockedAt: entry.unlockedAt ?? null,
    })),
    // 보상 기록은 자기 `achievementId`를 들고 있으므로 펴서 담고 읽을 때 다시 묶는다.
    rewards,
    profile: {
      equippedTitle: state.profile.equippedTitle ?? null,
      ownedTitles: [...state.profile.ownedTitles],
    },
    settings: { ...state.settings },
  };
}

export class SnapshotError extends Error {
  override readonly name = 'SnapshotError';
  readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.userMessage = userMessage;
  }
}

/**
 * 옛 버전 파일을 현재 형식으로 올린다.
 *
 * 단계별 변환을 여기 한곳에 모은다. 호출부에 흩어지면 "어느 버전에서 무엇이 바뀌었나"를
 * 다시 추적할 수 없게 된다.
 */
export function migrateSnapshot(snapshot: MetaSnapshot): MetaSnapshot {
  if (snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION) return snapshot;

  /*
   * v1 → v2: 조련사 이름을 없앴다.
   *
   * 남아 있는 `profile.displayName`은 지우지 않고 그냥 읽지 않는다. 삭제하려면 저장
   * 형식마다 대응하는 제거 코드가 영구히 쌓이고, 읽지 않는 키는 다음 저장에서 저절로
   * 사라진다.
   */
  if (snapshot.schemaVersion === 1) return { ...snapshot, schemaVersion: 2 };

  throw new SnapshotError(
    `지원하지 않는 저장 형식 버전 ${snapshot.schemaVersion}`,
    snapshot.schemaVersion > SNAPSHOT_SCHEMA_VERSION
      ? '저장 파일이 이 버전보다 새롭습니다'
      : '저장 파일 형식이 너무 오래되어 읽을 수 없습니다',
  );
}

/** 저장 형식을 런타임 상태로 되돌린다. */
export function stateOf(snapshot: MetaSnapshot): MetaState {
  const state = createMetaState();

  const sources = new Map<Provider, SourceState>();
  for (const row of snapshot.sources) {
    const baselineRows: SnapshotRows = new Map();
    if (row.baseline) {
      for (const entry of row.baseline.rows) {
        baselineRows.set(rowKey(entry.date, entry.rawModel), entry.counts);
      }
    }
    sources.set(row.provider, {
      provider: row.provider,
      enabled: row.enabled,
      status: row.status,
      baseline: row.baseline
        ? {
            rows: baselineRows,
            totalObserved: row.baseline.totalObserved,
            capturedAt: row.baseline.capturedAt,
          }
        : undefined,
      disabledAt: row.disabledAt ?? undefined,
      lastSuccessAt: row.lastSuccessAt ?? undefined,
      lastError: row.lastError ?? undefined,
      everConnected: row.everConnected,
    });
  }
  // 파일에 없던 소스는 기본값으로 채운다. 나중에 지원 소스가 늘어도 옛 파일이 열린다.
  for (const provider of PROVIDERS) {
    if (!sources.has(provider)) sources.set(provider, createSourceState(provider));
  }
  state.sources = sources;

  state.usageDaily = new Map(
    snapshot.usageDaily.map((row) => [usageKey(row.provider, row.date, row.rawModel), row.counts]),
  );
  state.activityMinutes = new Set(snapshot.activityMinutes);
  state.processedDeltas = new Set(snapshot.processedDeltas);
  state.pendingUsageGrants = new Map(
    snapshot.pendingUsageGrants.map((grant) => [grant.dedupeKey, grant.rewardTokens]),
  );
  state.processedEvents = new Set(snapshot.processedEvents);
  state.eventFacts = { ...snapshot.eventFacts };
  state.progress = new Map(
    snapshot.progress.map((entry): [string, AchievementProgress] => [
      entry.achievementId,
      {
        achievementId: entry.achievementId,
        progress: entry.progress,
        unlockedAt: entry.unlockedAt ?? undefined,
      },
    ]),
  );

  const rewards = new Map<string, RewardRecord[]>();
  for (const record of snapshot.rewards) {
    const list = rewards.get(record.achievementId) ?? [];
    list.push({
      achievementId: record.achievementId,
      rewardKey: record.rewardKey,
      kind: record.kind,
      status: record.status,
      attempts: record.attempts,
      lastError: record.lastError ?? undefined,
      detail: record.detail ?? undefined,
    });
    rewards.set(record.achievementId, list);
  }
  state.rewards = rewards;
  state.profile = {
    equippedTitle: snapshot.profile.equippedTitle ?? undefined,
    ownedTitles: [...snapshot.profile.ownedTitles],
  };
  state.settings = { ...snapshot.settings };

  return state;
}

/**
 * `meta`가 저장에 대해 요구하는 것.
 *
 * 어디에 어떤 형식으로 쓰는지는 구현이 정한다. 도메인은 "저장한다 / 읽어 온다"만 안다.
 * 그래서 파일에서 SQLite로 바꿔도 이 패키지는 손대지 않고, 테스트는 인메모리 구현을 쓴다.
 */
export interface MetaStore {
  /** 저장된 것이 없으면 `undefined`. 새 설치가 오류가 아니기 때문이다. */
  load(): MetaSnapshot | undefined;
  /** 저장은 **원자적이어야 한다.** 도중에 앱이 죽어도 반쪽짜리 파일이 남으면 안 된다. */
  save(snapshot: MetaSnapshot): void;
}

/** 저장된 상태를 읽는다. 없으면 `undefined`. */
export function loadState(store: MetaStore): MetaState | undefined {
  const snapshot = store.load();
  if (!snapshot) return undefined;
  return stateOf(migrateSnapshot(snapshot));
}

/** 현재 상태를 저장한다. */
export function saveState(store: MetaStore, state: MetaState): void {
  store.save(snapshotOf(state));
}
