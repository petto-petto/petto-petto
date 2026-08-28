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

/** 다른 도메인의 이벤트에서 투영한 사실. 기획서 10장의 `achievement_fact`. */
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
 * 이벤트 하나를 사실에 반영한다.
 *
 * 호출자는 같은 `eventId`를 두 번 넘기지 않아야 한다(기획서 9.3). 중복 방지는
 * `MetaState`가 담당한다 — 사실 갱신 함수는 순수하게 유지한다.
 */
export function applyEvent(facts: EventFacts, payload: EventPayload): void {
  switch (payload.eventType) {
    case 'pet.acquired': {
      facts.firstPet = 1;
      if (payload.rarity === 'EPIC') facts.firstEpic = 1;
      return;
    }
    case 'fusion.completed': {
      facts.fusionCount += 1;
      const bothParentsCommon = payload.parentRarities.every((rarity) => rarity === 'COMMON');
      if (bothParentsCommon && payload.resultRarity === 'EPIC') {
        facts.commonFusionEpic += 1;
      }
      return;
    }
    case 'pet.levelup': {
      facts.maxPetLevel = Math.max(facts.maxPetLevel, payload.level);
      if (payload.maxLevel > 0 && payload.level >= payload.maxLevel) {
        facts.maxLevelReached = 1;
      }
      return;
    }
    case 'pet.evolved': {
      facts.evolutionCount += 1;
      return;
    }
    case 'battle.finished': {
      if (payload.result === 'win') facts.battleWins += 1;
      facts.maxStreak = Math.max(facts.maxStreak, payload.streak);
      return;
    }
    case 'dex.updated': {
      // 기획서 9.4: "현재 도감 보유·전체 수와 **최고 보유 수**".
      // 최고값으로 갱신해 진행률이 감소하지 않게 한다.
      facts.dexOwned = Math.max(facts.dexOwned, payload.ownedSpecies);
      facts.dexTotal = Math.max(facts.dexTotal, payload.totalSpecies);
      if (payload.totalSpecies > 0 && payload.ownedSpecies >= payload.totalSpecies) {
        facts.dexComplete = 1;
      }
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
