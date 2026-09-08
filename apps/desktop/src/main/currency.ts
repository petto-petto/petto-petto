/**
 * SQLite 원장 → `@pet/meta`의 `CurrencyPort` 어댑터.
 *
 * ## 왜 앱에 있는가
 *
 * 재화 도메인은 아직 주인이 없다. `packages/` 어디에도 구현이 없어서 그동안 meta가
 * 테스트 대역(`InMemoryCurrency`)을 프로덕션에서 쓰고 있었고, **인메모리라 앱을 끌 때마다
 * 잔액이 0으로 돌아갔다.** meta는 멱등 키를 자기 스냅샷에 저장하므로 "이미 줬다"고 기억한
 * 채였고, 그래서 다시 지급하지도 않았다 — 코인이 영구히 사라지는 상태였다.
 *
 * 재화 담당이 정해지면 이 파일의 정책(환산 비율)은 그 패키지로 가고, 여기는
 * `RoomCollectionPort`처럼 모양만 바꾸는 어댑터로 남는다.
 */

import type { Clock } from '@pet/core';
import type { CurrencyPort, CurrencyTotals, GrantOutcome, LedgerEntry } from '@pet/meta';
import { PortError } from '@pet/meta';

import { CurrencyRepository } from './persistence/repositories/currency-repository.ts';

/**
 * 토큰 → 코인 환산 비율.
 *
 * 재화 도메인의 정책이다. meta는 보상 대상 토큰만 넘기고 이 값을 모른다 — 비율이 바뀌어도
 * meta는 손대지 않는다.
 */
const TOKENS_PER_COIN = 10_000;

export class SqliteCurrencyPort implements CurrencyPort {
  readonly #repository: CurrencyRepository;
  readonly #clock: Clock;

  constructor(repository: CurrencyRepository, clock: Clock) {
    this.#repository = repository;
    this.#clock = clock;
  }

  /**
   * 조회 실패를 `PortError`로 바꾼다.
   *
   * 던지는 것이 계약이다. `0`을 돌려주면 화면이 "기록이 없음"과 "읽지 못함"을 구분할 수
   * 없고, meta의 블록별 오류 표시가 작동하지 않는다.
   */
  #read<T>(work: () => T, message: string): T {
    try {
      return work();
    } catch (error) {
      throw new PortError(`${message} (${String(error)})`);
    }
  }

  grantOnce(rewardKey: string, amount: number, reason: string): GrantOutcome {
    const inserted = this.#repository.recordGrant(
      rewardKey,
      amount,
      reason,
      this.#clock.now().toISOString(),
    );
    return inserted ? { kind: 'granted', amount } : { kind: 'already_granted' };
  }

  grantUsageTokens(dedupeKey: string, rewardTokens: number, reason: string): GrantOutcome {
    const amount = Math.floor(rewardTokens / TOKENS_PER_COIN);
    const inserted = this.#repository.recordGrant(
      dedupeKey,
      amount,
      reason,
      this.#clock.now().toISOString(),
    );
    return inserted ? { kind: 'granted', amount } : { kind: 'already_granted' };
  }

  balance(): number {
    return this.#read(() => this.#repository.balance(), '잔액을 불러오지 못했어요');
  }

  recentLedger(limit: number): LedgerEntry[] {
    return this.#read(
      () =>
        this.#repository.recent(limit).map((row) => ({
          entryId: String(row.entryId),
          reason: row.reason,
          occurredAt: row.occurredAt,
          delta: row.delta,
        })),
      '원장을 불러오지 못했어요',
    );
  }

  totals(): CurrencyTotals {
    return this.#read(() => this.#repository.totals(), '누적 재화를 불러오지 못했어요');
  }
}
