import type { BattleLayout } from './layout.ts';

/** A planted foot holds its position; travel happens only during the lifted beat. */
export function footstep(time: number, start: number, end: number, count: number) {
  const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
  const stride = progress * count;
  const index = Math.floor(stride);
  const beat = stride - index;
  const swing = Math.max(0, Math.min(1, (beat - 0.18) / 0.64));
  const moving = time >= start && time < end;
  return {
    progress: progress === 1 ? 1 : (index + swing * swing * (3 - 2 * swing)) / count,
    step: moving ? index * 4 + Math.min(3, Math.floor(beat * 4)) : null,
    lift: moving ? [0, 0.5, 1, 0][Math.min(3, Math.floor(beat * 4))]! : 0,
    compression: moving ? [1, -0.4, -0.6, 0.6][Math.min(3, Math.floor(beat * 4))]! : 0,
  };
}

/** Worst-case visible silhouette, including hit squash/recoil; not frame-left magic numbers. */
export function combatContactDistance(layout: BattleLayout, enemyHeight: number): number {
  const enemyWidth = Math.min(layout.enemyFrameSize, enemyHeight * (51 / 32));
  return Math.ceil(
    layout.petSize / 2 +
      (layout.petSize * 1.08) / 2 -
      layout.enemyFrameSize / 2 +
      (enemyWidth * 1.13) / 2 +
      12,
  );
}

/** Enemy-only landing: ignore the pet's transparent right margin, reserve landing squash. */
export function slamContactDistance(
  layout: BattleLayout,
  enemyHeight: number,
  petFrontRatio?: number,
): number {
  if (
    petFrontRatio === undefined ||
    !Number.isFinite(petFrontRatio) ||
    petFrontRatio <= 0 ||
    petFrontRatio > 1
  ) {
    return combatContactDistance(layout, enemyHeight);
  }
  const enemyWidth = Math.min(layout.enemyFrameSize, enemyHeight * (51 / 32));
  const enemyFront = layout.enemyFrameSize / 2 - (enemyWidth * 1.12) / 2;
  return layout.petSize * petFrontRatio - enemyFront + 4;
}

/** Keep the midpoint and left/right order while respecting both bodies' contact envelope. */
export function separateCombatants(petX: number, enemyX: number, minimum: number) {
  const correction = Math.max(0, minimum - (enemyX - petX)) / 2;
  return { petX: petX - correction, enemyX: enemyX + correction };
}
