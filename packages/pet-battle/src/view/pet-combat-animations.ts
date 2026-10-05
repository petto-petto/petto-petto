import type { Point } from './layout.ts';

export type PetCombatPhase =
  | 'IDLE'
  | 'STRIKE'
  | 'RECOVER'
  | 'DIG'
  | 'TUNNEL'
  | 'EMERGE'
  | 'WINDUP'
  | 'SLAP'
  | 'DIVE'
  | 'RETURN'
  | 'RESURFACE'
  | 'SETTLE'
  | 'ROOT_WINDUP'
  | 'ROOT_STRIKE'
  | 'ROOT_RETRACT'
  | 'LEAF_SETTLE';
export interface PetCombatAnimation {
  readonly id: 'default' | 'mole' | 'sprout';
  readonly durationMs: number;
  readonly recoveryAt: number;
  readonly beats: readonly (readonly [number, number])[];
}
export interface PetCombatPose {
  id: PetCombatAnimation['id'];
  phase: PetCombatPhase;
  position: Point;
  burrow: number;
  dust: number;
  dirtStep: number;
  hand: 'LEFT' | null;
  handSwing: number;
  impact: boolean;
  rootReach: number;
  leafBurst: number;
  bodyDip: number;
  spriteProgress: number;
}

const DEFAULT: PetCombatAnimation = {
  id: 'default',
  durationMs: 750,
  recoveryAt: 550,
  beats: [
    [0, 250],
    [250, 390],
    [550, 750],
  ],
};
const MOLE: PetCombatAnimation = {
  id: 'mole',
  durationMs: 2320,
  recoveryAt: 1240,
  beats: [
    [0, 260],
    [260, 660],
    [660, 920],
    [920, 1080],
    [1080, 1200],
    [1240, 1500],
    [1500, 1900],
    [1900, 2160],
    [2160, 2320],
  ],
};
const SPROUT: PetCombatAnimation = {
  id: 'sprout',
  durationMs: 1000,
  recoveryAt: 550,
  beats: [
    [0, 200],
    [200, 250],
    [250, 390],
    [390, 550],
    [550, 780],
    [780, 1000],
  ],
};
const PROFILES: Readonly<Record<string, PetCombatAnimation>> = {
  mole_digger: MOLE,
  sprout_treant: SPROUT,
};

/** Species IDs from PetClient, never a nickname, owned ID or rarity. */
export function petCombatAnimation(species?: string): PetCombatAnimation {
  return (species && Object.hasOwn(PROFILES, species) ? PROFILES[species] : undefined) ?? DEFAULT;
}

/** Keep visible beats and contact even when a rendering frame arrives late. */
export function advancePetCombat(
  profile: PetCombatAnimation,
  elapsed: number,
  delta: number,
): number {
  const next = elapsed + Math.max(0, delta);
  const end = profile.durationMs;
  const beats = [
    ...profile.beats,
    [end, end + 100],
    [end + 100, end + 550],
    [end + 700, end + 830],
    [end + 830, end + 1100],
    [end + 1100, end + 1400],
  ];
  for (const [start, finish] of beats) if (elapsed < start! && next >= finish!) return start!;
  return next;
}

/** Pure choreography shared by automatic combat and the one-shot preview. */
export function petCombatPose(
  profile: PetCombatAnimation,
  elapsed: number,
  origin: Point,
  target: Point,
  reducedMotion = false,
): PetCombatPose {
  const t = Math.max(0, elapsed);
  const pose: PetCombatPose = {
    id: profile.id,
    phase: 'IDLE',
    position: { ...origin },
    burrow: 0,
    dust: 0,
    dirtStep: Math.floor(t / 70) % 4,
    hand: null,
    handSwing: 0,
    impact: false,
    rootReach: 0,
    leafBurst: 0,
    bodyDip: 0,
    spriteProgress: 0,
  };
  if (t >= profile.durationMs) return pose;
  if (profile.id === 'sprout') {
    pose.phase =
      t < 200 ? 'ROOT_WINDUP' : t < 550 ? 'ROOT_STRIKE' : t < 780 ? 'ROOT_RETRACT' : 'LEAF_SETTLE';
    // Same contact window as the common attack; roots and leaves never grant XP.
    pose.impact = t >= 250 && t < 390;
    if (!reducedMotion) {
      pose.rootReach = smooth(t, 200, 250) * (1 - smooth(t, 550, 780));
      pose.leafBurst = t >= 250 ? 1 - smooth(t, 250, 550) : 0;
      pose.bodyDip =
        smooth(t, 0, 200) * (1 - smooth(t, 250, 550)) -
        Math.sin(Math.PI * smooth(t, 780, 1000)) * 0.5;
      pose.spriteProgress = smooth(t, 0, 550) * (1 - smooth(t, 650, 1000));
    }
    return pose;
  }
  if (profile.id === 'default') {
    pose.phase = t < 550 ? 'STRIKE' : 'RECOVER';
    pose.impact = t >= 250 && t < 390;
    if (!reducedMotion)
      pose.position.x += (target.x - origin.x) * smooth(t, 0, 200) * (1 - smooth(t, 400, 650));
    return pose;
  }
  let travel = 0;
  if (t < 260) {
    pose.phase = 'DIG';
    pose.burrow = smooth(t, 0, 260);
  } else if (t < 660) {
    pose.phase = 'TUNNEL';
    pose.burrow = 1;
    travel = smooth(t, 260, 660);
  } else if (t < 920) {
    pose.phase = 'EMERGE';
    pose.burrow = 1 - smooth(t, 660, 920);
    travel = 1;
  } else if (t < 1080) {
    pose.phase = 'WINDUP';
    travel = 1;
  } else if (t < 1240) {
    pose.phase = 'SLAP';
    travel = 1;
  } else if (t < 1500) {
    pose.phase = 'DIVE';
    pose.burrow = smooth(t, 1240, 1500);
    travel = 1;
  } else if (t < 1900) {
    pose.phase = 'RETURN';
    pose.burrow = 1;
    travel = 1 - smooth(t, 1500, 1900);
  } else if (t < 2160) {
    pose.phase = 'RESURFACE';
    pose.burrow = 1 - smooth(t, 1900, 2160);
  } else pose.phase = 'SETTLE';
  pose.position = {
    x: origin.x + (target.x - origin.x) * travel,
    y: origin.y + (target.y - origin.y) * travel,
  };
  pose.dust = pose.burrow > 0 ? (pose.burrow === 1 ? 0.65 : 1) : 0;
  pose.impact = t >= 1080 && t < 1200;
  if (t >= 920 && t < 1240) {
    pose.hand = 'LEFT';
    pose.handSwing = smooth(t, 980, 1080) * (1 - smooth(t, 1140, 1240));
  }
  if (reducedMotion) {
    pose.position = { ...origin };
    pose.burrow = pose.dust = pose.handSwing = 0;
    pose.hand = pose.impact ? 'LEFT' : null;
  }
  return pose;
}

export interface SproutPixel {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Integer pixel stamps on the visible ground lane. Evolution only enriches the art. */
export function sproutRootPixels(
  pose: PetCombatPose,
  start: Point,
  target: Point,
  evolution: number,
  pixelSize: number,
): SproutPixel[] {
  if (pose.id !== 'sprout' || pose.rootReach <= 0) return [];
  const unit = Math.max(1, Math.round(pixelSize));
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const pixels: SproutPixel[] = [];
  const stamp = (x: number, y: number, width: number, height: number, color: string) => {
    pixels.push({
      x: Math.round(x / unit) * unit,
      y: Math.round(y / unit) * unit,
      width: width * unit,
      height: height * unit,
      color,
    });
  };
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const count = Math.max(1, Math.ceil(distance / unit));
  const reach = Math.floor(count * pose.rootReach);
  for (let i = 0; i <= reach; i++) {
    const p = i / count;
    const x = start.x + (target.x - start.x) * p;
    const y = start.y + (target.y - start.y) * p + Math.sin(p * Math.PI * 4) * unit;
    stamp(x, y - unit, 3, 3, '#2c2438');
    stamp(x, y - unit, 2, 2, '#8b6a4a');
    stamp(x, y - unit, 1, 1, '#a5763f');
    if (stage > 0 && i > 0 && i % Math.max(4, Math.floor(count / (stage + 2))) === 0) {
      stamp(x, y - 3 * unit, 1, 3, '#2c2438');
      stamp(x + unit, y - 2 * unit, 1, 2, '#8b6a4a');
    }
  }
  if (pose.leafBurst > 0) {
    const flight = 1 - pose.leafBurst;
    for (let i = 0; i < 2 + stage * 2; i++) {
      const direction = i % 2 === 0 ? -1 : 1;
      const x = target.x + direction * (2 + flight * (5 + i)) * unit;
      const y = target.y - (2 + Math.sin(Math.PI * flight) * (5 + i)) * unit;
      stamp(x, y, 3, 2, '#2c2438');
      stamp(x, y, 2, 1, '#6fb03a');
    }
  }
  return pixels;
}

function smooth(time: number, start: number, end: number): number {
  const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

/** Ground decorations share the same clock as the species choreography. */
export function petCombatDecorations(pose: PetCombatPose, size: number) {
  return {
    burrowDepth: Math.round(pose.burrow * size),
    shadow: 1 - pose.burrow,
    dirtY: -3 - pose.dirtStep * 3,
    handVisible: pose.hand === 'LEFT',
  };
}

/** Audited first-idle-frame pixels, not a newly drawn glove. Pet-left = viewer-right.
 * The body's x22 outline stays intact; two shoulder pixels can overlap the joint.
 */
function nativeLeftArm(x: number, y: number, stage: number): boolean {
  if (stage !== 2) return x >= 23 && x <= (stage === 1 ? 28 : 25) && y >= 17 && y <= 20;
  if (y >= 2 && y <= 14) return x >= 24 && x <= 29;
  return y >= 15 && y <= 18 && x >= (y === 15 ? 24 : 23) && x <= 43 - y;
}

/** Compose the original 32px body and rotate ONLY its native arm into a 48×32 frame.
 * Inverse nearest-neighbor sampling preserves the original palette and hard pixels.
 * No new limb colors, stretching, async image clock or mutation of shared assets.
 */
export function moleSlapFrame(
  source: Uint8ClampedArray,
  evolution: number,
  swing: number,
): Uint8ClampedArray {
  if (source.length !== 32 * 32 * 4) throw new Error('Mole slap requires a 32×32 RGBA frame');
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const progress = Math.max(0, Math.min(1, Number.isFinite(swing) ? swing : 0));
  const angle = ((stage === 2 ? 90 : stage === 1 ? -30 : -60) * progress * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const pivot = stage === 2 ? { x: 23.5, y: 17.5 } : { x: 22.5, y: 18.5 };
  const output = new Uint8ClampedArray(48 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 48; x++) {
      const destination = (y * 48 + x) * 4;
      if (x < 32 && !nativeLeftArm(x, y, stage))
        output.set(source.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4), destination);
      const dx = x + 0.5 - pivot.x,
        dy = y + 0.5 - pivot.y;
      const sx = Math.floor(pivot.x + dx * cos + dy * sin);
      const sy = Math.floor(pivot.y - dx * sin + dy * cos);
      const shoulder = sx === 22 && (sy === 17 || sy === 18);
      if (!nativeLeftArm(sx, sy, stage) && !shoulder) continue;
      const pixel = (sy * 32 + sx) * 4;
      if (source[pixel + 3]) output.set(source.subarray(pixel, pixel + 4), destination);
    }
  }
  return output;
}
