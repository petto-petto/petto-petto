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

const REQUIRED_COUNT = 10;
const COST: Readonly<Record<CombineGrade, number>> = { common: 30_000, rare: 100_000 };
const RESULT_GRADE: Readonly<Record<CombineGrade, ResultGrade>> = { common: 'rare', rare: 'epic' };

export function combineCost(grade: CombineGrade): number {
  return COST[grade];
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
      if (!pet || pet.grade !== activeGrade || selection.length >= REQUIRED_COUNT) return state();
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
      if (selection.length !== REQUIRED_COUNT) return { kind: 'error', code: 'selection' };
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
      count < (inventory[pet.id] ?? 0) && selection.length < REQUIRED_COUNT;
      count += 1
    ) {
      selection.push(pet.id);
    }
  }
  return selection;
}
