import type {
  BackgroundTheme,
  BattleState,
  EnemyColor,
  EnemyPreviewSize,
  EnemyPreviewPhase,
  Rarity,
} from '../contracts.ts';

export type EnemyFace = 'STEADY' | 'WORRIED' | 'EXHAUSTED';

export interface AttackEffectProfile {
  slashCount: number;
  shockwaveCount: number;
  particleCount: number;
}

export interface PetSpriteProfile {
  frameCount: number;
  frameSteps: number;
  animated: boolean;
  durationMs: number;
}

export interface BattleScene {
  petCombatSpecies: string | undefined;
  petAsset: string;
  petIdleAsset: string;
  petAttackAsset: string;
  enemyAsset: string;
  backgroundAsset: string;
  enemyHpRatio: number;
  enemyFace: EnemyFace;
  enemyHeight: number;
  enemyVisible: boolean;
  enemyPhase: EnemyPreviewPhase;
  displayOpacity: number;
  attackEffect: AttackEffectProfile;
  petSprite: PetSpriteProfile;
}

const COLOR_SEQUENCE: readonly EnemyColor[] = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'PURPLE',
  'RAINBOW',
];

const BACKGROUND_SLUG: Record<BackgroundTheme, string> = {
  MUSHROOM_FOREST: 'mushroom-forest',
  CRYSTAL_RUINS: 'crystal-ruins',
  STARLIGHT_SHRINE: 'starlight-shrine',
};

const PET_SLUG: Record<Rarity, string> = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
};

const ENEMY_HEIGHT: Record<EnemyPreviewSize, number> = {
  SMALL: 56,
  MEDIUM: 64,
  LARGE: 80,
};

const SIZE_SEQUENCE: readonly EnemyPreviewSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${String(value)}`);
}

export function enemyColorForStage(stage: number): EnemyColor {
  const normalized = Math.max(1, Math.trunc(stage));
  return COLOR_SEQUENCE[Math.floor((normalized - 1) / 3) % COLOR_SEQUENCE.length] ?? 'RED';
}

export function enemySizeForStage(stage: number): EnemyPreviewSize {
  const normalized = Math.max(1, Math.trunc(stage));
  return SIZE_SEQUENCE[(normalized - 1) % SIZE_SEQUENCE.length] ?? 'SMALL';
}

/** The active pet has already advanced while its defeated enemy is still on screen. */
export function visibleEnemyStage(state: BattleState): number {
  if (state.overlay && state.overlay.phase !== 'FIGHTING') {
    return state.overlay.phase === 'SPAWNING'
      ? state.overlay.nextStage
      : state.overlay.defeatedStage;
  }
  return state.activePet?.stage ?? 1;
}

export function selectRandomPetSpectators<T extends { petId: string }>(
  roster: readonly T[],
  activePetId: string | null,
  random: () => number = Math.random,
): T[] {
  const candidates = roster.filter((pet) => pet.petId !== activePetId);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex]!, candidates[index]!];
  }
  return candidates.slice(0, 3);
}

export function defeatedEnemyColors(currentStage: number): EnemyColor[] {
  const defeatedCount = Math.max(0, Math.trunc(currentStage) - 1);
  return Array.from({ length: Math.min(3, defeatedCount) }, (_, index) =>
    enemyColorForStage(defeatedCount - index),
  );
}

export function backgroundForEnemy(color: EnemyColor): BackgroundTheme {
  switch (color) {
    case 'RED':
    case 'ORANGE':
    case 'YELLOW':
      return 'MUSHROOM_FOREST';
    case 'GREEN':
    case 'BLUE':
    case 'PURPLE':
      return 'CRYSTAL_RUINS';
    case 'RAINBOW':
      return 'STARLIGHT_SHRINE';
  }
  return assertNever(color, 'unknown enemy color');
}

export function enemyFaceForHp(hpRatio: number): EnemyFace {
  if (hpRatio > 0.7) return 'STEADY';
  if (hpRatio > 0.35) return 'WORRIED';
  return 'EXHAUSTED';
}

export function attackEffectForRarity(rarity: Rarity): AttackEffectProfile {
  switch (rarity) {
    case 'COMMON':
      return { slashCount: 1, shockwaveCount: 1, particleCount: 4 };
    case 'RARE':
      return { slashCount: 2, shockwaveCount: 2, particleCount: 8 };
    case 'EPIC':
      return { slashCount: 3, shockwaveCount: 3, particleCount: 12 };
  }
}

export function shouldStartEnemyHitReaction(
  previous: BattleState | undefined,
  next: BattleState,
): boolean {
  const actualImpactStarted = previous?.motion?.beat !== 'IMPACT' && next.motion?.beat === 'IMPACT';
  const previewHitStarted =
    previous?.preview.enemyPhase !== 'HIT' && next.preview.enemyPhase === 'HIT';
  return actualImpactStarted || previewHitStarted;
}

export function deriveBattleScene(state: BattleState, arenaAttacking?: boolean): BattleScene {
  const transitioning = state.overlay !== null;
  const hpRatio = Math.max(
    0,
    Math.min(
      1,
      transitioning ? state.enemyHpRatio : (state.preview.enemyHpRatio ?? state.enemyHpRatio),
    ),
  );
  const face = enemyFaceForHp(hpRatio);
  const enemyColor = transitioning
    ? state.enemyColor
    : (state.preview.enemyColor ?? state.enemyColor);
  const stageSize = enemySizeForStage(visibleEnemyStage(state));
  const enemySize = transitioning ? stageSize : (state.preview.enemySize ?? stageSize);
  const background = backgroundForEnemy(enemyColor);
  const rarity = state.preview.attackEffectRarity ?? state.activePet?.rarity ?? 'COMMON';
  const isAttackMotion = state.motion?.beat !== undefined && state.motion.beat !== 'IDLE';
  const isAttacking =
    !transitioning && (arenaAttacking ?? (state.preview.petAction === 'ATTACK' || isAttackMotion));
  const enemyPhase: EnemyPreviewPhase =
    state.overlay?.phase === 'DEFEAT_MOTION'
      ? 'DEFEATING'
      : state.overlay?.phase === 'AWAITING_ADVANCE'
        ? 'HIDDEN'
        : state.overlay?.phase === 'SPAWNING'
          ? 'SPAWNING'
          : state.preview.enemyPhase;
  const petAction = isAttacking ? 'attack' : 'idle';
  const petAssetRarity = state.preview.petAssetRarity ?? state.activePet?.rarity ?? 'COMMON';
  const sharedSprites =
    state.preview.petAssetRarity === null && state.activePet
      ? state.petSprites?.[state.activePet.petId]
      : undefined;
  const sharedSprite = sharedSprites?.[petAction];
  const petAsset =
    sharedSprite?.asset ?? `assets/pets/v2/${PET_SLUG[petAssetRarity]}-${petAction}.png`;
  const petIdleAsset =
    sharedSprites?.idle.asset ?? `assets/pets/v2/${PET_SLUG[petAssetRarity]}-idle.png`;
  const petAttackAsset =
    sharedSprites?.attack.asset ?? `assets/pets/v2/${PET_SLUG[petAssetRarity]}-attack.png`;
  const frameCount = sharedSprite?.frameCount ?? (isAttacking ? 6 : 4);

  return {
    petCombatSpecies: sharedSprites ? state.activePet?.sprite : undefined,
    petAsset,
    petIdleAsset,
    petAttackAsset,
    enemyAsset: `assets/enemies/v2/${enemyColor.toLowerCase()}-${face.toLowerCase()}.png`,
    backgroundAsset: `assets/backgrounds/v2/${BACKGROUND_SLUG[background]}.png`,
    enemyHpRatio: hpRatio,
    enemyFace: face,
    enemyHeight: ENEMY_HEIGHT[enemySize],
    enemyVisible: state.activePet !== null && enemyPhase !== 'HIDDEN',
    enemyPhase,
    displayOpacity: Math.max(0, Math.min(1, state.preview.displayOpacity)),
    attackEffect: attackEffectForRarity(rarity),
    petSprite: {
      frameCount,
      frameSteps: frameCount - 1,
      animated: isAttacking,
      durationMs: isAttacking ? 545 : 667,
    },
  };
}
