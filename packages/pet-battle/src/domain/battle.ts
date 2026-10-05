import type { Rarity } from '../contracts.ts';

const legacyTargets: Record<Rarity, number> = { COMMON: 120, RARE: 100, EPIC: 80 };

export function legacyGrowthTarget(rarity: Rarity): number {
  return legacyTargets[rarity];
}

export function enemyHpRatio(intervalXp: number, target: number | null, rarity: Rarity): number {
  const threshold = target ?? legacyTargets[rarity];
  return 1 - Math.min(intervalXp, threshold) / threshold;
}

/** Same [2, 2, 3] level advances as the original engine, for every rarity. */
export function progression(totalXp: number, costs: readonly number[]) {
  let remaining = totalXp;
  let stage = 1;
  let start = 0;
  const last = costs[costs.length - 1]!;
  const levels = () => [2, 2, 3][(stage - 1) % 3]!;
  while (start < costs.length) {
    const count = levels();
    let target = 0;
    for (let i = start; i < start + count; i++) target += costs[i] ?? last;
    if (remaining < target) return { stage, intervalXp: remaining, target };
    remaining -= target;
    stage++;
    start += count;
  }
  const colorCost = last * 7;
  stage += Math.floor(remaining / colorCost) * 3;
  remaining %= colorCost;
  for (let i = 0; i < 2 && remaining >= last * levels(); i++) {
    remaining -= last * levels();
    stage++;
  }
  return { stage: Math.min(stage, 0xffff_ffff), intervalXp: remaining, target: last * levels() };
}
