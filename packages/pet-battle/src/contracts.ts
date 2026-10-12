import type { Rarity } from '@pet/core';

export type { Rarity } from '@pet/core';

export type BattleMode = 'FIGHTING' | 'PAUSED';
export type EnemyColor =
  'RED' | 'ORANGE' | 'YELLOW' | 'GREEN' | 'BLUE' | 'INDIGO' | 'PURPLE' | 'RAINBOW';
export type BackgroundTheme = 'MUSHROOM_FOREST' | 'CRYSTAL_RUINS' | 'STARLIGHT_SHRINE';
export type PreviewMenu = 'CLOSED' | 'PET' | 'ENEMY';
export type PetPreviewAction = 'ATTACK' | 'GROWTH';
export type EnemyPreviewAction = 'HIT' | 'DEFEAT' | 'SPAWN' | 'RESET';
export type EnemyPreviewPhase = 'VISIBLE' | 'HIT' | 'DEFEATING' | 'HIDDEN' | 'SPAWNING';
export type EnemyPreviewSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type OverlayPhase = 'FIGHTING' | 'DEFEAT_MOTION' | 'AWAITING_ADVANCE' | 'SPAWNING';
export type CombatBeat = 'IDLE' | 'ANTICIPATION' | 'DASH' | 'IMPACT' | 'RECOVERY';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CombatMotion {
  beat: CombatBeat;
  petOffset: Vec2;
  enemyOffset: Vec2;
  petScale: Vec2;
  enemyScale: Vec2;
  speedLineOpacity: number;
  slashOpacity: number;
  impactFlashOpacity: number;
  afterimageOpacity: number;
}

export interface BattlePet {
  petId: string;
  displayName: string;
  rarity: Rarity;
  level: number;
  sprite: string;
  evolutionStage: 0 | 1 | 2;
  stage: number;
  intervalXp: number;
  battleMode: BattleMode;
}

export interface BattleOverlayState {
  phase: OverlayPhase;
  elapsed: number;
  defeatedStage: number;
  nextStage: number;
}

export interface BattlePreviewState {
  /** Full choreography by default; false selects stationary basic attacks. */
  animationsEnabled?: boolean;
  displayOpacity: number;
  menu: PreviewMenu;
  petAction: PetPreviewAction | null;
  enemyAction: EnemyPreviewAction | null;
  enemyPhase: EnemyPreviewPhase;
  enemySize: EnemyPreviewSize | null;
  enemyColor: EnemyColor | null;
  enemyHpRatio: number | null;
  petAssetRarity: Rarity | null;
  attackEffectRarity: Rarity | null;
  reducedMotion: boolean;
}

export interface BattleState {
  /** Present only when the host supplies the room's live selection client. */
  selectionSource?: 'ROOM';
  growthStatus?: 'LINKED' | 'UNLINKED' | null;
  /** Host-provided shared assets keyed by ownedPetId; absent in standalone previews. */
  petSprites?: Record<string, Record<'idle' | 'attack', { asset: string; frameCount: number }>>;
  activePet: BattlePet | null;
  roster: BattlePet[];
  spectatorPetIds: string[];
  enemyHpRatio: number;
  enemyColor: EnemyColor;
  background: BackgroundTheme;
  overlay: BattleOverlayState | null;
  preview: BattlePreviewState;
  motion?: CombatMotion;
}

export type BattleEvent =
  | {
      type: 'XP_APPLIED';
      petId: string;
      amount: number;
      enemyHpRatio: number;
    }
  | {
      type: 'ENEMY_DEFEATED';
      petId: string;
      defeatedStage: number;
      nextStage: number;
      skippedStages: number;
    }
  | { type: 'MODE_CHANGED'; petId: string; battleMode: BattleMode }
  | { type: 'ACTIVE_PET_CHANGED'; petId: string }
  | {
      type: 'OVERLAY_ADVANCED';
      result: 'NO_TRANSITION' | 'DEFEAT_MOTION_SKIPPED' | 'NEXT_STAGE_STARTED';
    };

export type BattleCommand =
  | {
      type: 'SYNC_OWNED_PETS';
      pets: Array<
        Pick<
          BattlePet,
          'petId' | 'displayName' | 'rarity' | 'level' | 'sprite' | 'evolutionStage'
        > & { totalXp: number | null }
      >;
      activePetId: string | null;
      spectatorPetIds: string[];
      levelXpCosts: number[];
      intervalLevels: Record<Rarity, number>;
      nowMs: number;
    }
  | { type: 'GET_STATE'; nowMs: number }
  | {
      type: 'UPSERT_PET';
      petId: string;
      displayName: string;
      rarity: Rarity;
      level: number;
      sprite: string;
      evolutionStage: 0 | 1 | 2;
    }
  | { type: 'SET_ACTIVE_PET'; petId: string }
  | { type: 'SET_PET_SPECTATORS'; petIds: string[] }
  | { type: 'GROWTH_XP_ADDED'; petId: string; amount: number; nowMs: number }
  | { type: 'TOGGLE_BATTLE' }
  | { type: 'SET_BATTLE_RUNNING'; running: boolean }
  | { type: 'OVERLAY_CLICK'; nowMs: number }
  | { type: 'TOGGLE_MENU'; menu: Exclude<PreviewMenu, 'CLOSED'> }
  | { type: 'PREVIEW_PET'; action: PetPreviewAction; nowMs: number }
  | { type: 'PREVIEW_ENEMY'; action: EnemyPreviewAction; nowMs: number }
  | { type: 'CYCLE_ENEMY_SIZE' }
  | { type: 'CYCLE_ENEMY_COLOR' }
  | { type: 'CYCLE_ENEMY_HP' }
  | { type: 'SET_DISPLAY_OPACITY'; percent: number }
  | { type: 'CYCLE_PET_ASSET' }
  | { type: 'CYCLE_ATTACK_EFFECT' }
  | { type: 'TOGGLE_REDUCED_MOTION' };

export interface BattleResult {
  state: BattleState;
  events: BattleEvent[];
}

export type { BattleGateway } from './ports/battle-gateway.ts';
