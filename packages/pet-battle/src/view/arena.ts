import type { BackgroundTheme } from '../contracts.ts';
import type { BattleLayout, Point } from './layout.ts';
import { combatContactDistance, separateCombatants, slamContactDistance } from './footwork.ts';
import {
  advancePetCombat,
  petCombatAnimation,
  petCombatPose,
  type PetCombatAnimation,
  type PetCombatPose,
} from './pet-combat-animations.ts';
import {
  GroundPursuit,
  PURSUIT_REACTION_MS,
  stillGait,
  type Gait,
  type GroundPair,
} from './pursuit.ts';

export type ArenaPhase =
  | 'IDLE'
  | 'RETREAT'
  | 'CHASE'
  | 'PET_ATTACK'
  | 'PET_RECOVER'
  | 'CROUCH'
  | 'JUMP'
  | 'SLAM'
  | 'RECOVER';
export interface ArenaInput {
  layout: BattleLayout;
  nowMs: number;
  hpRatio: number;
  enemyHeight: number;
  theme: BackgroundTheme;
  key: string | null;
  running: boolean;
  menuOpen?: boolean;
  reducedMotion?: boolean;
  petFrontRatio?: number;
  petSprite?: string | undefined;
  /** Renderer-local request ID; never changes the public Client or real HP. */
  manualAttack?: number | undefined;
  suspended?: boolean;
}
export interface ArenaPose extends Point {
  scaleX: number;
  scaleY: number;
}
export interface ArenaFrame {
  pet: ArenaPose;
  enemy: ArenaPose;
  world: GroundPair & { midpoint: Point };
  camera: Point;
  cameraTarget: Point;
  backgroundOverscan: number;
  phase: ArenaPhase;
  retreating: 'PET' | 'ENEMY' | null;
  attackTurn: 'PET' | 'ENEMY' | null;
  inAttackRange: boolean;
  minimumSeparation: number;
  petAttack: boolean;
  petImpact: boolean;
  petHit: boolean;
  enemyImpact: boolean;
  petStep: number | null;
  enemyStep: number | null;
  petAnimation: PetCombatPose;
  previewing: boolean;
}
interface Exchange {
  elapsed: number;
  origin: GroundPair;
  contact: number;
  slam: number;
  jump: number;
  profile: PetCombatAnimation;
  manual: boolean;
}

/** Ground pursuit and exclusive attack ownership have separate clocks. No XP/HP writes. */
export class ArenaDirector {
  private identity: string | undefined;
  private viewport = '';
  private bounds: ReturnType<typeof terrain> | undefined;
  private lastNow = 0;
  private trackingElapsed = 0;
  private camera: Point = { x: 0, y: 0 };
  private cameraTarget: Point = { x: 0, y: 0 };
  private anchor: Point = { x: 0, y: 0 };
  private history: { at: number; point: Point }[] = [];
  private world: GroundPair = { pet: { x: 0, y: 0 }, enemy: { x: 0, y: 0 } };
  private pursuit: GroundPursuit | undefined;
  private exchange: Exchange | undefined;
  private motionRole: ArenaFrame['retreating'] = null;
  private minimumSeparation = 0;
  private lastWorld: GroundPair | undefined;
  private enemyHeight: number | undefined;
  private reducedMotion = false;
  private lastPreview: number | undefined;
  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  frame(input: ArenaInput): ArenaFrame {
    const now = Number.isFinite(input.nowMs) ? input.nowMs : this.lastNow;
    const profile = petCombatAnimation(input.petSprite);
    const identity = `${input.key ?? ''}:${input.theme}:${profile.id}`;
    const viewport = `${input.layout.width}:${input.layout.height}`;
    const initial = this.identity === undefined;
    const clockChanged = now < this.lastNow || now - this.lastNow > 1500;
    const changed = this.identity !== identity || clockChanged;
    const resized = this.viewport !== viewport;
    const shapeChanged = this.enemyHeight !== undefined && this.enemyHeight !== input.enemyHeight;
    const reducing = Boolean(input.reducedMotion) && !this.reducedMotion;
    const delta = changed ? 0 : Math.max(0, now - this.lastNow);
    const available = input.key !== null && input.hpRatio > 0 && !input.suspended;
    const automatic =
      available && input.running && !input.menuOpen && input.manualAttack === undefined;
    const role =
      input.key === null || !(input.hpRatio > 0) ? null : input.hpRatio > 0.6 ? 'PET' : 'ENEMY';
    const bounds = terrain(input);
    const contact = combatContactDistance(input.layout, input.enemyHeight);
    this.identity = identity;
    this.viewport = viewport;
    this.lastNow = now;
    this.enemyHeight = input.enemyHeight;
    this.reducedMotion = Boolean(input.reducedMotion);
    if (initial) {
      const resting = separateCombatants(
        input.layout.petLeft,
        input.layout.enemyLeft,
        contact + (input.reducedMotion ? 20 : 40),
      );
      const shift = Math.max(
        bounds.left - resting.petX,
        Math.min(0, bounds.right - resting.enemyX),
      );
      this.world = {
        pet: { x: resting.petX + shift, y: bounds.floor },
        enemy: { x: resting.enemyX + shift, y: bounds.floor },
      };
      this.world.pet.x = Math.max(bounds.left, this.world.pet.x);
      this.world.enemy.x = Math.min(bounds.right, this.world.enemy.x);
      this.exchange = undefined;
      this.pursuit = new GroundPursuit(this.world, input.hpRatio, bounds, this.random);
      this.motionRole = role;
      this.minimumSeparation = contact;
      this.lastWorld = undefined;
      this.anchor = { ...this.world.pet };
      this.camera = { x: 0, y: 0 };
      this.cameraTarget = { x: 0, y: 0 };
      this.history = [{ at: this.trackingElapsed, point: this.anchor }];
    } else if (changed || resized || shapeChanged || reducing) {
      // Identity owns stale combat effects, not placement. A viewport change alone
      // keeps the current exchange and pursuit clocks (including the reaction delay).
      const restart = changed || shapeChanged || reducing;
      const current = restart ? (this.lastWorld ?? this.world) : this.world;
      const floorDelta = bounds.floor - this.bounds!.floor;
      const next = refitGround(current, bounds, floorDelta, contact, Boolean(input.reducedMotion));
      if (restart) {
        this.exchange = undefined;
        this.pursuit = new GroundPursuit(next, input.hpRatio, bounds, this.random);
        this.motionRole = role;
        this.minimumSeparation = contact;
        this.lastWorld = structuredClone(next);
      } else {
        this.pursuit!.rebase(current, next);
        if (this.exchange) {
          this.exchange.origin = structuredClone(next);
          this.exchange.jump = Math.min(this.exchange.jump, bounds.jump);
        }
        if (this.lastWorld) {
          for (const actor of ['pet', 'enemy'] as const) {
            this.lastWorld[actor].x += next[actor].x - current[actor].x;
            this.lastWorld[actor].y = clamp(
              this.lastWorld[actor].y + next[actor].y - current[actor].y,
              bounds.top,
              bounds.bottom,
            );
          }
        }
      }
      this.world = next;
      // Move the 500ms camera history with the ground plane; old coordinates must
      // not pull the view back toward the previous viewport after the resize.
      const shift = { x: next.pet.x - current.pet.x, y: next.pet.y - current.pet.y };
      this.anchor = { x: this.anchor.x + shift.x, y: this.anchor.y + shift.y };
      for (const sample of this.history) {
        sample.point.x += shift.x;
        sample.point.y += shift.y;
      }
      if (clockChanged) {
        this.trackingElapsed = 0;
        this.anchor = { x: next.pet.x - this.camera.x, y: next.pet.y - this.camera.y };
        this.history = [{ at: 0, point: { ...next.pet } }];
        this.cameraTarget = { ...this.camera };
      }
    }
    this.bounds = bounds;
    const previewRequested =
      input.manualAttack !== undefined && input.manualAttack !== this.lastPreview;
    this.lastPreview = input.manualAttack;
    const newExchange = (manual: boolean): Exchange => ({
      elapsed: 0,
      origin: structuredClone(this.world),
      contact,
      slam: slamContactDistance(input.layout, input.enemyHeight, input.petFrontRatio),
      jump: bounds.jump,
      profile,
      manual,
    });
    if (previewRequested && available && profile.id !== 'default') {
      this.world = structuredClone(this.lastWorld ?? this.world);
      this.exchange = newExchange(true);
    }
    // A burrow cannot be frozen underground or resumed as a stale slap after STOP.
    if (
      this.exchange?.profile.id !== 'default' &&
      this.exchange &&
      (!available || (this.exchange.manual ? input.manualAttack === undefined : !automatic))
    ) {
      this.world = structuredClone(this.lastWorld ?? this.world);
      this.exchange = undefined;
      this.pursuit = new GroundPursuit(this.world, input.hpRatio, bounds, this.random);
    }
    const active = automatic || Boolean(available && this.exchange?.manual);
    let phase: ArenaPhase = 'IDLE';
    let petGait: Gait = stillGait;
    let enemyGait: Gait = stillGait;
    let attackTurn: ArenaFrame['attackTurn'] = null;
    let petLift = 0;
    let enemyLift = 0;
    let petScale = { scaleX: 1, scaleY: 1 };
    let enemyScale = { scaleX: 1, scaleY: 1 };
    let petImpact = false;
    let petHit = false;
    let enemyImpact = false;
    let shown = structuredClone(this.world);
    let petAnimation = petCombatPose(profile, profile.durationMs, shown.pet, shown.pet);
    if (active) {
      if (this.exchange) {
        this.exchange.elapsed = advancePetCombat(
          this.exchange.profile,
          this.exchange.elapsed,
          previewRequested ? 0 : delta,
        );
        const end = this.exchange.profile.durationMs + (this.exchange.manual ? 0 : 1400);
        if (this.exchange.elapsed >= end) {
          this.world = structuredClone(this.exchange.origin);
          this.exchange = undefined;
          this.pursuit = new GroundPursuit(this.world, input.hpRatio, bounds, this.random);
        }
      }
      if (!this.exchange && automatic) {
        this.motionRole = role;
        this.minimumSeparation = contact;
        const movement = input.reducedMotion
          ? { gait: { pet: stillGait, enemy: stillGait }, leaderMoving: false, elapsed: 1000 }
          : this.pursuit!.frame(this.world, input.hpRatio, delta, bounds, contact);
        petGait = movement.gait.pet;
        enemyGait = movement.gait.enemy;
        phase = movement.leaderMoving ? 'RETREAT' : 'CHASE';
        // A close restart must not cancel the leader's head start before pursuit begins.
        // No minimum travel: at the viewport edge the pair can still engage normally.
        if (inRange(this.world, contact) && movement.elapsed >= PURSUIT_REACTION_MS) {
          this.exchange = newExchange(false);
          petGait = enemyGait = stillGait;
        }
        shown = structuredClone(this.world);
      }
      if (this.exchange) {
        const { elapsed: time, origin, slam, jump, profile: animation } = this.exchange;
        shown = structuredClone(origin);
        const enemyTime = time - animation.durationMs + 750;
        phase =
          time < animation.durationMs
            ? time < animation.recoveryAt
              ? 'PET_ATTACK'
              : 'PET_RECOVER'
            : attackPhase(enemyTime);
        attackTurn = time < animation.durationMs ? 'PET' : 'ENEMY';
        const petContact = animation.id === 'mole' ? slam : contact;
        petAnimation = petCombatPose(
          animation,
          time,
          origin.pet,
          {
            x: Math.max(origin.pet.x, origin.enemy.x - petContact),
            y: animation.id === 'mole' ? origin.enemy.y : origin.pet.y,
          },
          input.reducedMotion,
        );
        shown.pet = { ...petAnimation.position };
        this.minimumSeparation =
          animation.id === 'mole' && attackTurn === 'PET' ? petContact : contact;
        petImpact = petAnimation.impact;
        enemyImpact = enemyTime >= 1450 && enemyTime < 1580;
        petHit = enemyTime >= 1450 && enemyTime < 1730;
        if (!input.reducedMotion) {
          // Short landing recoil belongs to the attack, not a walking return home.
          const leap = smooth(enemyTime, 850, 1450) * (1 - smooth(enemyTime, 1850, 2150));
          shown.enemy.x -= Math.max(0, origin.enemy.x - origin.pet.x - slam) * leap;
          shown.enemy.y += (origin.pet.y - origin.enemy.y) * leap;
          if (attackTurn === 'ENEMY') this.minimumSeparation = contact + (slam - contact) * leap;
          enemyLift =
            enemyTime >= 850 && enemyTime < 1450
              ? jump * Math.sin((Math.PI * (enemyTime - 850)) / 600)
              : 0;
          petLift = petHit ? 2 * Math.sin((Math.PI * (enemyTime - 1450)) / 280) : 0;
          if (phase === 'PET_ATTACK' && animation.id === 'default')
            petScale = { scaleX: 1.04, scaleY: 0.98 };
          if (petHit) petScale = { scaleX: 0.94, scaleY: 1.04 };
          if (phase === 'CROUCH' || enemyImpact) enemyScale = { scaleX: 1.12, scaleY: 0.86 };
          else if (phase === 'JUMP' || phase === 'SLAM')
            enemyScale = { scaleX: 0.94, scaleY: 1.06 };
        }
      } else if (automatic) {
        petLift = petGait.lift * 4;
        enemyLift = enemyGait.lift * 6;
        petScale = {
          scaleX: 1 + petGait.compression * 0.035,
          scaleY: 1 - petGait.compression * 0.045,
        };
        enemyScale = {
          scaleX: 1 + enemyGait.compression * 0.075,
          scaleY: 1 - enemyGait.compression * 0.1,
        };
      }
    } else if (this.lastWorld) shown = structuredClone(this.lastWorld);
    this.lastWorld = structuredClone(shown);
    const center = midpoint(shown, input.layout);
    if (input.key !== null) {
      // Presentation time is independent of the combat clock: finish the delayed
      // follow through attacks, STOP, menus and defeat. Ignore footfall/recoil lift.
      this.trackingElapsed += delta;
      this.history.push({ at: this.trackingElapsed, point: { ...shown.pet } });
      const targetAt = this.trackingElapsed - 500;
      while (this.history.length > 2 && this.history[1]!.at <= targetAt) this.history.shift();
      if (!input.reducedMotion) {
        const first = this.history[0]!;
        const second = this.history[1] ?? first;
        const fraction =
          second.at === first.at ? 0 : clamp((targetAt - first.at) / (second.at - first.at), 0, 1);
        this.cameraTarget = {
          x: first.point.x + (second.point.x - first.point.x) * fraction - this.anchor.x,
          y: first.point.y + (second.point.y - first.point.y) * fraction - this.anchor.y,
        };
        const smoothing = 1 - Math.exp(-delta / 180);
        this.camera = {
          x: this.camera.x + (this.cameraTarget.x - this.camera.x) * smoothing,
          y: this.camera.y + (this.cameraTarget.y - this.camera.y) * smoothing,
        };
      }
    }
    const pet = { ...shown.pet, y: shown.pet.y - petLift, ...petScale };
    const enemy = { ...shown.enemy, y: shown.enemy.y - enemyLift, ...enemyScale };
    this.camera = containCamera(this.camera, pet, enemy, input.layout, bounds);
    return {
      pet: { ...pet, x: pet.x - this.camera.x, y: pet.y - this.camera.y },
      enemy: { ...enemy, x: enemy.x - this.camera.x, y: enemy.y - this.camera.y },
      world: { ...shown, midpoint: center },
      camera: { ...this.camera },
      cameraTarget: { ...this.cameraTarget },
      backgroundOverscan: 32,
      phase,
      retreating: role === null ? null : this.motionRole,
      attackTurn,
      inAttackRange: inRange(shown, contact),
      minimumSeparation: this.minimumSeparation,
      petAttack: attackTurn === 'PET' && phase === 'PET_ATTACK',
      petImpact,
      petHit,
      enemyImpact,
      petStep: petGait.step,
      enemyStep: enemyGait.step,
      petAnimation,
      previewing: Boolean(this.exchange?.manual),
    };
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (time: number, start: number, end: number) => {
  const p = clamp((time - start) / (end - start), 0, 1);
  return p * p * (3 - 2 * p);
};
const inRange = (pair: GroundPair, contact: number) =>
  pair.enemy.x - pair.pet.x - contact <= 24.00001 && Math.abs(pair.enemy.y - pair.pet.y) <= 8;
const midpoint = (pair: GroundPair, layout: BattleLayout): Point => ({
  x: (pair.pet.x + layout.petSize / 2 + pair.enemy.x + layout.enemyFrameSize / 2) / 2,
  y: (pair.pet.y + pair.enemy.y) / 2,
});

function attackPhase(time: number): ArenaPhase {
  if (time < 550) return 'PET_ATTACK';
  if (time < 750) return 'PET_RECOVER';
  if (time < 850) return 'CROUCH';
  if (time < 1300) return 'JUMP';
  if (time < 1550) return 'SLAM';
  return 'RECOVER';
}
function terrain({ layout, theme }: ArenaInput) {
  const scale = Math.max((layout.width + 64) / 1915, (layout.height + 64) / 821);
  const offsetY = (layout.height - 821 * scale) / 2;
  const groundStart = { MUSHROOM_FOREST: 475, CRYSTAL_RUINS: 470, STARLIGHT_SHRINE: 450 }[theme];
  const maximum = Math.min(layout.height - 8, offsetY + 750 * scale);
  const minimum = Math.max(layout.enemyFrameSize * 1.08 + 8, offsetY + groundStart * scale);
  const preferred = Math.max(minimum, offsetY + 540 * scale);
  const floor = clamp(layout.floor, Math.min(preferred, maximum), maximum);
  const room = Math.max(0, floor - minimum);
  const depth = Math.min(24, layout.height * 0.055, room * 0.35);
  const jump = Math.max(0, Math.min(54, room - depth - 4));
  return {
    floor,
    depth,
    jump,
    left: 16,
    right: layout.width - layout.enemyFrameSize - 16,
    top: floor - depth,
    bottom: floor,
    travel: Math.min(60, Math.max(30, 36 + (layout.width - 360) * 0.0375)),
  };
}

/** Preserve screen-side placement and depth below the floor, correcting only unsafe bounds. */
function refitGround(
  current: GroundPair,
  bounds: ReturnType<typeof terrain>,
  floorDelta: number,
  contact: number,
  reducedMotion: boolean,
): GroundPair {
  const next = structuredClone(current);
  if (reducedMotion) {
    const center = (next.pet.x + next.enemy.x) / 2;
    const gap = Math.min(contact + 20, bounds.right - bounds.left);
    next.pet.x = center - gap / 2;
    next.enemy.x = center + gap / 2;
    next.pet.y = next.enemy.y = (current.pet.y + current.enemy.y) / 2;
  } else {
    const separated = separateCombatants(next.pet.x, next.enemy.x, contact);
    next.pet.x = separated.petX;
    next.enemy.x = separated.enemyX;
    if (next.enemy.x - next.pet.x > bounds.right - bounds.left) {
      next.pet.x = bounds.left;
      next.enemy.x = bounds.right;
    }
  }
  const shift = Math.max(bounds.left - next.pet.x, Math.min(0, bounds.right - next.enemy.x));
  for (const actor of ['pet', 'enemy'] as const) {
    next[actor].x += shift;
    next[actor].y = clamp(next[actor].y + floorDelta, bounds.top, bounds.bottom);
  }
  return next;
}

function containCamera(
  camera: Point,
  pet: ArenaPose,
  enemy: ArenaPose,
  layout: BattleLayout,
  bounds: ReturnType<typeof terrain>,
): Point {
  let left = Infinity,
    right = -Infinity;
  const top = bounds.top - bounds.jump - layout.enemyFrameSize * 1.08;
  const bottom = bounds.floor;
  for (const [pose, size] of [
    [pet, layout.petSize],
    [enemy, layout.enemyFrameSize],
  ] as const) {
    left = Math.min(left, pose.x - (size * 0.13) / 2);
    right = Math.max(right, pose.x + size + (size * 0.13) / 2);
  }
  return {
    x: clamp(camera.x, Math.max(-28, right - layout.width + 8), Math.min(28, left - 8)),
    y: clamp(camera.y, Math.max(-28, bottom - layout.height + 8), Math.min(28, top - 8)),
  };
}
