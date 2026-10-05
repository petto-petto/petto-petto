import type { Provider } from '@pet/core';

export type { Provider } from '@pet/core';

/**
 * 한 번의 사용량 인입. 호출자가 증가분을 계산해서 넘긴다.
 *
 * `observed`와 `reward`를 **둘 다** 받는다. 표시용 합계와 보상 환산 대상이 서로 다른
 * 값이고(캐시 읽기 포함 여부), 어느 쪽을 쓸지는 읽는 쪽이 정하기 때문이다. 여기서 하나로
 * 합쳐 버리면 나중에 다른 쪽을 복원할 수 없다.
 */
export interface UsageEntry {
  provider: Provider;
  /** 관측 토큰. 입력 + 출력 + 캐시 생성 + 캐시 읽기. */
  observed: number;
  /** 보상 대상 토큰. 재화 환산의 입력값이다. */
  reward: number;
  /**
   * 같은 인입을 두 번 쌓지 않기 위한 키. 호출자가 만든다.
   *
   * 무엇이 유일한지는 인입 경로만 안다 — hook이면 세션·메시지 식별자, 주기 집계면
   * 증가분 전이다. 중복 판정은 `UNIQUE` 제약이 하므로, 호출 전에 조회해서 거를 필요가 없다.
   *
   * 앞뒤 공백은 제거하고 저장한다. 공백만 있는 키는 거부한다.
   */
  dedupeKey: string;
  /** ISO 8601. */
  occurredAt: string;
}

/** AI 도구 하나의 누적. 한 번도 기록이 없는 도구는 목록에 나타나지 않는다. */
export interface ProviderTokenStats {
  provider: Provider;
  observed: number;
  reward: number;
  /**
   * 지금까지 받은 `occurredAt` 중 가장 최신. 기록이 없으면 null.
   *
   * 늦게 도착한 과거 인입이 이 값을 되돌리지 않는다. 재시도나 배치 전송으로 과거
   * 타임스탬프가 뒤늦게 들어와도 "마지막 기록 시각"이 과거로 가면 안 되기 때문이다.
   */
  updatedAt: string | null;
}

export interface TokenTotals {
  observed: number;
  reward: number;
}

/** 적재 내역 한 줄. 저장 형식이므로 `entryId`는 숫자다. */
export interface TokenHistoryEntry {
  entryId: number;
  provider: Provider;
  observed: number;
  reward: number;
  dedupeKey: string;
  occurredAt: string;
}

/**
 * 토큰 사용량과 소비 가능한 재화의 공통 API. SQLite/Electron에 의존하지 않는다.
 * 사용량 통계는 누적 사실로 남고, 소비는 별도 재화 원장의 잔액만 줄인다.
 *
 * 현재 구현은 동기식이다. 저장·조회 실패와 잘못된 입력은 예외를 던진다.
 */
export interface TokenClient {
  /**
   * 사용량을 적재한다. 통계와 내역이 함께 갱신되며, 둘은 언제나 같은 값을 가리킨다.
   *
   * 이미 기록한 `dedupeKey`면 아무것도 바꾸지 않고 `false`. 같은 인입이 두 번 도착해도
   * 사용량이 두 배가 되지 않는다.
   */
  recordUsage(entry: UsageEntry): boolean;

  /** 도구별 누적. `provider` 오름차순. 기록이 없으면 []. */
  statsByProvider(): ProviderTokenStats[];

  /** 전체 누적. 기록이 없으면 둘 다 0. */
  totals(): TokenTotals;

  /** 최근 적재 내역. `entryId` 내림차순이라 같은 시각의 항목도 순서가 정해진다. */
  recentHistory(limit: number): TokenHistoryEntry[];

  /** 현재 사용할 수 있는 재화 잔액. 조회 실패는 예외다. */
  balance(): number;
  /**
   * `since`(ISO 8601, UTC) 이후에 **지급된** 재화의 합. 소비는 세지 않는다. 지급이 없으면 0.
   *
   * 기준 시각은 호출자가 정한다 — "오늘"이 어느 시간대의 자정인지는 화면이 안다. 정각에 지급된
   * 것은 포함한다. 빈 문자열은 거부한다. 그대로 받으면 전체 합이 "오늘 얻은 양"으로 보인다.
   */
  earnedSince(since: string): number;
  /** 같은 키의 지급은 한 번만 기록한다. 새로 지급했으면 true. */
  grantOnce(key: string, amount: number, reason: string): boolean;
  /** 잔액이 부족하면 기록하지 않고 false. 성공하면 true. */
  spend(amount: number, reason: string): boolean;
  /** 같은 요청 키를 재전송해도 추가 차감하지 않는다. */
  spendOnce(
    requestKey: string,
    amount: number,
    reason: string,
  ): 'spent' | 'already_spent' | 'insufficient';
}
