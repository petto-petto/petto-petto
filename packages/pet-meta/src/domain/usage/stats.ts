/** 사용량 화면의 조회. 기획서 5.2가 이 파일의 명세다. */

import {
  PROVIDERS,
  providerName,
  shiftDays,
  weekdayFromMonday,
  type LocalDate,
  type Provider,
} from '@pet/core';

import { splitUsageKey, sourceStatusName, type MetaState } from '../state.ts';
import { observed } from './tokens.ts';

/** 기간 필터(기획서 5.2). */
export type Period = 'today' | 'week' | 'month' | 'all';

export const PERIODS: readonly Period[] = ['today', 'week', 'month', 'all'];

const PERIOD_NAMES: Record<Period, string> = {
  today: '오늘',
  week: '주',
  month: '달',
  all: '전체',
};

export const periodName = (period: Period): string => PERIOD_NAMES[period];

export const isPeriod = (value: string): value is Period =>
  (PERIODS as readonly string[]).includes(value);

/**
 * 이 날짜가 기간에 포함되는가.
 *
 * 기획서 5.2: 주는 "오늘을 포함한 최근 7개 로컬 날짜", 달은 30개다. 따라서 경계는
 * `오늘 - 6일`과 `오늘 - 29일`이다. 오늘을 포함해 세는 것이 핵심이다.
 */
export function periodContains(period: Period, date: LocalDate, today: LocalDate): boolean {
  switch (period) {
    case 'today':
      return date === today;
    case 'week':
      return date > shiftDays(today, -7) && date <= today;
    case 'month':
      return date > shiftDays(today, -30) && date <= today;
    case 'all':
      return true;
  }
}

export interface ToolRow {
  provider: Provider;
  providerLabel: string;
  observed: number;
  /** 선택 기간 내 비율(0~100). */
  sharePercent: number;
  statusLabel: string;
  /** 수집이 중지된 소스인가. 기획서 5.2는 이 경우에도 목록에 남기라고 정한다. */
  paused: boolean;
}

/** 모델별 분해 한 줄. 식별 기준은 `(도구, 원본 모델명)`이다. */
export interface ModelRow {
  provider: Provider;
  providerLabel: string;
  /** 정규화하지 않은 원본 모델명. 알 수 없는 새 모델도 원본 이름으로 표시한다. */
  rawModel: string;
  observed: number;
  sharePercent: number;
}

export interface GrassCell {
  date: LocalDate;
  observed: number;
  /** 0 = 빈 칸, 1~4 = 농도 단계. */
  level: number;
  /** 오늘 이후 날짜. 화면에서 칸을 비워 둔다. */
  future: boolean;
}

export interface GrassWeek {
  cells: GrassCell[];
}

export interface UsageScreen {
  period: Period;
  periodLabel: string;
  /** 선택 기간의 관측 토큰 합계. */
  periodObserved: number;
  tools: ToolRow[];
  /** 상위 5개만이 아니라 전체를 담는다. 접기·펼치기는 화면이 결정한다. */
  models: ModelRow[];
  /** 기획서 5.2: `전체 N개 모델 보기`의 N. */
  modelCount: number;
  /** 기간 필터를 적용하지 않는 최근 12주 잔디. */
  grass: GrassWeek[];
  /** 잔디 기간의 관측 토큰 합계. 기간 필터와 무관하다. */
  grassObserved: number;
}

/** 기획서 5.2: 모델 목록의 기본 표시 개수. */
export const MODEL_PREVIEW_COUNT = 5;

/** 잔디 주 수. 기획서 5.2는 12주 고정이다. */
export const GRASS_WEEKS = 12;

const share = (value: number, total: number): number =>
  total === 0 ? 0 : Math.round((value / total) * 100);

/** 잔디의 첫 날짜. 오늘이 포함된 주의 월요일에서 11주를 뺀다. */
function grassStart(today: LocalDate): LocalDate {
  const monday = shiftDays(today, -weekdayFromMonday(today));
  return shiftDays(monday, -(GRASS_WEEKS - 1) * 7);
}

/** 관측 토큰을 0~4 농도로 바꾼다. `sortedNonzero`는 오름차순 정렬된 0이 아닌 값들이다. */
function intensityLevel(value: number, sortedNonzero: readonly number[]): number {
  if (value === 0 || sortedNonzero.length === 0) return 0;
  const quantile = (ratio: number): number => {
    const index = Math.round((sortedNonzero.length - 1) * ratio);
    return sortedNonzero[Math.min(index, sortedNonzero.length - 1)] ?? 0;
  };
  if (value <= quantile(0.25)) return 1;
  if (value <= quantile(0.5)) return 2;
  if (value <= quantile(0.75)) return 3;
  return 4;
}

/**
 * 최근 12주 잔디를 만든다.
 *
 * 농도 계산이 기획서 5.2의 미묘한 부분이다. 절대값 기준으로 나누면 사용량이 적은 사용자는
 * 잔디가 전부 1단계로 보인다. 그래서 "비어 있지 않은 날짜들의 분포"를 기준으로 사분위를
 * 잡는다. 0은 단계 계산에서 제외하고 빈 칸으로 남긴다 — INFO-004가 요구하는
 * "0과 값의 구분"이다.
 */
export function grass(state: MetaState, today: LocalDate): GrassWeek[] {
  const start = grassStart(today);

  const perDate = new Map<LocalDate, number>();
  for (const [key, counts] of state.usageDaily) {
    const { date } = splitUsageKey(key);
    if (date >= start && date <= today) {
      perDate.set(date, (perDate.get(date) ?? 0) + observed(counts));
    }
  }

  const sortedNonzero = [...perDate.values()].filter((value) => value > 0).sort((a, b) => a - b);

  const weeks: GrassWeek[] = [];
  for (let week = 0; week < GRASS_WEEKS; week += 1) {
    const cells: GrassCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = shiftDays(start, week * 7 + weekday);
      const value = perDate.get(date) ?? 0;
      cells.push({
        date,
        observed: value,
        level: intensityLevel(value, sortedNonzero),
        future: date > today,
      });
    }
    weeks.push({ cells });
  }
  return weeks;
}

function grassTotal(state: MetaState, today: LocalDate): number {
  const start = grassStart(today);
  let total = 0;
  for (const [key, counts] of state.usageDaily) {
    const { date } = splitUsageKey(key);
    if (date >= start && date <= today) total += observed(counts);
  }
  return total;
}

function toolRows(state: MetaState, today: LocalDate, period: Period, total: number): ToolRow[] {
  const rows: ToolRow[] = [];

  for (const provider of PROVIDERS) {
    const source = state.sources.get(provider);
    let hasHistory = false;
    let value = 0;

    for (const [key, counts] of state.usageDaily) {
      const parsed = splitUsageKey(key);
      if (parsed.provider !== provider) continue;
      hasHistory = true;
      if (periodContains(period, parsed.date, today)) value += observed(counts);
    }

    // 한 번도 감지되지 않았고 과거 기록도 없는 소스는 도구별 분해에서 뺀다.
    // 설정의 수집 카드에는 여전히 나타난다.
    if (!hasHistory && !source?.everConnected) continue;

    rows.push({
      provider,
      providerLabel: providerName(provider),
      observed: value,
      sharePercent: share(value, total),
      statusLabel: source ? sourceStatusName(source.status) : '',
      paused: source ? !source.enabled : false,
    });
  }

  return rows;
}

function modelRows(state: MetaState, today: LocalDate, period: Period, total: number): ModelRow[] {
  const aggregated = new Map<string, { provider: Provider; rawModel: string; observed: number }>();

  for (const [key, counts] of state.usageDaily) {
    const { provider, date, rawModel } = splitUsageKey(key);
    if (!periodContains(period, date, today)) continue;
    const groupKey = `${provider}|${rawModel}`;
    const existing = aggregated.get(groupKey);
    if (existing) {
      existing.observed += observed(counts);
    } else {
      aggregated.set(groupKey, { provider, rawModel, observed: observed(counts) });
    }
  }

  const rows: ModelRow[] = [...aggregated.values()].map((entry) => ({
    provider: entry.provider,
    providerLabel: providerName(entry.provider),
    rawModel: entry.rawModel,
    observed: entry.observed,
    sharePercent: share(entry.observed, total),
  }));

  // 기획서 5.2: 관측 토큰 내림차순. 동률은 이름으로 안정 정렬해 화면이 흔들리지 않게 한다.
  rows.sort(
    (left, right) =>
      right.observed - left.observed ||
      left.provider.localeCompare(right.provider) ||
      left.rawModel.localeCompare(right.rawModel),
  );
  return rows;
}

/** 사용량 화면 모델을 만든다. */
export function usageScreen(state: MetaState, today: LocalDate, period: Period): UsageScreen {
  let periodObserved = 0;
  for (const [key, counts] of state.usageDaily) {
    if (periodContains(period, splitUsageKey(key).date, today)) periodObserved += observed(counts);
  }

  const models = modelRows(state, today, period, periodObserved);

  return {
    period,
    periodLabel: periodName(period),
    periodObserved,
    tools: toolRows(state, today, period, periodObserved),
    models,
    modelCount: models.length,
    grass: grass(state, today),
    grassObserved: grassTotal(state, today),
  };
}
