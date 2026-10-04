import type { Point } from './layout.ts';
import { footstep } from './footwork.ts';

export const stillGait = { step: null, lift: 0, compression: 0 };
export type Gait = { step: number | null; lift: number; compression: number };
type Actor = 'pet' | 'enemy';
export type GroundPair = Record<Actor, Point>;
/** Give the retreat a visible head start without waiting for it to finish. */
export const PURSUIT_REACTION_MS = 600;
export interface GroundBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  travel: number;
  depth: number;
}

/** Independent ground locomotion. Attack ownership/timing belongs to ArenaDirector. */
export class GroundPursuit {
  private clock = 0;
  private walked: Record<Actor, number> = { pet: 0, enemy: 0 };
  private paths: Record<Actor, { wavelength: number; phase: number }>;
  private start: GroundPair;
  private band: number;
  private budget: number;
  private random: () => number;

  constructor(world: GroundPair, hp: number, bounds: GroundBounds, random: () => number) {
    this.start = structuredClone(world);
    this.band = bandOf(hp);
    this.random = random;
    this.budget = bounds.travel * (this.band === 2 ? 1.6 : 1);
    this.paths = {
      pet: { wavelength: 24 + random() * 20, phase: random() * Math.PI * 2 },
      enemy: { wavelength: 26 + random() * 22, phase: random() * Math.PI * 2 },
    };
  }

  /** Move path origins with a resized ground plane, without restarting strides/reaction. */
  rebase(before: GroundPair, after: GroundPair): void {
    for (const actor of ['pet', 'enemy'] as const) {
      this.start[actor].x += after[actor].x - before[actor].x;
      this.start[actor].y += after[actor].y - before[actor].y;
    }
  }

  frame(world: GroundPair, hp: number, delta: number, bounds: GroundBounds, contact: number) {
    if (bandOf(hp) !== this.band) {
      this.band = bandOf(hp);
      this.clock = 0;
      this.start = structuredClone(world);
      this.walked = { pet: 0, enemy: 0 };
      this.budget = bounds.travel * (this.band === 2 ? 1.6 : 1);
      for (const actor of ['pet', 'enemy'] as const)
        this.paths[actor].phase = this.random() * Math.PI * 2;
    }
    const direction = this.band === 0 ? -1 : 1;
    const leader: Actor = this.band === 0 ? 'pet' : 'enemy';
    const follower: Actor = leader === 'pet' ? 'enemy' : 'pet';
    const speeds = { pet: this.band === 2 ? 13 : 34, enemy: [60, 24, 11][this.band]! };
    const periods = { pet: this.band === 2 ? 590 : 460, enemy: [370, 570, 850][this.band]! };
    const before = this.clock;
    this.clock += delta;
    const gait: Record<Actor, Gait> = { pet: stillGait, enemy: stillGait };
    // Independent strides start after a short reaction, not after the leader finishes.
    for (const actor of [leader, follower]) {
      const delay = actor === follower ? PURSUIT_REACTION_MS : 0;
      const elapsed = Math.max(0, this.clock - delay);
      const previous = Math.max(0, before - delay);
      const period = periods[actor];
      const stride = (time: number) => {
        const cycle = Math.floor(time / period);
        return cycle + footstep(time % period, 0, period, 1).progress;
      };
      const distance = ((stride(elapsed) - stride(previous)) * period * speeds[actor]) / 1000;
      const targetX =
        actor === leader
          ? this.start[actor].x + direction * this.budget
          : world[leader].x + (actor === 'pet' ? -(contact + 12) : contact + 12);
      const available = Math.max(0, (targetX - world[actor].x) * direction);
      const horizontal = Math.min(distance, available);
      const nextX = clamp(
        world[actor].x + direction * horizontal,
        actor === 'pet' ? bounds.left : bounds.left + contact,
        actor === 'pet' ? bounds.right - contact : bounds.right,
      );
      const dx = nextX - world[actor].x;
      this.walked[actor] += Math.abs(dx);
      const path = this.paths[actor];
      // Vary curvature independently. A chaser converges on the live target's ground lane.
      const curve =
        Math.sin((this.walked[actor] / path.wavelength) * Math.PI * 2 + path.phase) -
        Math.sin(path.phase);
      const ownDepth = clamp(
        this.start[actor].y + curve * bounds.depth * 0.6,
        bounds.top,
        bounds.bottom,
      );
      const gap = Math.max(0, world.enemy.x - world.pet.x - contact);
      const convergence = actor === follower ? clamp(1 - gap / 72, 0, 1) : 0;
      const targetY = ownDepth * (1 - convergence) + world[leader].y * convergence;
      const dy = clamp(targetY - world[actor].y, -distance * 0.7, distance * 0.7);
      const xMin = actor === 'pet' ? bounds.left : bounds.left + contact;
      const xMax = actor === 'pet' ? bounds.right - contact : bounds.right;
      const canWalkX =
        available > 0.05 && (direction > 0 ? world[actor].x < xMax : world[actor].x > xMin);
      const moving =
        this.clock > delay &&
        (canWalkX ||
          Math.abs(targetY - world[actor].y) > 0.1 ||
          Math.abs(dx) + Math.abs(dy) > 0.000001);
      world[actor] = { x: nextX, y: world[actor].y + dy };
      if (moving) gait[actor] = footstep(elapsed % period, 0, period, 1);
    }
    return { gait, leaderMoving: gait[leader].step !== null, elapsed: this.clock };
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const bandOf = (hp: number) => (hp > 0.6 ? 0 : hp > 0.25 ? 1 : 2);
