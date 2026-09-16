import type { CombatMotion } from '../contracts.ts';

export function restingMotion(): CombatMotion {
  return {
    beat: 'IDLE',
    petOffset: { x: 0, y: 0 },
    enemyOffset: { x: 0, y: 0 },
    petScale: { x: 1, y: 1 },
    enemyScale: { x: 1, y: 1 },
    speedLineOpacity: 0,
    slashOpacity: 0,
    impactFlashOpacity: 0,
    afterimageOpacity: 0,
  };
}

/** Browser preview of rust/src/presentation/motion.rs; no XP/HP/domain changes here. */
export function sampleCombatMotion(
  phase: number,
  frame: number,
  reducedMotion: boolean,
): CombatMotion {
  phase -= Math.floor(phase);
  const motion = restingMotion();
  if (reducedMotion) {
    if (phase >= 0.63 && phase < 0.7) {
      motion.beat = 'IMPACT';
      motion.slashOpacity = 0.72;
      motion.impactFlashOpacity = 0.28;
    }
    return motion;
  }
  if (phase >= 0.43 && phase < 0.52) {
    const progress = (phase - 0.43) / 0.09;
    const eased = progress * progress * (3 - 2 * progress);
    return {
      ...motion,
      beat: 'ANTICIPATION',
      petOffset: { x: -8 * eased, y: 2 * eased },
      petScale: { x: 1 + 0.1 * eased, y: 1 - 0.12 * eased },
    };
  }
  if (phase >= 0.52 && phase < 0.635) {
    const progress = (phase - 0.52) / 0.115;
    const eased = 1 - (1 - progress) ** 3;
    return {
      ...motion,
      beat: 'DASH',
      petOffset: { x: -8 + 42 * eased, y: -2 * Math.sin(progress * Math.PI) },
      petScale: { x: 0.93, y: 1.06 },
      speedLineOpacity: Math.min(1, progress * 1.35),
      afterimageOpacity: 0.48 * progress,
    };
  }
  if (phase >= 0.635 && phase < 0.7) {
    const progress = (phase - 0.635) / 0.065;
    const shake = frame % 2 === 0 ? 6 : -6;
    return {
      ...motion,
      beat: 'IMPACT',
      petOffset: { x: 34 - progress * 2, y: 0 },
      enemyOffset: { x: shake * (1 - progress * 0.35), y: 1 },
      petScale: { x: 1.08, y: 0.94 },
      enemyScale: { x: 1.15, y: 0.82 },
      slashOpacity: 1 - progress * 0.45,
      impactFlashOpacity: 1 - progress * 0.16,
      afterimageOpacity: 0.3 * (1 - progress),
    };
  }
  if (phase >= 0.7 && phase < 0.8) {
    const progress = (phase - 0.7) / 0.1;
    const remaining = (1 - progress) ** 3;
    return {
      ...motion,
      beat: 'RECOVERY',
      petOffset: { x: 32 * remaining, y: 0 },
      petScale: { x: 1 - 0.04 * remaining, y: 1 + 0.05 * remaining },
      afterimageOpacity: 0.18 * (1 - progress),
    };
  }
  return motion;
}
