import { compactAmount } from '@pet/shell';

export const COMBINE_GRADES = ['common', 'rare'] as const;
export type CombineGrade = (typeof COMBINE_GRADES)[number];
export type ResultGrade = 'rare' | 'epic';
export type RandomInt = (exclusiveMax: number) => number;

export interface CombinePet {
  readonly id: string;
  readonly name: string;
  readonly grade: CombineGrade | 'epic';
}

export type PetsByGrade<Pet extends CombinePet> = Readonly<{
  common: readonly Pet[];
  rare: readonly Pet[];
  epic: readonly Pet[];
}>;

export interface CombineState {
  readonly activeGrade: CombineGrade;
  readonly tokenBalance: number;
  readonly inventory: Readonly<Record<string, number>>;
  readonly selection: readonly string[];
}

export type CombineOutcome<Pet> =
  | { readonly kind: 'success'; readonly pet: Pet; readonly grade: ResultGrade; readonly stage: 1 }
  | { readonly kind: 'error'; readonly code: 'selection' | 'tokens' | 'candidates' };

export interface CombineEngine<Pet extends CombinePet> {
  getState(): CombineState;
  selectGrade(grade: CombineGrade): CombineState;
  addPet(id: string): CombineState;
  removePet(index: number): CombineState;
  combine(): CombineOutcome<Pet>;
}

/** 합성 한 번에 드는 같은 등급 재료 수. 도감의 획득 경로 안내도 이 값을 읽는다. */
export const COMBINE_MATERIAL_COUNT = 10;
const COST: Readonly<Record<CombineGrade, number>> = { common: 30_000, rare: 100_000 };
const RESULT_GRADE: Readonly<Record<CombineGrade, ResultGrade>> = { common: 'rare', rare: 'epic' };

export function combineCost(grade: CombineGrade): number {
  return COST[grade];
}

export interface CombineReadiness {
  /** 합성하기 버튼을 누를 수 있는가. */
  readonly ready: boolean;
  /** `재료 n / 10 · 비용 토큰`. 늘 보인다. */
  readonly materials: string;
  /** 누를 수 없는 이유. 누를 수 있으면 없다. */
  readonly reason: string | undefined;
}

/**
 * 선택한 재료 수와 잔액으로 합성 버튼 상태를 정한다.
 *
 * 재료와 토큰이 둘 다 모자라면 재료를 먼저 알린다. 재료는 화면에서 바로 채울 수 있지만 토큰은 그렇지 않다.
 * 화면이 미리 막을 뿐이고, 최종 판정은 저장 로직이 한다.
 */
export function combineReadiness(
  grade: CombineGrade,
  selectedCount: number,
  balance: number,
): CombineReadiness {
  const cost = combineCost(grade);
  // 금액은 모든 화면이 같은 축약 표기를 쓴다(`@pet/shell`). 판정은 정확한 값으로 한다.
  const materials = `재료 ${selectedCount} / ${COMBINE_MATERIAL_COUNT} · ${compactAmount(cost)} 토큰`;
  const missing = COMBINE_MATERIAL_COUNT - selectedCount;
  if (missing > 0) return { ready: false, materials, reason: `재료가 ${missing}장 더 필요해요.` };
  if (balance < cost) {
    return {
      ready: false,
      materials,
      reason: `토큰이 ${compactAmount(cost - balance)} 부족해요.`,
    };
  }
  return { ready: true, materials, reason: undefined };
}

export function createCombineEngine<Pet extends CombinePet>(
  petsByGrade: PetsByGrade<Pet>,
  randomInt: RandomInt,
  initialTokens = 200_000,
  copiesPerPet = 30,
): CombineEngine<Pet> {
  const petById = new Map<string, Pet>();
  const inventory: Record<string, number> = {};
  for (const grade of [...COMBINE_GRADES, 'epic'] as const) {
    for (const pet of petsByGrade[grade]) {
      petById.set(pet.id, pet);
      inventory[pet.id] = copiesPerPet;
    }
  }
  let activeGrade: CombineGrade = 'common';
  let tokenBalance = initialTokens;
  let selection = autoSelection(activeGrade, petsByGrade, inventory);

  const state = (): CombineState => ({
    activeGrade,
    tokenBalance,
    inventory: { ...inventory },
    selection: [...selection],
  });
  const selectedCount = (id: string): number =>
    selection.filter((selected) => selected === id).length;

  return {
    getState: state,
    selectGrade(grade) {
      activeGrade = grade;
      selection = autoSelection(grade, petsByGrade, inventory);
      return state();
    },
    addPet(id) {
      const pet = petById.get(id);
      if (!pet || pet.grade !== activeGrade || selection.length >= COMBINE_MATERIAL_COUNT)
        return state();
      if (selectedCount(id) >= (inventory[id] ?? 0)) return state();
      selection = [...selection, id];
      return state();
    },
    removePet(index) {
      if (index < 0 || index >= selection.length) return state();
      selection = selection.filter((_, current) => current !== index);
      return state();
    },
    combine() {
      if (selection.length !== COMBINE_MATERIAL_COUNT) return { kind: 'error', code: 'selection' };
      const cost = COST[activeGrade];
      if (tokenBalance < cost) return { kind: 'error', code: 'tokens' };
      const candidates = petsByGrade[RESULT_GRADE[activeGrade]];
      if (candidates.length === 0) return { kind: 'error', code: 'candidates' };
      const result = candidates[randomInt(candidates.length)];
      if (!result) throw new Error('난수 생성기가 후보 범위를 벗어났습니다.');
      for (const id of selection) inventory[id] = (inventory[id] ?? 0) - 1;
      tokenBalance -= cost;
      selection = autoSelection(activeGrade, petsByGrade, inventory);
      inventory[result.id] = (inventory[result.id] ?? 0) + 1;
      return { kind: 'success', grade: RESULT_GRADE[activeGrade], pet: result, stage: 1 };
    },
  };
}

function autoSelection<Pet extends CombinePet>(
  grade: CombineGrade,
  petsByGrade: PetsByGrade<Pet>,
  inventory: Readonly<Record<string, number>>,
): string[] {
  const selection: string[] = [];
  for (const pet of petsByGrade[grade]) {
    for (
      let count = 0;
      count < (inventory[pet.id] ?? 0) && selection.length < COMBINE_MATERIAL_COUNT;
      count += 1
    ) {
      selection.push(pet.id);
    }
  }
  return selection;
}
