import type {
  BattleCommand,
  BattleEvent,
  BattlePet,
  BattlePreviewState,
  BattleResult,
  BattleOverlayState,
} from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import { enemyHpRatio, legacyGrowthTarget, progression } from '../domain/battle.ts';
import { sampleCombatMotion } from '../view/motion.ts';
import { backgroundForEnemy, enemyColorForStage, enemySizeForStage } from '../view/scene.ts';

type Sync = Extract<BattleCommand, { type: 'SYNC_OWNED_PETS' }>;
interface Progress extends BattlePet {
  totalXp: number | null;
  target: number | null;
}
interface Transition {
  phase: 'DEFEAT_MOTION' | 'SPAWNING';
  startedAt: number;
  defeatedStage: number;
  nextStage: number;
}
const rarities = ['COMMON', 'RARE', 'EPIC'] as const;
const colors = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'INDIGO', 'PURPLE', 'RAINBOW'] as const;
const sizes = ['SMALL', 'MEDIUM', 'LARGE'] as const;
function next<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length]!;
}
function initialPreview(): BattlePreviewState {
  return {
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
  };
}
function integer(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`invalid ${label}`);
}

/** Authoritative, in-process engine. The host supplies committed growth; no storage or processes. */
export class ElectronBattleEngine implements BattleGateway {
  #pets: Progress[] = [];
  #active: string | null = null;
  #spectators: string[] = [];
  #preview = initialPreview();
  #overlay: Transition | null = null;
  #now = 0;
  #attackStarted: number | null = null;
  #petStarted = 0;
  #enemyStarted = 0;

  #pet(): Progress | undefined {
    return this.#pets.find((pet) => pet.petId === this.#active);
  }
  #hp(pet = this.#pet()): number {
    if (!pet) return 1;
    return enemyHpRatio(pet.intervalXp, pet.target, pet.rarity);
  }
  #reset(preserveOpacity: boolean): void {
    const { displayOpacity, reducedMotion } = this.#preview;
    this.#preview = initialPreview();
    this.#preview.reducedMotion = reducedMotion;
    if (preserveOpacity) this.#preview.displayOpacity = displayOpacity;
  }
  #tick(): void {
    if (this.#overlay?.phase === 'DEFEAT_MOTION' && this.#now >= this.#overlay.startedAt + 1480) {
      this.#overlay.phase = 'SPAWNING';
      this.#overlay.startedAt += 1480;
    }
    if (this.#overlay?.phase === 'SPAWNING' && this.#now >= this.#overlay.startedAt + 720)
      this.#overlay = null;
    const p = this.#preview;
    if (p.petAction && this.#now - this.#petStarted >= (p.petAction === 'ATTACK' ? 960 : 780))
      p.petAction = null;
    if (
      p.enemyAction &&
      this.#now - this.#enemyStarted >=
        (p.enemyAction === 'HIT' ? 420 : p.enemyAction === 'DEFEAT' ? 1100 : 720)
    ) {
      p.enemyPhase = p.enemyAction === 'DEFEAT' ? 'HIDDEN' : 'VISIBLE';
      p.enemyAction = null;
    }
  }
  #conquest(defeatedStage: number, nextStage: number): void {
    if (this.#overlay) this.#overlay.nextStage = Math.max(this.#overlay.nextStage, nextStage);
    else this.#overlay = { phase: 'DEFEAT_MOTION', startedAt: this.#now, defeatedStage, nextStage };
  }
  #anchor(): void {
    if (this.#pet()?.battleMode === 'FIGHTING' && this.#attackStarted === null)
      this.#attackStarted = this.#now;
  }
  #sync(command: Sync, events: BattleEvent[]): void {
    const costs = command.levelXpCosts;
    if (!costs.length || costs.length > 100) throw new Error('invalid growth XP curve');
    for (const cost of costs) integer(cost, 'growth XP curve', 1, 1_000_000);
    for (const rarity of rarities)
      integer(command.intervalLevels[rarity], 'rarity level interval', 1, 100);
    const ids = new Set<string>();
    for (const pet of command.pets) {
      if (!pet.petId || ids.has(pet.petId) || !rarities.includes(pet.rarity))
        throw new Error('invalid pet snapshot');
      ids.add(pet.petId);
      integer(pet.level, 'pet level', 1, 0xffff_ffff);
      integer(pet.evolutionStage, 'evolution stage', 0, 2);
      if (pet.totalXp !== null) integer(pet.totalXp, 'total XP');
    }
    const active = command.activePetId && ids.has(command.activePetId) ? command.activePetId : null;
    const previousActive = this.#active;
    if (previousActive !== active) {
      this.#overlay = null;
      this.#reset(false);
      this.#attackStarted = null;
    }
    const previous = new Map(this.#pets.map((pet) => [pet.petId, pet]));
    this.#pets = command.pets.map((input) => {
      const old = previous.get(input.petId);
      const sameActive = input.petId === active && previousActive === active;
      if (sameActive && old && (old.totalXp === null) !== (input.totalXp === null)) {
        this.#overlay = null;
        this.#reset(true);
      }
      const progress =
        input.totalXp === null
          ? { stage: 1, intervalXp: 0, target: null }
          : progression(input.totalXp, costs);
      const pet: Progress = { ...input, ...progress, battleMode: old?.battleMode ?? 'FIGHTING' };
      if (
        sameActive &&
        old &&
        old.totalXp !== null &&
        input.totalXp !== null &&
        input.totalXp > old.totalXp
      ) {
        if (pet.stage > old.stage) {
          this.#conquest(this.#overlay?.defeatedStage ?? old.stage, pet.stage);
          this.#reset(true);
          events.push({
            type: 'ENEMY_DEFEATED',
            petId: pet.petId,
            defeatedStage: old.stage,
            nextStage: pet.stage,
            skippedStages: pet.stage - old.stage - 1,
          });
        } else
          events.push({
            type: 'XP_APPLIED',
            petId: pet.petId,
            amount: input.totalXp - old.totalXp,
            enemyHpRatio: this.#hp(pet),
          });
      }
      return pet;
    });
    this.#active = active;
    this.#spectators = command.spectatorPetIds
      .filter((id) => id !== active && ids.has(id))
      .slice(0, 3);
    this.#anchor();
  }

  async execute(command: BattleCommand): Promise<BattleResult> {
    if ('nowMs' in command) {
      integer(command.nowMs, 'time');
      this.#now = command.nowMs;
    }
    this.#tick();
    const events: BattleEvent[] = [];
    const p = this.#preview;
    switch (command.type) {
      case 'SYNC_OWNED_PETS':
        this.#sync(command, events);
        break;
      case 'GET_STATE':
        this.#anchor();
        break;
      case 'UPSERT_PET': {
        integer(command.level, 'pet level', 0, 0xffff_ffff);
        integer(command.evolutionStage, 'evolution stage', 0, 2);
        const old = this.#pets.find((pet) => pet.petId === command.petId);
        const { type: _, ...input } = command;
        if (old) Object.assign(old, input, { level: Math.max(1, input.level) });
        else {
          this.#pets.push({
            ...input,
            level: Math.max(1, input.level),
            stage: 1,
            intervalXp: 0,
            battleMode: 'FIGHTING',
            totalXp: null,
            target: null,
          });
          if (this.#active === null) {
            this.#active = input.petId;
            events.push({ type: 'ACTIVE_PET_CHANGED', petId: input.petId });
          }
        }
        break;
      }
      case 'SET_ACTIVE_PET':
        this.#overlay = null;
        this.#reset(false);
        if (this.#pets.some((pet) => pet.petId === command.petId)) {
          this.#active = command.petId;
          events.push({ type: 'ACTIVE_PET_CHANGED', petId: command.petId });
        }
        break;
      case 'SET_PET_SPECTATORS':
        this.#spectators = command.petIds.slice(0, 3);
        break;
      case 'GROWTH_XP_ADDED': {
        integer(command.amount, 'growth XP');
        const pet = this.#pets.find((pet) => pet.petId === command.petId);
        if (!pet) break;
        const target = legacyGrowthTarget(pet.rarity);
        const total = pet.intervalXp + command.amount;
        integer(total, 'growth XP');
        const conquered = Math.floor(total / target);
        pet.intervalXp = total % target;
        if (conquered) {
          const defeatedStage = pet.stage;
          pet.stage = Math.min(0xffff_ffff, pet.stage + conquered);
          this.#conquest(defeatedStage, pet.stage);
          events.push({
            type: 'ENEMY_DEFEATED',
            petId: pet.petId,
            defeatedStage,
            nextStage: pet.stage,
            skippedStages: conquered - 1,
          });
        } else
          events.push({
            type: 'XP_APPLIED',
            petId: pet.petId,
            amount: command.amount,
            enemyHpRatio: this.#hp(pet),
          });
        break;
      }
      case 'TOGGLE_BATTLE':
      case 'SET_BATTLE_RUNNING': {
        const pet = this.#pet();
        const running =
          command.type === 'TOGGLE_BATTLE' ? pet?.battleMode !== 'FIGHTING' : command.running;
        if (pet && (pet.battleMode === 'FIGHTING') !== running) {
          pet.battleMode = running ? 'FIGHTING' : 'PAUSED';
          events.push({ type: 'MODE_CHANGED', petId: pet.petId, battleMode: pet.battleMode });
        }
        this.#attackStarted = running ? this.#now : null;
        break;
      }
      case 'OVERLAY_CLICK':
        if (this.#overlay?.phase === 'DEFEAT_MOTION') {
          this.#overlay.phase = 'SPAWNING';
          this.#overlay.startedAt = this.#now;
          events.push({ type: 'OVERLAY_ADVANCED', result: 'DEFEAT_MOTION_SKIPPED' });
        }
        break;
      case 'TOGGLE_MENU':
        p.menu = p.menu === command.menu ? 'CLOSED' : command.menu;
        break;
      case 'PREVIEW_PET':
        p.petAction = command.action;
        this.#petStarted = this.#now;
        break;
      case 'PREVIEW_ENEMY':
        if (command.action === 'RESET') {
          p.enemySize = null;
          p.enemyColor = null;
          p.enemyHpRatio = null;
          p.enemyAction = null;
          p.enemyPhase = 'VISIBLE';
        } else {
          p.enemyAction = command.action;
          this.#enemyStarted = this.#now;
          p.enemyPhase =
            command.action === 'HIT'
              ? 'HIT'
              : command.action === 'DEFEAT'
                ? 'DEFEATING'
                : 'SPAWNING';
        }
        break;
      case 'CYCLE_ENEMY_SIZE':
        p.enemySize = next(sizes, p.enemySize ?? enemySizeForStage(this.#visualStage()));
        break;
      case 'CYCLE_ENEMY_COLOR':
        p.enemyColor = next(colors, p.enemyColor ?? enemyColorForStage(this.#pet()?.stage ?? 1));
        break;
      case 'CYCLE_ENEMY_HP': {
        const hp = p.enemyHpRatio ?? this.#hp();
        p.enemyHpRatio = hp > 0.7 ? 0.6 : hp > 0.35 ? 0.25 : 1;
        break;
      }
      case 'SET_DISPLAY_OPACITY':
        integer(command.percent, 'opacity', 0, 255);
        p.displayOpacity = Math.min(100, command.percent) / 100;
        break;
      case 'CYCLE_PET_ASSET':
        p.petAssetRarity = next(rarities, p.petAssetRarity ?? this.#pet()?.rarity ?? 'COMMON');
        break;
      case 'CYCLE_ATTACK_EFFECT':
        p.attackEffectRarity =
          p.attackEffectRarity === null
            ? (this.#pet()?.rarity ?? 'COMMON')
            : next(rarities, p.attackEffectRarity);
        p.petAction = 'ATTACK';
        this.#petStarted = this.#now;
        break;
      case 'TOGGLE_REDUCED_MOTION':
        p.reducedMotion = !p.reducedMotion;
        break;
      default: {
        const exhaustive: never = command;
        throw new Error(`Unknown battle command: ${String(exhaustive)}`);
      }
    }
    return this.#result(events);
  }
  #visualStage(): number {
    return this.#overlay
      ? this.#overlay.phase === 'SPAWNING'
        ? this.#overlay.nextStage
        : this.#overlay.defeatedStage
      : (this.#pet()?.stage ?? 1);
  }
  #result(events: BattleEvent[]): BattleResult {
    const pet = this.#pet();
    const p = this.#preview;
    const overlay: BattleOverlayState | null = this.#overlay && {
      phase: this.#overlay.phase,
      elapsed: Math.max(0, this.#now - this.#overlay.startedAt) / 1000,
      defeatedStage: this.#overlay.defeatedStage,
      nextStage: this.#overlay.nextStage,
    };
    const enemyColor = (!overlay && p.enemyColor) || enemyColorForStage(this.#visualStage());
    const hp =
      overlay?.phase === 'DEFEAT_MOTION'
        ? 0
        : overlay
          ? this.#hp()
          : (p.enemyHpRatio ?? this.#hp());
    const phase =
      p.petAction === 'ATTACK'
        ? 0.43 + Math.max(0, Math.min(1, (this.#now - this.#petStarted) / 960)) * 0.47
        : pet?.battleMode === 'FIGHTING' && !overlay
          ? (0.43 + (Math.max(0, this.#now - (this.#attackStarted ?? this.#now)) % 2400) / 2400) % 1
          : 0;
    const publicPet = ({ totalXp, target, ...value }: Progress) => ({
      ...value,
      syncedTotalXp: totalXp,
      growthTargetXp: target,
    });
    return structuredClone({
      state: {
        activePet: pet ? publicPet(pet) : null,
        roster: this.#pets.map(publicPet),
        spectatorPetIds: this.#spectators,
        enemyHpRatio: hp,
        enemyColor,
        background: backgroundForEnemy(enemyColor),
        overlay,
        preview: p,
        motion: sampleCombatMotion(phase, Math.floor(this.#now / 100), p.reducedMotion),
      },
      events,
    });
  }
}
