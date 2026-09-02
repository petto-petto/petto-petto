import type {
  BackgroundTheme,
  BattleState,
  EnemyColor,
  EnemyPreviewSize,
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
  animated: boolean;
  durationMs: number;
}

export interface BattleScene {
  petAsset: string;
  enemyAsset: string;
  backgroundAsset: string;
  enemyHpRatio: number;
  enemyFace: EnemyFace;
  enemyHeight: number;
  enemyVisible: boolean;
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

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${String(value)}`);
}

export function enemyColorForStage(stage: number): EnemyColor {
  const normalized = Math.max(1, Math.trunc(stage));
  return COLOR_SEQUENCE[(normalized - 1) % COLOR_SEQUENCE.length] ?? 'RED';
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

export function deriveBattleScene(state: BattleState): BattleScene {
  const version = state.preview.assetVersion.toLowerCase();
  const hpRatio = Math.max(0, Math.min(1, state.preview.enemyHpRatio ?? state.enemyHpRatio));
  const face = enemyFaceForHp(hpRatio);
  const enemyColor = state.preview.enemyColor ?? state.enemyColor;
  const background = backgroundForEnemy(enemyColor);
  const rarity = state.preview.attackEffectRarity ?? state.activePet?.rarity ?? 'COMMON';
  const isAttackMotion = state.motion?.beat !== undefined && state.motion.beat !== 'IDLE';
  const isAttacking = state.preview.petAction === 'ATTACK' || isAttackMotion;
  const petAction = isAttacking ? 'attack' : 'idle';
  const petAsset =
    state.preview.assetVersion === 'V1'
      ? `assets/pets/v1/cream-fox-${petAction}.png`
      : `assets/pets/v2/${PET_SLUG[state.activePet?.rarity ?? 'COMMON']}-${petAction}.png`;

  return {
    petAsset,
    enemyAsset: `assets/enemies/${version}/${enemyColor.toLowerCase()}-${face.toLowerCase()}.png`,
    backgroundAsset: `assets/backgrounds/${version}/${BACKGROUND_SLUG[background]}.png`,
    enemyHpRatio: hpRatio,
    enemyFace: face,
    enemyHeight: state.preview.enemySize ? ENEMY_HEIGHT[state.preview.enemySize] : 80,
    enemyVisible: state.preview.enemyPhase !== 'HIDDEN',
    displayOpacity: Math.max(0, Math.min(1, state.preview.displayOpacity)),
    attackEffect: attackEffectForRarity(rarity),
    petSprite: {
      frameCount: state.preview.assetVersion === 'V2' ? (isAttacking ? 6 : 4) : 1,
      animated: state.preview.assetVersion === 'V2' && isAttacking,
      durationMs: isAttacking ? 545 : 667,
    },
  };
}
