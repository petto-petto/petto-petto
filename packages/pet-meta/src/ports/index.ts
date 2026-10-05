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
 * ## 이미 있는 Port 는 재사용한다
 *
 * 펫과 토큰은 공통 `PetClient` · `TokenClient` 가 있어 그대로(또는 `Pick` 으로 좁혀) 쓴다.
 * 여기서 새로 선언하는 것은 아직 공통 Port 가 없는 도메인 — 뽑기 · 전투 · 트로피 — 뿐이고,
 * 그 도메인이 값을 저장하기 전까지는 대역으로 채운다.
 *
 * ## 실패는 던진다
 *
 * 포트는 실패를 **던진다**. TypeScript에서는 그것이 관용이고, 화면은 블록마다 `try`로 감싸
 * 자기 자리에만 오류를 표시한다(기획서 11.1, INFO-007).
 * 그 변환을 하는 곳이 `view/` 계층이다.
 */

import type { PetId, Rarity } from '@pet/core';
import type { TokenClient } from '@pet/client';

/**
 * 토큰 — 사용량 원장과 재화.
 *
 * 공통 `TokenClient` 가 이미 있으므로 새 인터페이스를 만들지 않고, meta 가 부르는 메서드만 좁혀
 * 받는다. 같은 테이블 위에 meta 만의 인터페이스를 하나 더 두면 계약이 둘이 되어 어긋난다.
 *
 * **재화의 단위는 토큰이다.** 뽑기·합성이 차감하는 것과 같은 원장이고 같은 단위라서 환산
 * 비율이 없다. 사용량 보상은 보상 대상 토큰 수를 그대로, 업적 보상은 정의에 적힌 토큰 수를
 * 그대로 지급한다.
 *
 * | 메서드 | meta 가 쓰는 곳 |
 * |---|---|
 * | `recordUsage` | 수집한 증가분을 공용 토큰 표에 적재. 같은 `dedupeKey` 는 한 번만 쌓인다 |
 * | `grantOnce` | 사용량 보상(증가분 키)과 업적 보상(`achievement:<id>`). 이미 지급한 키면 `false` |
 * | `balance` | 요약의 `사용 가능 토큰` |
 * | `earnedSince` | 요약의 `오늘 +N` |
 *
 * 네 메서드 모두 저장·조회 실패를 던진다.
 */
export type TokenPort = Pick<TokenClient, 'recordUsage' | 'grantOnce' | 'balance' | 'earnedSince'>;
export type { UsageEntry } from '@pet/client';

/**
 * 원장의 어떤 항목보다도 이른 시각. `earnedSince(LEDGER_BEGINNING)` 이 곧 **누적 토큰** — 지금까지
 * 지급된 재화의 합이다.
 */
export const LEDGER_BEGINNING = new Date(0).toISOString();

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
  /**
   * 스프라이트 단계(1·2·3).
   *
   * **레벨에서 유도하면 안 된다.** 단계는 사용자가 명시적으로 실행한 진화 횟수가 정하므로,
   * 레벨로 계산하면 진화하지 않은 고레벨 펫이 이 화면에서만 다른 모습으로 보인다. 값을
   * 만들 수 있는 곳은 명부를 가진 쪽뿐이라 여기 실어 보낸다.
   */
  stage: 1 | 2 | 3;
}

/** 트로피가 어디에 놓였는지. 기획서 7.4: 자동 배치 실패가 지급 실패가 되어선 안 된다. */
export type TrophyPlacement = 'room' | 'storage';

/**
 * 펫 데이터가 아닌 두 가지. 트로피 도메인이 생기기 전까지 room 어댑터가 맡는다.
 *
 * 보유 수·도감은 `PetClient` 로 옮겨 여기서 뺐다.
 */
export interface CollectionPort {
  /** room 의 `pet:overlay` 채널 전용. meta 화면은 쓰지 않는다. 보유 펫이 없으면 `null`이다. */
  overlayPet(): PetSummary | null;
  /** `autoPlace`가 참이면 룸의 첫 빈자리를 시도하고, 실패하면 보관함으로 보낸다. */
  grantTrophy(achievementId: string, autoPlace: boolean): TrophyPlacement;
}

/**
 * gacha 조회. 뽑기는 아직 이 값들을 담은 테이블이 없어서 대역으로 채운다.
 */
export interface GachaPort {
  /**
   * 누적 뽑기 횟수. 요약의 `뽑은 횟수`가 쓴다.
   *
   * `null` 은 **횟수를 저장하는 곳이 아직 없다**는 뜻이다. `0` 은 한 번도 뽑지 않았다는 실제
   * 값이라 그 자리에 쓸 수 없다. 뽑기가 횟수를 저장하게 되면 `null` 갈래는 없어진다.
   */
  drawCount(): number | null;
  fusionCount(): number;
  /** 뽑기 1회에 드는 토큰. 뽑기 가능 알림의 기준이다. */
  drawCost(): number;
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
