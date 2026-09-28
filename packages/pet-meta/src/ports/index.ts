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
 * 펫 데이터는 공통 `PetClient` 에서 읽는다.
 *
 * 펫 담당이 공표한 인터페이스를 그대로 쓴다. meta 가 펫용 포트를 따로 선언하면 같은 테이블을
 * 두 모양으로 설명하게 되고, 한쪽만 바뀌는 순간 어긋난다.
 */
export type { OwnedPet, PetClient } from '@pet/client';

/**
 * `pet:overlay` 채널이 돌려주는 펫 모양.
 *
 * meta 는 이제 이 타입을 쓰지 않는다 — 프로필은 `PetClient` 의 `OwnedPet` 을 그린다. 남아 있는
 * 이유는 room 의 `pet.js` 가 이 채널과 모양에 기대고 있기 때문이다. 그 창은 지금 열리지
 * 않지만 남의 코드 경로라 여기서 끊지 않는다.
 *
 * `petId` 는 실제로 **종** id 를 담는다. 개체 id 가 필요하면 `OwnedPet.ownedPetId` 를 쓴다.
 */
export interface PetSummary {
  petId: PetId;
  name: string;
  level: number;
  rarity: Rarity;
  /** 스프라이트 식별자(에셋 가이드의 `slug`). 실제 경로는 그리는 쪽이 조립한다. */
  sprite: string;
}

/** 트로피가 어디에 놓였는지. 기획서 7.4: 자동 배치 실패가 지급 실패가 되어선 안 된다. */
export type TrophyPlacement = 'room' | 'storage';

/**
 * 펫 데이터가 아닌 두 가지. 트로피 도메인이 생기기 전까지 room 어댑터가 맡는다.
 *
 * 보유 수·도감은 `PetClient` 로 옮겨 여기서 뺐다.
 */
export interface CollectionPort {
  /** room 의 `pet:overlay` 채널 전용. meta 화면은 쓰지 않는다. */
  overlayPet(): PetSummary;
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
 * 성장 규칙.
 *
 * 레벨 곡선은 성장 도메인 것이다. `PetClient` 는 저장된 현재 XP 만 주고 “다음 레벨까지 필요한
 * 양”은 주지 않는다 — 인계 문서도 “기존 성장 함수에서 계산한다”고 적었다. 그런데 그 함수가 있는
 * `@pet/main-overlay` 가 TS 진입점을 내보내지 않아 meta 가 import 할 수 없다. 그래서 필요한
 * 두 가지만 선언하고 앱이 채운다.
 */
export interface GrowthRules {
  /** 이 레벨에 닿으면 더 오르지 않는다. 업적 `오랜 친구 Ⅲ` 의 조건이다. */
  readonly maxLevel: number;
  /** 한 레벨을 올리는 데 필요한 XP. */
  requiredXp(level: number): number;
}
