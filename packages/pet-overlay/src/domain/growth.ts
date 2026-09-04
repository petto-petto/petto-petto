/** 토큰 사용량을 펫 성장으로 바꾸는 순수 규칙. */

export const TOKENS_PER_XP = 5_000;
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 50;
export const EVOLUTION_LEVELS = [15, 35] as const;

export interface GrowthPet {
  id: string;
  name: string;
  level: number;
  xpIntoLevel: number;
  totalXp: number;
  /** 0, 1, 2는 에셋 stage 1, 2, 3에 각각 대응한다. */
  evolutionStage: number;
  evolutionAvailable: boolean;
}

export type GrowthEvent =
  | { type: 'xp.gained'; amount: number; level: number }
  | { type: 'pet.levelup'; previousLevel: number; level: number; maxLevel: number }
  | { type: 'pet.evolution_available'; level: number }
  | { type: 'pet.evolved'; previousStage: number; stage: number };

export interface XpApplication {
  pet: GrowthPet;
  gainedXp: number;
  events: readonly GrowthEvent[];
}

export function requiredXp(level: number): number {
  return 10 + Math.floor(level / 2);
}

export function nextEvolutionLevel(stage: number): number | undefined {
  return EVOLUTION_LEVELS[stage];
}

export function isEvolutionAvailable(pet: GrowthPet): boolean {
  const requiredLevel = nextEvolutionLevel(pet.evolutionStage);
  return requiredLevel !== undefined && pet.level >= requiredLevel;
}

export function createGrowthPet(id: string, name: string): GrowthPet {
  return {
    id,
    name,
    level: LEVEL_MIN,
    xpIntoLevel: 0,
    totalXp: 0,
    evolutionStage: 0,
    evolutionAvailable: false,
  };
}

/** XP를 적용한다. 만렙 이후에도 누적 XP는 기록하지만 레벨 내 XP는 고정한다. */
export function applyXp(pet: GrowthPet, amount: number): XpApplication {
  const gainedXp = Math.max(0, Math.floor(amount));
  if (gainedXp === 0) return { pet, gainedXp: 0, events: [] };

  const beforeAvailable = isEvolutionAvailable(pet);
  const next = { ...pet, totalXp: pet.totalXp + gainedXp };
  const events: GrowthEvent[] = [{ type: 'xp.gained', amount: gainedXp, level: next.level }];

  if (next.level < LEVEL_MAX) {
    next.xpIntoLevel += gainedXp;
    const previousLevel = next.level;
    while (next.level < LEVEL_MAX && next.xpIntoLevel >= requiredXp(next.level)) {
      next.xpIntoLevel -= requiredXp(next.level);
      next.level += 1;
    }
    if (next.level === LEVEL_MAX) next.xpIntoLevel = 0;
    if (next.level !== previousLevel) {
      events.push({
        type: 'pet.levelup',
        previousLevel,
        level: next.level,
        maxLevel: LEVEL_MAX,
      });
    }
  }

  next.evolutionAvailable = isEvolutionAvailable(next);
  if (!beforeAvailable && next.evolutionAvailable) {
    const requiredLevel = nextEvolutionLevel(pet.evolutionStage);
    if (requiredLevel !== undefined) {
      events.push({ type: 'pet.evolution_available', level: requiredLevel });
    }
  }

  return { pet: next, gainedXp, events };
}

/** 진화는 자동으로 일어나지 않으며, 사용자의 명시적 요청에서만 실행한다. */
export function evolve(pet: GrowthPet): {
  pet: GrowthPet;
  evolved: boolean;
  events: readonly GrowthEvent[];
} {
  if (!isEvolutionAvailable(pet)) return { pet, evolved: false, events: [] };
  const previousStage = pet.evolutionStage;
  const next = { ...pet, evolutionStage: previousStage + 1 };
  next.evolutionAvailable = isEvolutionAvailable(next);
  return {
    pet: next,
    evolved: true,
    events: [{ type: 'pet.evolved', previousStage, stage: next.evolutionStage }],
  };
}
