/** 정보 화면의 표시 모델. 기획서 5.1·5.3·5.4가 이 파일의 명세다. */

import { localDateOf, type LocalDate } from '@pet/core';

import type {
  BattlePort,
  CollectionPort,
  CurrencyPort,
  GachaPort,
  GrowthPort,
} from '../ports/index.ts';
import { completionRatio, unlockedCount } from '../domain/achievement/engine.ts';
import type { AchievementCatalog } from '../domain/achievement/catalog.ts';
import { observedOn, observedTotal, type MetaState } from '../domain/state.ts';
import { failedField, fieldOf, okField, type Field } from './field.ts';

/** 프로필 카드(기획서 5.1). */
export interface ProfileCard {
  trainerName: string;
  equippedTitle: string | undefined;
  /** 현재 오버레이 펫. 별도 대표 펫 상태를 만들지 않는다(INFO-003). */
  petName: Field<string>;
  petLevel: Field<number>;
  petSprite: Field<string>;
  /** 기획서 5.1: `이 기기` 표기. 계정도 동기화도 없다는 사실을 알린다. */
  deviceLabel: string;
}

export interface SummaryScreen {
  profile: ProfileCard;
  totalObservedTokens: number;
  ownedPets: Field<number>;
  dexOwned: Field<number>;
  dexTotal: Field<number>;
  todayObservedTokens: number;
  todayEarnedCoins: Field<number>;
  togetherMinutes: number;
  togetherLabel: string;
  /** 기획서 5.4: 설치 이후 기록이 아직 없는 상태. */
  hasNoRecords: boolean;
  achievementsUnlocked: number;
  achievementsTotal: number;
  completionPercent: number;
}

/** 기획서 5.1: 60분 미만은 분, 그 이상은 시간과 분으로 표시한다. */
export function formatTogether(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/**
 * 기획서 5.1: 오늘 발생한 **양수** 원장 항목의 합. 소비는 포함하지 않는다.
 *
 * 여기에 계약상의 빈틈이 있다. 기획서 9.5가 재화 도메인에 요구하는 조회는 "최근 원장
 * 20건"이라서, 하루에 20건이 넘는 획득이 있으면 이 합계가 실제보다 작아진다. 프로토타입은
 * 넉넉한 개수를 요청해 우회하지만, 재화 소유자와 날짜 범위 조회를 합의하는 것이 옳다.
 */
function todayEarnedCoins(currency: CurrencyPort, today: LocalDate): Field<number> {
  const LEDGER_SCAN_LIMIT = 500;
  return fieldOf(() =>
    currency
      .recentLedger(LEDGER_SCAN_LIMIT)
      .filter((entry) => localDateOf(new Date(entry.occurredAt)) === today && entry.delta > 0)
      .reduce((sum, entry) => sum + entry.delta, 0),
  );
}

/** 요약 화면 모델을 만든다. */
export function summaryScreen(
  state: MetaState,
  catalog: AchievementCatalog,
  today: LocalDate,
  collection: CollectionPort,
  currency: CurrencyPort,
): SummaryScreen {
  const pet = fieldOf(() => collection.overlayPet());
  const dex = fieldOf(() => collection.dexProgress());
  const togetherMinutes = state.activityMinutes.size;

  return {
    profile: {
      trainerName: state.profile.displayName,
      equippedTitle: state.profile.equippedTitle,
      petName: pet.value ? okField(pet.value.name) : failedField(pet.error ?? '조회 실패'),
      petLevel: pet.value ? okField(pet.value.level) : failedField(pet.error ?? '조회 실패'),
      petSprite: pet.value ? okField(pet.value.sprite) : failedField(pet.error ?? '조회 실패'),
      deviceLabel: '이 기기',
    },
    totalObservedTokens: observedTotal(state),
    ownedPets: fieldOf(() => collection.ownedPetCount()),
    dexOwned: dex.value ? okField(dex.value.owned) : failedField(dex.error ?? '조회 실패'),
    dexTotal: dex.value ? okField(dex.value.total) : failedField(dex.error ?? '조회 실패'),
    todayObservedTokens: observedOn(state, today),
    todayEarnedCoins: todayEarnedCoins(currency, today),
    togetherMinutes,
    togetherLabel: formatTogether(togetherMinutes),
    hasNoRecords: state.usageDaily.size === 0,
    achievementsUnlocked: unlockedCount(state),
    achievementsTotal: catalog.size,
    completionPercent: Math.round(completionRatio(state, catalog) * 100),
  };
}

export interface PerformanceTile {
  key: string;
  label: string;
  value: Field<number>;
  /** 어느 도메인이 이 값을 소유하는가. 경계를 눈으로 보여주기 위해 담는다. */
  owner: string;
}

export interface LedgerRow {
  entryId: string;
  reason: string;
  occurredAt: string;
  delta: number;
}

export interface PerformanceScreen {
  tiles: PerformanceTile[];
  ledger: Field<LedgerRow[]>;
}

/** 기획서 5.3: 코인 원장은 최신 20개를 표시한다. */
export const LEDGER_DISPLAY_COUNT = 20;

const monthDayTime = (iso: string): string => {
  const at = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/**
 * 실적 화면 모델을 만든다.
 *
 * 타일 하나의 조회가 실패해도 나머지 타일과 원장은 그대로 만든다(INFO-007).
 */
export function performanceScreen(
  gacha: GachaPort,
  battle: BattlePort,
  growth: GrowthPort,
  currency: CurrencyPort,
): PerformanceScreen {
  const totals = fieldOf(() => currency.totals());

  const tiles: PerformanceTile[] = [
    { key: 'draw', label: '뽑기', value: fieldOf(() => gacha.drawCount()), owner: 'gacha' },
    { key: 'fusion', label: '합성', value: fieldOf(() => gacha.fusionCount()), owner: 'gacha' },
    { key: 'battle', label: '전투', value: fieldOf(() => battle.totalWins()), owner: 'battle' },
    {
      key: 'best_level',
      label: '최고',
      value: fieldOf(() => growth.highestLevel()),
      owner: 'overlay-growth',
    },
    {
      key: 'earned',
      label: '획득',
      value: totals.value
        ? okField(Math.abs(totals.value.earned))
        : failedField(totals.error ?? '조회 실패'),
      owner: 'overlay-growth 재화',
    },
    {
      key: 'spent',
      label: '소비',
      value: totals.value
        ? okField(Math.abs(totals.value.spent))
        : failedField(totals.error ?? '조회 실패'),
      owner: 'overlay-growth 재화',
    },
  ];

  const ledger = fieldOf(() =>
    currency.recentLedger(LEDGER_DISPLAY_COUNT).map((entry) => ({
      entryId: entry.entryId,
      reason: entry.reason,
      occurredAt: monthDayTime(entry.occurredAt),
      delta: entry.delta,
    })),
  );

  return { tiles, ledger };
}
