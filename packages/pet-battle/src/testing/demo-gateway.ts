import type {
  BattleCommand,
  BattleEvent,
  BattleResult,
  BattleState,
  EnemyColor,
  EnemyPreviewSize,
  Rarity,
} from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import { backgroundForEnemy, enemySizeForStage, visibleEnemyStage } from '../view/scene.ts';
import { restingMotion, sampleCombatMotion } from '../view/motion.ts';

const COLORS: readonly EnemyColor[] = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'INDIGO',
  'PURPLE',
  'RAINBOW',
];
const SIZES: readonly EnemyPreviewSize[] = ['SMALL', 'MEDIUM', 'LARGE'];
const RARITIES: readonly Rarity[] = ['COMMON', 'RARE', 'EPIC'];

const initialState = (): BattleState => ({
  activePet: {
    petId: 'mio',
    displayName: '미오',
    rarity: 'COMMON',
    level: 1,
    sprite: 'mole_digger',
    evolutionStage: 0,
    stage: 1,
    intervalXp: 0,
    battleMode: 'FIGHTING',
  },
  roster: [
    {
      petId: 'mio',
      displayName: '미오',
      rarity: 'COMMON',
      level: 1,
      sprite: 'mole_digger',
      evolutionStage: 0,
      stage: 1,
      intervalXp: 0,
      battleMode: 'FIGHTING',
    },
    {
      petId: 'lumi',
      displayName: '루미',
      rarity: 'RARE',
      level: 8,
      sprite: 'cheek_hamster',
      evolutionStage: 0,
      stage: 1,
      intervalXp: 0,
      battleMode: 'FIGHTING',
    },
    {
      petId: 'nova',
      displayName: '노바',
      rarity: 'EPIC',
      level: 14,
      sprite: 'star_wizard',
      evolutionStage: 1,
      stage: 1,
      intervalXp: 0,
      battleMode: 'FIGHTING',
    },
    {
      petId: 'mori',
      displayName: '모리',
      rarity: 'COMMON',
      level: 4,
      sprite: 'sprout_treant',
      evolutionStage: 0,
      stage: 1,
      intervalXp: 0,
      battleMode: 'FIGHTING',
    },
  ],
  spectatorPetIds: ['lumi', 'nova', 'mori'],
  enemyHpRatio: 1,
  enemyColor: 'RED',
  background: 'MUSHROOM_FOREST',
  overlay: null,
  preview: {
    displayOpacity: 1,
    menu: 'CLOSED',
    petAction: null,
    enemyAction: null,
    enemyPhase: 'VISIBLE',
    enemySize: null,
    enemyColor: null,
    enemyHpRatio: null,
    petAssetRarity: null,
    attackEffectRarity: null,
    reducedMotion: false,
  },
});

export class DemoBattleGateway implements BattleGateway {
  readonly #state = initialState();
  #nowMs = 0;
  #attackStartedAt: number | undefined;
  #petPreviewStartedAt = 0;
  #enemyPreviewStartedAt = 0;

  async execute(command: BattleCommand): Promise<BattleResult> {
    this.#nowMs = 'nowMs' in command ? command.nowMs : Date.now();
    this.#expirePreviews();
    const events: BattleEvent[] = [];
    switch (command.type) {
      case 'GET_STATE':
      case 'UPSERT_PET':
      case 'GROWTH_XP_ADDED':
        break;
      case 'SET_ACTIVE_PET':
        break;
      case 'SET_PET_SPECTATORS':
        this.#state.spectatorPetIds = command.petIds.slice(0, 3);
        break;
      case 'TOGGLE_BATTLE':
        this.#setRunning(this.#state.activePet?.battleMode !== 'FIGHTING');
        break;
      case 'SET_BATTLE_RUNNING':
        this.#setRunning(command.running);
        break;
      case 'OVERLAY_CLICK':
        this.#state.overlay = null;
        break;
      case 'TOGGLE_MENU':
        this.#state.preview.menu =
          this.#state.preview.menu === command.menu ? 'CLOSED' : command.menu;
        break;
      case 'PREVIEW_PET':
        this.#previewPet(command.action);
        break;
      case 'PREVIEW_ENEMY':
        this.#previewEnemy(command.action);
        break;
      case 'CYCLE_ENEMY_SIZE':
        this.#state.preview.enemySize = cycle(
          SIZES,
          this.#state.preview.enemySize ?? enemySizeForStage(visibleEnemyStage(this.#state)),
        );
        break;
      case 'CYCLE_ENEMY_COLOR': {
        const current = this.#state.preview.enemyColor ?? this.#state.enemyColor;
        this.#state.preview.enemyColor = cycle(COLORS, current);
        this.#state.background = backgroundForEnemy(this.#state.preview.enemyColor);
        break;
      }
      case 'CYCLE_ENEMY_HP': {
        const current = this.#state.preview.enemyHpRatio ?? this.#state.enemyHpRatio;
        this.#state.preview.enemyHpRatio = current > 0.7 ? 0.6 : current > 0.35 ? 0.25 : 1;
        this.#previewEnemy('HIT');
        break;
      }
      case 'SET_DISPLAY_OPACITY':
        this.#state.preview.displayOpacity = Math.max(0, Math.min(100, command.percent)) / 100;
        break;
      case 'CYCLE_PET_ASSET': {
        const current =
          this.#state.preview.petAssetRarity ?? this.#state.activePet?.rarity ?? 'COMMON';
        this.#state.preview.petAssetRarity = cycle(RARITIES, current);
        break;
      }
      case 'CYCLE_ATTACK_EFFECT': {
        const current = this.#state.preview.attackEffectRarity;
        this.#state.preview.attackEffectRarity = current
          ? cycle(RARITIES, current)
          : (this.#state.activePet?.rarity ?? 'COMMON');
        this.#previewPet('ATTACK');
        break;
      }
      case 'TOGGLE_REDUCED_MOTION':
        this.#state.preview.reducedMotion = !this.#state.preview.reducedMotion;
        break;
    }
    this.#updateMotion();
    return { state: structuredClone(this.#state), events };
  }

  #setRunning(running: boolean): void {
    if (this.#state.activePet) {
      this.#state.activePet.battleMode = running ? 'FIGHTING' : 'PAUSED';
    }
    this.#attackStartedAt = running ? this.#nowMs : undefined;
    this.#state.preview.petAction = null;
  }

  #previewPet(action: 'ATTACK' | 'GROWTH'): void {
    this.#state.preview.petAction = action;
    this.#petPreviewStartedAt = this.#nowMs;
  }

  #previewEnemy(action: 'HIT' | 'DEFEAT' | 'SPAWN' | 'RESET'): void {
    if (action === 'RESET') {
      this.#state.preview.enemyAction = null;
      this.#state.preview.enemyPhase = 'VISIBLE';
      this.#state.preview.enemySize = null;
      this.#state.preview.enemyColor = null;
      this.#state.preview.enemyHpRatio = null;
      return;
    }
    this.#state.preview.enemyAction = action;
    this.#enemyPreviewStartedAt = this.#nowMs;
    this.#state.preview.enemyPhase =
      action === 'HIT' ? 'HIT' : action === 'DEFEAT' ? 'DEFEATING' : 'SPAWNING';
  }

  #expirePreviews(): void {
    const preview = this.#state.preview;
    const petDuration = preview.petAction === 'ATTACK' ? 960 : 780;
    if (preview.petAction && this.#nowMs - this.#petPreviewStartedAt >= petDuration) {
      preview.petAction = null;
    }
    const enemyDuration =
      preview.enemyAction === 'HIT' ? 420 : preview.enemyAction === 'DEFEAT' ? 1100 : 720;
    if (preview.enemyAction && this.#nowMs - this.#enemyPreviewStartedAt >= enemyDuration) {
      this.#state.preview.enemyPhase =
        this.#state.preview.enemyAction === 'DEFEAT' ? 'HIDDEN' : 'VISIBLE';
      this.#state.preview.enemyAction = null;
    }
  }

  #updateMotion(): void {
    const preview = this.#state.preview;
    const frame = Math.floor(this.#nowMs / 100);
    if (preview.petAction === 'ATTACK') {
      const elapsed = Math.max(0, this.#nowMs - this.#petPreviewStartedAt);
      this.#state.motion = sampleCombatMotion(
        0.43 + (elapsed / 960) * 0.47,
        frame,
        preview.reducedMotion,
      );
      return;
    }
    if (this.#state.activePet?.battleMode === 'FIGHTING') {
      this.#attackStartedAt ??= this.#nowMs;
      const elapsed = Math.max(0, this.#nowMs - this.#attackStartedAt);
      this.#state.motion = sampleCombatMotion(
        0.43 + (elapsed % 2400) / 2400,
        frame,
        preview.reducedMotion,
      );
      return;
    }
    this.#state.motion = restingMotion();
  }
}

function cycle<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0] ?? current;
}
