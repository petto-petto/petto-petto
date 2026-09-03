/**
 * `meta`가 다른 도메인과 인프라에 요구하는 인터페이스.
 *
 * ## 왜 공용 커널이 아니라 여기인가
 *
 * 이 인터페이스들은 "재화 도메인이 제공하는 API"가 아니라 **"meta가 화면을 그리려면
 * 무엇이 필요한가"**의 목록이다. 소유자는 필요로 하는 쪽, 즉 `meta`다.
 *
 * 공용 커널에 두면 다섯 도메인의 요구가 한 파일에 쌓여 커널이 쓰레기통이 되고,
 * `meta`가 자기 화면 사정으로 인터페이스를 고칠 때마다 무관한 도메인이 전부 영향받는다.
 *
 * ## 실제 도메인이 완성되면
 *
 * `@pet/currency` 같은 진짜 패키지는 **이 인터페이스를 알지 못한다.** 자기 도메인 언어로
 * 자기 API를 갖는다. 둘을 잇는 것은 앱이 쓰는 어댑터다.
 *
 * ```text
 * @pet/meta ──requires──▶ CurrencyPort ◀──implements── 어댑터 ──uses──▶ @pet/currency
 * ```
 *
 * ## 실패는 던진다
 *
 * 포트는 실패를 `PortError`로 **던진다**. TypeScript에서는 그것이 관용이고, 화면은
 * 블록마다 `try`로 감싸 자기 자리에만 오류를 표시한다(기획서 11.1, INFO-007).
 * 그 변환을 하는 곳이 `view/` 계층이다.
 */

import type { Coin, PetId, Rarity } from '@pet/core';

/** 지급 결과. 이미 지급된 키였는지 구분해야 멱등성을 관찰할 수 있다. */
export type GrantOutcome = { kind: 'granted'; amount: Coin } | { kind: 'already_granted' };

export interface LedgerEntry {
  entryId: string;
  reason: string;
  /** ISO 8601. */
  occurredAt: string;
  delta: Coin;
}

export interface CurrencyTotals {
  earned: Coin;
  spent: Coin;
  balance: Coin;
}

/** 재화에 대해 `meta`가 필요로 하는 것(기획서 9.5). */
export interface CurrencyPort {
  /**
   * 같은 `rewardKey`로 두 번 불러도 한 번만 지급한다.
   * 업적 보상의 멱등 키는 `achievement:<achievementId>`다.
   */
  grantOnce(rewardKey: string, amount: Coin, reason: string): GrantOutcome;

  /**
   * 토큰 → 코인 환산은 **재화 도메인의 정책**이다. `meta`는 보상 대상 토큰만 넘기고
   * 환산 비율을 모른다. 기획서 8.5가 관측 토큰과 보상 대상 토큰을 분리하라고 한 이유가
   * 여기서 구조로 드러난다.
   */
  grantUsageTokens(dedupeKey: string, rewardTokens: number, reason: string): GrantOutcome;

  balance(): Coin;

  /**
   * 기획서 5.3: 최신 20개 원장 항목.
   *
   * 알려진 계약 문제: 기획서 5.1의 `오늘 획득 코인`은 오늘 발생한 모든 양수 항목의 합인데
   * 이 조회로는 최근 N건만 볼 수 있다. 날짜 범위 조회를 재화 소유자와 합의해야 한다.
   */
  recentLedger(limit: number): LedgerEntry[];

  totals(): CurrencyTotals;
}

/**
 * `meta`가 화면에 그리는 펫 정보.
 *
 * `collection`의 내부 펫 모델이 아니라 **meta가 보여줄 만큼만** 추린 것이다.
 */
export interface PetSummary {
  petId: PetId;
  name: string;
  level: number;
  rarity: Rarity;
  /** 스프라이트 식별자(에셋 가이드의 `slug`). 실제 경로는 그리는 쪽이 조립한다. */
  sprite: string;
}

export interface DexProgress {
  owned: number;
  total: number;
}

/** 트로피가 어디에 놓였는지. 기획서 7.4: 자동 배치 실패가 지급 실패가 되어선 안 된다. */
export type TrophyPlacement = 'room' | 'storage';

/** collection에 대해 `meta`가 필요로 하는 것. */
export interface CollectionPort {
  /** 기획서 5.1: 프로필 펫은 별도 설정값이 아니라 현재 오버레이에 떠 있는 펫이다. */
  overlayPet(): PetSummary;
  ownedPetCount(): number;
  dexProgress(): DexProgress;
  /** `autoPlace`가 참이면 룸의 첫 빈자리를 시도하고, 실패하면 보관함으로 보낸다. */
  grantTrophy(achievementId: string, autoPlace: boolean): TrophyPlacement;
}

/** gacha 조회(기획서 5.3 실적 타일). */
export interface GachaPort {
  drawCount(): number;
  fusionCount(): number;
}

/** battle 조회. */
export interface BattlePort {
  totalWins(): number;
}

/**
 * 펫의 경험치.
 *
 * 기획서에 없던 요구다. 레벨 옆에 EXP 진행을 보여주려면 현재 경험치와 다음 레벨까지
 * 필요한 양을 알아야 한다. `meta` 는 성장 규칙을 소유하지 않으므로 계산하지 않고 받는다.
 */
export interface PetExperience {
  level: number;
  /** 현재 레벨에서 쌓은 경험치. */
  current: number;
  /** 다음 레벨까지 필요한 경험치. */
  required: number;
}

/** overlay-growth 조회. */
export interface GrowthPort {
  highestLevel(): number;
  /** 오버레이 펫의 경험치. 최고 레벨이면 `required` 가 0 이다. */
  petExperience(petId: PetId): PetExperience;
}
