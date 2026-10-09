/**
 * 펫 도감 화면 모델.
 *
 * `PetClient.listDexEntries()`의 저장 값을 화면이 그대로 그릴 수 있는 모양으로 바꾼다. 슬롯
 * 상태 판정, 진행도·탭 집계가 전부 여기 있고 `node --test`로 검증된다. UI는
 * 이 결과를 DOM에 옮기기만 한다.
 *
 * ## 에셋 경로를 주입받는 이유
 *
 * 경로 규칙은 `@pet/room`이 소유한다. 이 패키지가 그것을 import 하면 UI 번들(`dist/ui/app.js`)
 * 까지 끌려 들어가는데, 창은 번들러 없이 ESM 을 읽으므로 맨 이름 import 가 브라우저에서 풀리지
 * 않는다. 그래서 값을 아는 앱이 조립할 때 넘겨 준다.
 */

import type { DexEntry, OwnedPet, PetSpecies, Rarity } from '@pet/client';

/** 도감 구역 순서. 등급명은 영문 대문자 그대로 쓴다(design.md §2). */
export const DEX_RARITIES: readonly Rarity[] = ['COMMON', 'RARE', 'EPIC'];

/** 미발견 슬롯의 이름 자리. */
export const HIDDEN_NAME = '???';

export type DexSlotState = 'undiscovered' | 'owned' | 'discovered-empty';
export type DexStage = 1 | 2 | 3;

/** 에셋 루트 기준 상대 경로. 실제 URL 은 UI 가 `?assets=` 루트와 합친다. */
export interface DexSpriteRef {
  /** 정지 카드 한 장. 슬롯·진화 썸네일·실루엣이 쓴다. */
  card: string;
  /** idle 시트. 같은 이름의 `.json`이 메타다. 상세 무대가 쓴다. */
  idle: string;
}

export interface DexStageView {
  stage: DexStage;
  sprite: DexSpriteRef;
  /** 보유 개체가 도달한 단계면 컬러, 아니면 실루엣. */
  reached: boolean;
}

export interface DexSlotView {
  speciesId: string;
  /** `No.003`. */
  number: string;
  rarity: Rarity;
  state: DexSlotState;
  /** 미발견이면 `???`. */
  name: string;
  ownedCount: number;
  highestLevel: number;
  /** `2026.09.28`. 미발견이면 null. */
  discoveredOn: string | null;
  isNew: boolean;
  /** 슬롯에 그리는 1단계 그림. */
  sprite: DexSpriteRef;
  /** 상세 무대에 그리는 단계. 도달한 가장 높은 단계, 미도달이면 1단계(실루엣)다. */
  showcase: { stage: DexStage; sprite: DexSpriteRef };
  stages: DexStageView[];
}

export interface DexCount {
  found: number;
  total: number;
}

export interface DexTabView extends DexCount {
  key: 'ALL' | Rarity;
}

export interface DexSectionView extends DexCount {
  rarity: Rarity;
  slots: DexSlotView[];
}

export interface DexView {
  progress: DexCount & { percent: number };
  tabs: DexTabView[];
  sections: DexSectionView[];
  /** 확인하지 않은 신규 발견이 하나라도 있다. 펫룸 도감 버튼의 NEW 표식이 쓴다. */
  hasNew: boolean;
}

export interface DexViewOptions {
  spriteOf(species: PetSpecies, stage: DexStage): DexSpriteRef;
  /** 첫 만남 날짜를 쓸 시간대. 없으면 실행 환경의 지역 시간대다. */
  timeZone?: string;
}

export function slotState(entry: DexEntry): DexSlotState {
  if (entry.discoveredAt === null) return 'undiscovered';
  return entry.ownedCount > 0 ? 'owned' : 'discovered-empty';
}

export function dexView(entries: readonly DexEntry[], options: DexViewOptions): DexView {
  const sections = DEX_RARITIES.map((rarity) => {
    const slots = entries
      .filter((entry) => entry.species.rarity === rarity)
      .sort((a, b) => a.species.speciesId.localeCompare(b.species.speciesId))
      .map((entry) => slotView(entry, options));
    return { rarity, slots, ...countOf(slots) };
  });
  const all = countOf(sections.flatMap((section) => section.slots));
  return {
    progress: { ...all, percent: all.total === 0 ? 0 : Math.floor((all.found * 100) / all.total) },
    tabs: [
      { key: 'ALL', ...all },
      ...sections.map(({ rarity, found, total }) => ({ key: rarity, found, total })),
    ],
    sections,
    hasNew: entries.some((entry) => entry.isNew),
  };
}

function countOf(slots: readonly DexSlotView[]): DexCount {
  return {
    found: slots.filter((slot) => slot.state !== 'undiscovered').length,
    total: slots.length,
  };
}

function slotView(entry: DexEntry, options: DexViewOptions): DexSlotView {
  const { species } = entry;
  const state = slotState(entry);
  const reachedUpTo = reachedStage(entry, state);
  const stages = ([1, 2, 3] as const).map((stage) => ({
    stage,
    sprite: options.spriteOf(species, stage),
    reached: stage <= reachedUpTo,
  }));
  const showcaseStage: DexStage = reachedUpTo === 0 ? 1 : reachedUpTo;
  return {
    speciesId: species.speciesId,
    number: `No.${species.speciesId}`,
    rarity: species.rarity,
    state,
    name: state === 'undiscovered' ? HIDDEN_NAME : species.name,
    ownedCount: entry.ownedCount,
    highestLevel: entry.highestLevel,
    discoveredOn:
      entry.discoveredAt === null ? null : formatDiscoveredOn(entry.discoveredAt, options.timeZone),
    isNew: entry.isNew,
    sprite: options.spriteOf(species, 1),
    showcase: { stage: showcaseStage, sprite: options.spriteOf(species, showcaseStage) },
    stages,
  };
}

/** 컬러로 보여 줄 가장 높은 단계. 0이면 하나도 없다(전부 실루엣). */
function reachedStage(entry: DexEntry, state: DexSlotState): 0 | DexStage {
  switch (state) {
    case 'undiscovered':
      return 0;
    // 지금 보유한 개체가 없으면 어디까지 진화했는지 알 수 없다. 만난 모습인 1단계만 남긴다.
    case 'discovered-empty':
      return 1;
    case 'owned':
      return ((entry.highestStage ?? 0) + 1) as DexStage;
    default: {
      const unreachable: never = state;
      throw new Error(`알 수 없는 도감 슬롯 상태: ${String(unreachable)}`);
    }
  }
}

/** ISO 시각 → `YYYY.MM.DD`. 읽을 수 없는 값은 조용히 넘기지 않고 던진다. */
export function formatDiscoveredOn(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`첫 만남 시각을 읽을 수 없습니다: ${iso}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}.${part('month')}.${part('day')}`;
}

/**
 * 도감을 처음 열 때 고를 칸. 방금 만난 NEW 종을 먼저, 없으면 첫 발견 칸을 고른다. 미발견 칸을
 * 고르면 `???`만 보여 반가운 소식이 묻힌다. 하나도 못 만났으면 null — 상세 자리에 안내를 둔다.
 */
export function initialSelection(view: DexView): string | null {
  const slots = view.sections.flatMap((section) => section.slots);
  const pick =
    slots.find((slot) => slot.isNew) ?? slots.find((slot) => slot.state !== 'undiscovered');
  return pick?.speciesId ?? null;
}

/**
 * `펫룸에서 보기`가 열 개체. 활성 개체가 그 종이면 그것을, 아니면 레벨이 가장 높은 개체를
 * (같으면 앞선 것을) 연다. 보유 개체가 없으면 null.
 */
export function roomFocusTarget(
  pets: readonly Pick<OwnedPet, 'ownedPetId' | 'isActive' | 'level'>[],
): string | null {
  const active = pets.find((pet) => pet.isActive);
  if (active) return active.ownedPetId;
  let best: (typeof pets)[number] | undefined;
  for (const pet of pets) {
    if (!best || pet.level > best.level) best = pet;
  }
  return best?.ownedPetId ?? null;
}
