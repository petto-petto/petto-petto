/**
 * 도메인 이벤트 봉투와 페이로드. 기획서 9.1·9.2를 그대로 옮긴다.
 *
 * 왜 이벤트인가: 업적 엔진은 다른 도메인의 내부 저장소를 읽지 않는다(기획서 9.3).
 * `meta`가 `battle`의 데이터를 들여다보면 두 도메인이 영원히 붙어버린다. 대신 각 도메인이
 * "무슨 일이 일어났다"만 발행하고, `meta`는 그것만 소비한다.
 */

import type { AcquireSource, BattleResult, Coin, PetId, Provider, Rarity, EventId } from './ids.ts';

/** 현재 이벤트 스키마 버전. 페이로드 모양이 바뀌면 올린다. */
export const SCHEMA_VERSION = 1;

export interface PetAcquired {
  eventType: 'pet.acquired';
  petId: PetId;
  rarity: Rarity;
  source: AcquireSource;
}

export interface FusionCompleted {
  eventType: 'fusion.completed';
  fusionId: string;
  parentRarities: readonly [Rarity, Rarity];
  resultPetId: PetId;
  resultRarity: Rarity;
}

export interface PetLevelup {
  eventType: 'pet.levelup';
  petId: PetId;
  previousLevel: number;
  level: number;
  maxLevel: number;
}

export interface PetEvolved {
  eventType: 'pet.evolved';
  petId: PetId;
  previousStage: number;
  stage: number;
}

export interface BattleFinished {
  eventType: 'battle.finished';
  battleId: string;
  result: BattleResult;
  enemyTier: number;
  streak: number;
}

export interface DexUpdated {
  eventType: 'dex.updated';
  ownedSpecies: number;
  totalSpecies: number;
}

export interface UsageAggregated {
  eventType: 'usage.aggregated';
  aggregationId: string;
  provider: Provider;
  /** 이번 집계에서 늘어난 관측 토큰. */
  observedDelta: number;
  /** 설치 이후 누적 관측 토큰. */
  observedTotal: number;
  /** 이번 집계가 활동 분을 새로 적립했는지. */
  activityMinuteAdded: boolean;
}

export interface CurrencyBalanceChanged {
  eventType: 'currency.balance_changed';
  ledgerEntryId: string;
  previousBalance: Coin;
  balance: Coin;
  reason: string;
}

/**
 * 기획서 9.2의 이벤트 8종.
 *
 * **판별 유니온**이다. Java 17의 `sealed interface` + `record`에 해당한다.
 * `eventType`으로 갈래가 구분되고, [`assertNever`]와 함께 쓰면 새 이벤트를 추가했을 때
 * 그것을 처리하지 않은 `switch`가 **타입 오류**로 드러난다. 조용히 빠뜨릴 수 없다.
 */
export type EventPayload =
  | PetAcquired
  | FusionCompleted
  | PetLevelup
  | PetEvolved
  | BattleFinished
  | DexUpdated
  | UsageAggregated
  | CurrencyBalanceChanged;

/** 공통 이벤트 봉투(기획서 9.1). */
export interface DomainEvent {
  /** 발행 도메인에서 안정적으로 생성하며 재전송해도 바뀌지 않는다. */
  eventId: EventId;
  /** 실제 도메인 상태가 영속화된 시각(ISO 8601). */
  occurredAt: string;
  schemaVersion: number;
  payload: EventPayload;
}

export function domainEvent(id: EventId, occurredAt: Date, payload: EventPayload): DomainEvent {
  return {
    eventId: id,
    occurredAt: occurredAt.toISOString(),
    schemaVersion: SCHEMA_VERSION,
    payload,
  };
}

/**
 * 유니온을 남김없이 다뤘는지 컴파일러에게 확인받는다.
 *
 * `switch`의 `default`에서 이것을 부르면, 처리하지 않은 갈래가 있을 때 인자 타입이
 * `never`가 아니게 되어 타입 오류가 난다. Java의 `sealed` `switch`가 주는 보장을
 * TypeScript에서 얻는 방법이다.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: 처리하지 않은 갈래 ${JSON.stringify(value)}`);
}
