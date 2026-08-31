import type {
  BattleCommand,
  BattleEvent,
  BattleGateway,
  BattleResult,
  BattleState,
  EnemyColor,
  EnemyPreviewSize,
  Rarity,
} from '../contracts.ts';
import { backgroundForEnemy } from '../view/scene.ts';

const COLORS: readonly EnemyColor[] = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
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
    stage: 1,
    intervalXp: 0,
    battleMode: 'FIGHTING',
  },
  roster: [
    {
      petId: 'mio',
      displayName: '미오',
      rarity: 'COMMON',
      stage: 1,
      intervalXp: 0,
      battleMode: 'FIGHTING',
    },
  ],
  enemyHpRatio: 1,
  enemyColor: 'RED',
  background: 'MUSHROOM_FOREST',
  overlay: null,
  preview: {
    assetVersion: 'V1',
    displayOpacity: 1,
    menu: 'CLOSED',
    petAction: null,
    enemyAction: null,
    enemyPhase: 'VISIBLE',
    enemySize: null,
    enemyColor: null,
    enemyHpRatio: null,
    attackEffectRarity: null,
    reducedMotion: false,
  },
});

export class DemoBattleGateway implements BattleGateway {
  readonly #state = initialState();

  async execute(command: BattleCommand): Promise<BattleResult> {
    const events: BattleEvent[] = [];
    switch (command.type) {
      case 'GET_STATE':
      case 'UPSERT_PET':
      case 'GROWTH_XP_ADDED':
        break;
      case 'SET_ACTIVE_PET':
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
        this.#state.preview.petAction = command.action;
        this.#clearPetAction(command.action === 'ATTACK' ? 960 : 780);
        break;
      case 'PREVIEW_ENEMY':
        this.#previewEnemy(command.action);
        break;
      case 'CYCLE_ENEMY_SIZE':
        this.#state.preview.enemySize = cycle(SIZES, this.#state.preview.enemySize ?? 'LARGE');
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
        this.#state.preview.enemyAction = 'HIT';
        this.#state.preview.enemyPhase = 'HIT';
        this.#clearEnemyAction(420);
        break;
      }
      case 'SET_DISPLAY_OPACITY':
        this.#state.preview.displayOpacity = Math.max(0, Math.min(100, command.percent)) / 100;
        break;
      case 'SELECT_ASSET_VERSION':
        this.#state.preview.assetVersion = command.version;
        break;
      case 'CYCLE_ATTACK_EFFECT': {
        const current = this.#state.preview.attackEffectRarity;
        this.#state.preview.attackEffectRarity = current
          ? cycle(RARITIES, current)
          : (this.#state.activePet?.rarity ?? 'COMMON');
        this.#state.preview.petAction = 'ATTACK';
        this.#clearPetAction(960);
        break;
      }
      case 'TOGGLE_REDUCED_MOTION':
        this.#state.preview.reducedMotion = !this.#state.preview.reducedMotion;
        break;
    }
    return { state: structuredClone(this.#state), events };
  }

  #setRunning(running: boolean): void {
    if (this.#state.activePet) {
      this.#state.activePet.battleMode = running ? 'FIGHTING' : 'PAUSED';
    }
  }

  #clearPetAction(delay: number): void {
    window.setTimeout(() => {
      this.#state.preview.petAction = null;
    }, delay);
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
    this.#state.preview.enemyPhase =
      action === 'HIT' ? 'HIT' : action === 'DEFEAT' ? 'DEFEATING' : 'SPAWNING';
    this.#clearEnemyAction(action === 'HIT' ? 420 : action === 'DEFEAT' ? 1_100 : 720);
  }

  #clearEnemyAction(delay: number): void {
    window.setTimeout(() => {
      this.#state.preview.enemyPhase =
        this.#state.preview.enemyAction === 'DEFEAT' ? 'HIDDEN' : 'VISIBLE';
      this.#state.preview.enemyAction = null;
    }, delay);
  }
}

function cycle<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0] ?? current;
}
