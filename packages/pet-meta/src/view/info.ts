/**
 * 정보 화면의 표시 모델. 기획서 5.1·5.4와 정보 화면 단순화 사양
 * (`.harness/specs/features/2026-09-28-info-screen-simplify.md`)이 이 파일의 명세다.
 */

import type { LocalDate } from '@pet/core';

import {
  LEDGER_BEGINNING,
  type GachaPort,
  type GrowthRules,
  type OwnedPet,
  type PetClient,
  type TokenPort,
} from '../ports/index.ts';
import { unlockedCount } from '../domain/achievement/engine.ts';
import type { AchievementCatalog } from '../domain/achievement/catalog.ts';
import type { MetaState } from '../domain/state.ts';
import { failedField, fieldOf, okField, type Field } from './field.ts';

/** 레벨 옆 EXP 진행. */
export interface PetExperience {
  level: number;
  /** 현재 레벨에서 쌓은 경험치. */
  current: number;
  /** 다음 레벨까지 필요한 경험치. 최고 레벨이면 0 — 화면이 0 으로 나누지 않고 `MAX` 로 쓴다. */
  required: number;
}

/** 프로필에 그리는 활성 펫. */
export interface ActivePetCard {
  ownedPetId: string;
  /** 별명이 있으면 별명, 없으면 종 이름. */
  name: string;
  level: number;
  rarity: OwnedPet['rarity'];
  sprite: string;
  experience: PetExperience;
}

/** 프로필 카드(기획서 5.1). */
export interface ProfileCard {
  equippedTitle: string | undefined;
  /**
   * 활성 펫. 별도 대표 펫 상태를 만들지 않는다(INFO-003).
   *
   * 세 상태를 구분한다 — 값이 있으면 펫, `null` 이면 **아직 고른 펫이 없음**, `error` 면 읽지
   * 못함. 새 DB 에는 보유 펫이 없으니 `null` 은 흔한 정상 상태다. 기획서 INFO-001 이 “기록이
   * 없는 설치는 오류가 아니라 빈 상태”라고 정한 것과 같은 이유로 오류와 섞지 않는다.
   */
  activePet: Field<ActivePetCard | null>;
}

export interface SummaryScreen {
  profile: ProfileCard;
  /**
   * 지금 쓸 수 있는 재화. 화면에서 가장 강조되는 값이다.
   *
   * 재화의 단위가 토큰이다. 뽑기·합성이 차감하는 것과 같은 원장의 잔액을 그대로 보여 준다.
   */
  availableTokens: Field<number>;
  /** 오늘 얻은 재화. 사용량 보상과 업적 보상의 합이다. */
  todayEarnedTokens: Field<number>;

  /* 함께한 기록 — 요약을 펼쳤을 때만 보인다. */
  /**
   * 누적 토큰. 지금까지 이 앱에서 쌓은 재화의 합이다.
   *
   * `사용 가능 토큰` 과 **같은 기준**이다 — 같은 원장에서 지급된 것을 전부 더한 값이고, 거기서
   * 쓴 만큼을 뺀 것이 사용 가능 토큰이다. 그래서 한 번도 쓰지 않았다면 두 숫자가 같다.
   *
   * 예전에는 이 자리에 관측 토큰(캐시 읽기 포함)을 `사용한 토큰` 으로 보여 줬다. 재화가 되지
   * 않는 캐시 읽기가 대부분이라 사용 가능 토큰보다 수십 배 컸고, 두 숫자가 왜 다른지 화면만
   * 보고는 알 수 없었다.
   */
  totalEarnedTokens: Field<number>;
  /**
   * 뽑은 횟수. gacha 도메인 것이라 실패할 수 있다(INFO-007).
   *
   * `null` 은 횟수를 저장하는 곳이 아직 없다는 뜻이다. 화면은 숫자 대신 `—` 를 그린다.
   */
  drawCount: Field<number | null>;
  ownedPets: Field<number>;
  dexOwned: Field<number>;
  /** 도감 전체 칸 수. 등록된 펫 종 수라서 펫 조회가 실패하면 이 칸도 실패한다. */
  dexTotal: Field<number>;
  togetherMinutes: number;
  togetherLabel: string;
  /** 기획서 5.4: 앱을 켜 둔 동안의 기록이 아직 하나도 없는 상태. */
  hasNoRecords: boolean;
  achievementsUnlocked: number;
  achievementsTotal: number;
}

/** 기획서 5.1: 60분 미만은 분, 그 이상은 시간과 분으로 표시한다. */
export function formatTogether(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/**
 * 로컬 날짜의 자정을 UTC ISO 문자열로 바꾼다. `오늘 +N` 의 기준 시각이다.
 *
 * 기획서 5.1: 오늘 획득은 오늘 발생한 **양수** 원장 항목의 합이고 소비는 포함하지 않는다.
 * "오늘"은 사용자의 로컬 날짜인데 원장의 시각은 UTC 라서, 어느 순간부터가 오늘인지는 화면이
 * 정해서 넘긴다.
 */
function startOfLocalDay(date: LocalDate): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

/** `PetClient` 의 개체를 프로필 카드로 바꾼다. */
function activePetCard(pet: OwnedPet, rules: GrowthRules): ActivePetCard {
  const atMax = pet.level >= rules.maxLevel;
  return {
    ownedPetId: pet.ownedPetId,
    // 인계 문서의 표시 이름 규칙 그대로다.
    name: pet.nickname ?? pet.name,
    level: pet.level,
    rarity: pet.rarity,
    sprite: pet.sprite,
    experience: {
      level: pet.level,
      current: pet.xpIntoLevel,
      required: atMax ? 0 : rules.requiredXp(pet.level),
    },
  };
}

/** 요약 화면 모델을 만든다. */
export function summaryScreen(
  state: MetaState,
  catalog: AchievementCatalog,
  today: LocalDate,
  pets: PetClient,
  tokens: Pick<TokenPort, 'balance' | 'earnedSince'>,
  rules: GrowthRules,
  gacha: GachaPort,
): SummaryScreen {
  const active = fieldOf(() => pets.getActivePet());
  const togetherMinutes = state.activityMinutes.size;

  return {
    profile: {
      equippedTitle: state.profile.equippedTitle,
      activePet: active.error
        ? failedField<ActivePetCard | null>(active.error)
        : okField(active.value ? activePetCard(active.value, rules) : null),
    },
    availableTokens: fieldOf(() => tokens.balance()),
    todayEarnedTokens: fieldOf(() => tokens.earnedSince(startOfLocalDay(today))),
    totalEarnedTokens: fieldOf(() => tokens.earnedSince(LEDGER_BEGINNING)),
    drawCount: fieldOf(() => gacha.drawCount()),
    ownedPets: fieldOf(() => pets.countOwnedPets()),
    // 현재 보유한 종 수다. 업적 판정은 따로 최고치를 기억하지만, 화면은 지금 상태를 보여준다.
    dexOwned: fieldOf(() => pets.countOwnedSpecies()),
    dexTotal: fieldOf(() => pets.countSpecies()),
    togetherMinutes,
    togetherLabel: formatTogether(togetherMinutes),
    hasNoRecords: state.usageDaily.size === 0,
    achievementsUnlocked: unlockedCount(state),
    achievementsTotal: catalog.size,
  };
}
