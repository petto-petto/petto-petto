export const GACHA_GRADES = ['common', 'rare', 'epic'] as const;

export type GachaGrade = (typeof GACHA_GRADES)[number];
export type DrawCount = 1 | 10;
export type RandomInt = (exclusiveMax: number) => number;

export interface GachaState {
  readonly pityCounter: number;
  readonly totalDrawCount: number;
}

export type PetsByGrade<Pet> = Readonly<Record<GachaGrade, readonly Pet[]>>;

export interface GachaResult<Pet> {
  readonly grade: GachaGrade;
  readonly pet: Pet;
}

export interface DrawResult<Pet> extends GachaState {
  readonly results: readonly GachaResult<Pet>[];
}

export interface GachaEngine<Pet> {
  draw(count: DrawCount): DrawResult<Pet>;
  getState(): GachaState;
}

export const STANDARD_GRADE_WEIGHTS = {
  common: 8_000,
  rare: 1_700,
  epic: 300,
} as const satisfies Record<GachaGrade, number>;

const GUARANTEED_GRADE_WEIGHTS = {
  common: 0,
  rare: 8_500,
  epic: 1_500,
} as const satisfies Record<GachaGrade, number>;

const ODDS_SCALE = 10_000;
const PITY_LIMIT = 100;

export function createGachaEngine<Pet>(
  petsByGrade: PetsByGrade<Pet>,
  randomInt: RandomInt = secureRandomInt,
  initialState: GachaState = { pityCounter: 0, totalDrawCount: 0 },
): GachaEngine<Pet> {
  let pityCounter = initialState.pityCounter;
  let totalDrawCount = initialState.totalDrawCount;

  return {
    draw(count) {
      if (count !== 1 && count !== 10) {
        throw new Error('뽑기 횟수는 1 또는 10이어야 합니다.');
      }

      const results: GachaResult<Pet>[] = [];
      for (let index = 0; index < count; index += 1) {
        pityCounter += 1;

        const noRareOrAbove = results.every((result) => result.grade === 'common');
        const grade =
          pityCounter >= PITY_LIMIT
            ? 'epic'
            : count === 10 && index === 9 && noRareOrAbove
              ? pickGrade(GUARANTEED_GRADE_WEIGHTS, randomInt)
              : pickGrade(STANDARD_GRADE_WEIGHTS, randomInt);

        const candidates = petsByGrade[grade];
        if (candidates.length === 0) {
          throw new Error(`${grade} 등급의 데모 펫이 없습니다.`);
        }

        const pet = candidates[randomInt(candidates.length)];
        if (pet === undefined) {
          throw new Error('난수 생성기가 후보 범위를 벗어난 값을 반환했습니다.');
        }

        results.push({ grade, pet });
        totalDrawCount += 1;
        if (grade === 'epic') pityCounter = 0;
      }

      return { results, pityCounter, totalDrawCount };
    },
    getState: () => ({ pityCounter, totalDrawCount }),
  };
}

export function individualOdds<Pet>(petsByGrade: PetsByGrade<Pet>): Record<GachaGrade, string> {
  return Object.fromEntries(
    GACHA_GRADES.map((grade) => {
      const count = petsByGrade[grade].length;
      if (count === 0) throw new Error(`${grade} 등급의 데모 펫이 없습니다.`);
      return [grade, (STANDARD_GRADE_WEIGHTS[grade] / 100 / count).toFixed(2)];
    }),
  ) as Record<GachaGrade, string>;
}

export function secureRandomInt(exclusiveMax: number): number {
  const range = 0x1_0000_0000;
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0 || exclusiveMax > range) {
    throw new RangeError('난수 상한은 1 이상 2^32 이하의 정수여야 합니다.');
  }

  const limit = Math.floor(range / exclusiveMax) * exclusiveMax;
  const values = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(values);
    value = values[0] ?? 0;
  } while (value >= limit);

  return value % exclusiveMax;
}

function pickGrade(
  weights: Readonly<Record<GachaGrade, number>>,
  randomInt: RandomInt,
): GachaGrade {
  const roll = randomInt(ODDS_SCALE);
  let cumulative = 0;

  for (const grade of GACHA_GRADES) {
    cumulative += weights[grade];
    if (roll < cumulative) return grade;
  }

  throw new Error('등급 확률 합계가 10,000이 아니거나 난수가 범위를 벗어났습니다.');
}
