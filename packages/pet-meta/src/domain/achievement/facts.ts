/**
 * 설치 이후 사실 투영. 기획서 9.4가 이 파일의 명세다.
 *
 * ## 왜 "사실"을 따로 저장하는가
 *
 * 업적을 이벤트가 올 때마다 직접 판정하면 두 가지가 깨진다.
 *
 * - **소급 판정(ACH-004).** 앱 업데이트로 새 업적이 추가됐을 때 과거 이벤트를 다시 재생할
 *   방법이 없다. 이벤트는 흘러가 버렸다.
 * - **진행률 표시.** "전투 37승 / 50승"을 보여주려면 누적 승수를 들고 있어야 한다.
 *
 * 그래서 이벤트를 받으면 곧바로 판정하지 않고 **사실을 갱신**하고, 판정은 언제나
 * "현재 사실 대 정의"로 한다. 새 업적이 추가돼도 같은 함수를 다시 부르면 끝이다.
 *
 * ## 왜 모든 사실이 단조 증가하는 정수인가
 *
 * 기획서 7.1은 "진행률은 감소하지 않는다"고 정한다. 사실을 누적합이나 최댓값으로만
 * 갱신하면 이 규칙을 **코드로 지키는 게 아니라 자료구조로 보장**하게 된다. 감소시키는
 * 코드 경로 자체가 존재하지 않는다.
 */

import { assertNever, type EventPayload } from '../../events/index.ts';
import type { GrowthRules, OwnedPet, PetClient } from '../../ports/index.ts';

/**
 * 도감 칸 수.
 *
 * 기획서 MVP 목표 종 수다. `PetClient.countSpecies()` 는 **DB 에 등록된** 종 수(지금 6)라서
 * 도감 칸과 다르다 — 인계 문서도 둘이 별개라고 적었다. 등록 종 수로 나누면 여섯 종을 모으는
 * 순간 “도감 완성”이 되어 진행도가 의미를 잃는다.
 */
export const DEX_SLOT_COUNT = 20;

/**
 * 판정에 쓸 수 있는 모든 사실 키.
 *
 * 정의가 여기 없는 키를 참조하면 카탈로그 로딩이 실패하므로, "달성 불가능한 업적"이
 * 조용히 생길 수 없다.
 */
export const FACT_KEYS = [
  'first_pet',
  'first_epic',
  'dex_owned',
  'dex_complete',
  'fusion_count',
  'common_fusion_epic',
  'max_pet_level',
  'max_level_reached',
  'evolution_count',
  'battle_wins',
  'max_streak',
  'observed_tokens',
  'activity_minutes',
  'three_tools_days',
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

export const isFactKey = (value: string): value is FactKey =>
  (FACT_KEYS as readonly string[]).includes(value);

/**
 * 다른 도메인에서 투영한 사실. 기획서 10장의 `achievement_fact`.
 *
 * 이름은 `EventFacts` 로 남았지만 출처가 둘이다. 펫 사실(`firstPet` ~ `evolutionCount`)은
 * `PetClient` 를 관측해 채우고, 합성·전투 사실은 아직 이벤트로 받는다. 저장 형식을 바꾸지
 * 않으려고 이름을 유지했다.
 */
export interface EventFacts {
  firstPet: number;
  firstEpic: number;
  dexOwned: number;
  dexTotal: number;
  dexComplete: number;
  fusionCount: number;
  commonFusionEpic: number;
  maxPetLevel: number;
  maxLevelReached: number;
  evolutionCount: number;
  battleWins: number;
  maxStreak: number;
}

export function createEventFacts(): EventFacts {
  return {
    firstPet: 0,
    firstEpic: 0,
    dexOwned: 0,
    dexTotal: 0,
    dexComplete: 0,
    fusionCount: 0,
    commonFusionEpic: 0,
    maxPetLevel: 0,
    maxLevelReached: 0,
    evolutionCount: 0,
    battleWins: 0,
    maxStreak: 0,
  };
}

/**
 * `PetClient` 의 **현재 보유**를 관측해 펫 사실을 올린다.
 *
 * `PetClient` 가 주는 수는 현재 보유 기준이다 — 합성 재료로 펫을 잃으면 종 수도 최고 레벨도
 * 줄어든다. 인계 문서가 “과거 발견 수나 역대 최고로 쓰면 안 된다”고 경고한 이유다. 그런데
 * 기획서 9.4 는 업적 판정에 **최고 보유 수**를 쓰라고 정한다. 그래서 여기서 최댓값만 취한다.
 * 현재 값을 그대로 쓰면 펫을 합성한 사용자의 업적 진행률이 뒤로 간다.
 *
 * 펫 데이터를 저장하는 게 아니다. “meta 가 지금까지 관측한 최고치”라는 meta 자신의 사실이다.
 */
export function observePets(
  facts: EventFacts,
  pets: readonly OwnedPet[],
  rules: GrowthRules,
): void {
  const speciesOwned = new Set(pets.map((pet) => pet.speciesId)).size;
  const highestLevel = pets.reduce((best, pet) => Math.max(best, pet.level), 0);
  // 진화 단계는 한 번 진화하면 1, 두 번이면 2 다. 합이 곧 관측한 진화 횟수다.
  const evolutions = pets.reduce((sum, pet) => sum + pet.evolutionStage, 0);

  facts.firstPet = Math.max(facts.firstPet, pets.length > 0 ? 1 : 0);
  facts.firstEpic = Math.max(facts.firstEpic, pets.some((pet) => pet.rarity === 'EPIC') ? 1 : 0);
  facts.dexOwned = Math.max(facts.dexOwned, speciesOwned);
  facts.dexTotal = Math.max(facts.dexTotal, DEX_SLOT_COUNT);
  facts.dexComplete = Math.max(facts.dexComplete, speciesOwned >= DEX_SLOT_COUNT ? 1 : 0);
  facts.maxPetLevel = Math.max(facts.maxPetLevel, highestLevel);
  facts.maxLevelReached = Math.max(facts.maxLevelReached, highestLevel >= rules.maxLevel ? 1 : 0);
  facts.evolutionCount = Math.max(facts.evolutionCount, evolutions);
}

/**
 * 펫을 읽어 사실에 반영한다. 읽지 못하면 사실을 건드리지 않고 `false`.
 *
 * 실패를 던지지 않는 이유: 판정은 사용량 업적과 한 흐름이다. 펫 조회 하나가 실패했다고 토큰
 * 마일스톤이 막히면 기획서 INFO-007 을 어긴다. 그렇다고 0 으로 채우지도 않는다 — 최댓값만
 * 쓰니 해는 없겠지만, 읽지 못한 것을 관측했다고 기록하는 셈이다.
 */
export function tryObservePets(facts: EventFacts, client: PetClient, rules: GrowthRules): boolean {
  let pets: OwnedPet[];
  try {
    pets = client.listOwnedPets();
  } catch {
    return false;
  }
  observePets(facts, pets, rules);
  return true;
}

/**
 * 이벤트 하나를 사실에 반영한다.
 *
 * 호출자는 같은 `eventId`를 두 번 넘기지 않아야 한다(기획서 9.3). 중복 방지는
 * `MetaState`가 담당한다 — 사실 갱신 함수는 순수하게 유지한다.
 */
export function applyEvent(facts: EventFacts, payload: EventPayload): void {
  switch (payload.eventType) {
    case 'fusion.completed': {
      facts.fusionCount += 1;
      const bothParentsCommon = payload.parentRarities.every((rarity) => rarity === 'COMMON');
      if (bothParentsCommon && payload.resultRarity === 'EPIC') {
        facts.commonFusionEpic += 1;
      }
      return;
    }
    case 'battle.finished': {
      if (payload.result === 'win') facts.battleWins += 1;
      facts.maxStreak = Math.max(facts.maxStreak, payload.streak);
      return;
    }
    // 사용량 사실은 이벤트가 아니라 meta 자신의 사용량 테이블에서 파생한다.
    // 여기서도 세면 같은 증가분을 두 번 세게 된다.
    case 'usage.aggregated':
      return;
    // 잔액 변동은 업적 조건이 아니다. 뽑기 가능 알림에만 쓰인다.
    case 'currency.balance_changed':
      return;
    default:
      // 새 이벤트를 추가하면 여기서 타입 오류가 난다. 처리를 빠뜨릴 수 없다.
      return assertNever(payload, '사실 투영');
  }
}

/**
 * 사용량에서 파생하는 사실.
 *
 * 저장하지 않고 매번 계산하는 이유: 저장하면 사용량 테이블과 어긋날 수 있다. 사용량
 * 테이블 자체가 이미 감소하지 않으므로(기획서 8.8), 파생값도 자동으로 감소하지 않는다.
 */
export interface UsageFacts {
  observedTokens: number;
  activityMinutes: number;
  /** 세 CLI가 모두 토큰을 발생시킨 로컬 날짜의 수. */
  threeToolsDays: number;
}

/** 판정 시점의 사실 전체. 이벤트 사실과 사용량 사실을 합친 조회용 값이다. */
export type FactSnapshot = Readonly<Record<FactKey, number>>;

export function buildFactSnapshot(events: EventFacts, usage: UsageFacts): FactSnapshot {
  return {
    first_pet: events.firstPet,
    first_epic: events.firstEpic,
    dex_owned: events.dexOwned,
    dex_complete: events.dexComplete,
    fusion_count: events.fusionCount,
    common_fusion_epic: events.commonFusionEpic,
    max_pet_level: events.maxPetLevel,
    max_level_reached: events.maxLevelReached,
    evolution_count: events.evolutionCount,
    battle_wins: events.battleWins,
    max_streak: events.maxStreak,
    observed_tokens: usage.observedTokens,
    activity_minutes: usage.activityMinutes,
    three_tools_days: usage.threeToolsDays,
  };
}

/** 알 수 없는 키는 0으로 본다. 정의 검증이 이미 알 수 없는 키를 막았다. */
export function factValue(snapshot: FactSnapshot, key: string): number {
  return isFactKey(key) ? snapshot[key] : 0;
}
