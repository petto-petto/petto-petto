import type { Point } from './layout.ts';
import type { WizardSpellPose } from './wizard-combat.ts';
import type { SquirrelSpellPose } from './squirrel-combat.ts';

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
  | 'LEAF_SETTLE'
  | 'ZEBRA_WINDUP'
  | 'ZEBRA_STOMP'
  | 'ZEBRA_APPROACH'
  | 'ZEBRA_WAVE'
  | 'ZEBRA_RECOVER'
  | 'ZEBRA_SETTLE'
  | 'HAMSTER_PUFF'
  | 'HAMSTER_HOLD'
  | 'HAMSTER_FIRE'
  | 'HAMSTER_BURST'
  | 'HAMSTER_RECOVER'
  | 'WIZARD_CHARGE'
  | 'WIZARD_CAST'
  | 'WIZARD_RAIN'
  | 'WIZARD_FINISH'
  | 'WIZARD_BURST'
  | 'WIZARD_RETURN'
  | 'SQUIRREL_SIGN'
  | 'SQUIRREL_DOMAIN'
  | 'SQUIRREL_CLONES'
  | 'SQUIRREL_SEAL'
  | 'SQUIRREL_BURST'
  | 'SQUIRREL_RETURN';
export interface PetCombatAnimation {
  readonly id: 'default' | 'mole' | 'sprout' | 'zebra' | 'hamster' | 'wizard' | 'squirrel';
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
  shockwaveProgress: number;
  hoofLift: number;
  hoofStomp: number;
  frontApproach: number;
  bodyDip: number;
  spriteProgress: number;
  cheekPuff: number;
  mouthOpen: boolean;
  foodFlight: number;
  foodBurst: number;
  chargeHop: number;
  shotRecoil: number;
  wizard: WizardSpellPose | null;
  squirrel: SquirrelSpellPose | null;
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
const ZEBRA: PetCombatAnimation = {
  id: 'zebra',
  durationMs: 1300,
  recoveryAt: 1050,
  beats: [
    [0, 100],
    [100, 160],
    [160, 190],
    [190, 260],
    [260, 360],
    [360, 420],
    [420, 450],
    [450, 520],
    [520, 560],
    [560, 660],
    [660, 800],
    [800, 1050],
    [1050, 1200],
    [1200, 1300],
  ],
};
const HAMSTER: PetCombatAnimation = {
  id: 'hamster',
  durationMs: 1200,
  recoveryAt: 900,
  beats: [
    [0, 280],
    [280, 420],
    [420, 500],
    [500, 720],
    [720, 860],
    [860, 900],
    [900, 1200],
  ],
};
const WIZARD: PetCombatAnimation = {
  id: 'wizard',
  durationMs: 3000,
  recoveryAt: 2500,
  beats: [
    [0, 250],
    [250, 500],
    [500, 720],
    [720, 900],
    [900, 1250],
    [1250, 1600],
    [1600, 1900],
    [1900, 2050],
    [2050, 2200],
    [2200, 2340],
    [2340, 2500],
    [2500, 2800],
    [2800, 3000],
  ],
};
const SQUIRREL: PetCombatAnimation = {
  id: 'squirrel',
  durationMs: 3200,
  recoveryAt: 2600,
  beats: [
    [0, 200],
    [200, 450],
    [450, 700],
    [700, 900],
    [900, 1200],
    [1200, 1550],
    [1550, 1900],
    [1900, 2050],
    [2050, 2300],
    [2300, 2440],
    [2440, 2600],
    [2600, 2900],
    [2900, 3200],
  ],
};
const PROFILES: Readonly<Record<string, PetCombatAnimation>> = {
  mole_digger: MOLE,
  sprout_treant: SPROUT,
  midnight_zebra: ZEBRA,
  cheek_hamster: HAMSTER,
  star_wizard: WIZARD,
  acorn_squirrel: SQUIRREL,
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
    shockwaveProgress: 0,
    hoofLift: 0,
    hoofStomp: 0,
    frontApproach: 0,
    bodyDip: 0,
    spriteProgress: 0,
    cheekPuff: 0,
    mouthOpen: false,
    foodFlight: 0,
    foodBurst: 0,
    chargeHop: 0,
    shotRecoil: 0,
    wizard: null,
    squirrel: null,
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
  if (profile.id === 'zebra') {
    pose.phase =
      t < 100
        ? 'ZEBRA_WINDUP'
        : t < 450
          ? 'ZEBRA_STOMP'
          : t < 660
            ? 'ZEBRA_APPROACH'
            : t < 1050
              ? 'ZEBRA_WAVE'
              : t < 1200
                ? 'ZEBRA_RECOVER'
                : 'ZEBRA_SETTLE';
    // One visual contact after the forward pop; this never writes real HP/XP.
    pose.impact = t >= 660 && t < 800;
    if (!reducedMotion) {
      const leftHoofLiftFirst = heldPulse(t, 0, 100, 160, 190);
      const leftHoofLiftSecond = heldPulse(t, 260, 360, 420, 450);
      pose.hoofLift = Math.max(leftHoofLiftFirst, leftHoofLiftSecond);
      const firstLanding = pulse(t, 190, 205, 260);
      const secondLanding = pulse(t, 450, 465, 520);
      pose.hoofStomp = Math.max(firstLanding, secondLanding);
      pose.frontApproach = heldPulse(t, 450, 520, 560, 660);
      pose.spriteProgress = 0;
      pose.shockwaveProgress = smooth(t, 660, 950) * (1 - smooth(t, 1050, 1250));
    }
    return pose;
  }
  if (profile.id === 'hamster') {
    pose.phase =
      t < 280
        ? 'HAMSTER_PUFF'
        : t < 420
          ? 'HAMSTER_HOLD'
          : t < 720
            ? 'HAMSTER_FIRE'
            : t < 900
              ? 'HAMSTER_BURST'
              : 'HAMSTER_RECOVER';
    pose.impact = t >= 720 && t < 860;
    if (!reducedMotion) {
      pose.bodyDip = heldPulse(t, 0, 140, 180, 260) * 0.75 + pulse(t, 760, 820, 960);
      pose.chargeHop = heldPulse(t, 180, 280, 520, 780);
      pose.shotRecoil = heldPulse(t, 420, 470, 510, 610);
      pose.cheekPuff = smooth(t, 0, 280) * (1 - smooth(t, 420, 500));
      pose.mouthOpen = t >= 280 && t < 780;
      pose.foodFlight = smooth(t, 420, 720);
      pose.foodBurst = t >= 720 ? 1 - smooth(t, 720, 1050) : 0;
    }
    return pose;
  }
  if (profile.id === 'wizard') {
    pose.phase =
      t < 500
        ? 'WIZARD_CHARGE'
        : t < 900
          ? 'WIZARD_CAST'
          : t < 1900
            ? 'WIZARD_RAIN'
            : t < 2200
              ? 'WIZARD_FINISH'
              : t < 2500
                ? 'WIZARD_BURST'
                : 'WIZARD_RETURN';
    pose.impact = t >= 2200 && t < 2340;
    pose.wizard = {
      enabled: !reducedMotion,
      elapsedMs: t,
      charge: reducedMotion ? 0 : smooth(t, 0, 500) * (1 - smooth(t, 2200, 2600)),
      staffRaise: reducedMotion ? 0 : smooth(t, 350, 800) * (1 - smooth(t, 2500, 2850)),
      legSpread: reducedMotion ? 0 : smooth(t, 0, 400) * (1 - smooth(t, 2500, 2900)),
      lift: reducedMotion ? 0 : heldPulse(t, 450, 850, 2350, 2900),
      lean: reducedMotion || t >= 500 ? 0 : Math.sin((t / 500) * Math.PI * 2),
      rain: reducedMotion ? 0 : smooth(t, 900, 1900),
      finisher: reducedMotion ? 0 : smooth(t, 1900, 2200),
      burst: reducedMotion || t < 2200 ? 0 : 1 - smooth(t, 2200, 2800),
      intensity: reducedMotion ? 0 : smooth(t, 0, 700) * (1 - smooth(t, 2600, 3000)),
    };
    return pose;
  }
  if (profile.id === 'squirrel') {
    pose.phase =
      t < 450
        ? 'SQUIRREL_SIGN'
        : t < 900
          ? 'SQUIRREL_DOMAIN'
          : t < 1900
            ? 'SQUIRREL_CLONES'
            : t < 2300
              ? 'SQUIRREL_SEAL'
              : t < 2600
                ? 'SQUIRREL_BURST'
                : 'SQUIRREL_RETURN';
    pose.impact = t >= 2300 && t < 2440;
    pose.squirrel = {
      enabled: !reducedMotion,
      elapsedMs: t,
      brace: reducedMotion
        ? 0
        : heldPulse(t, 0, 180, 260, 450) * 0.8 + pulse(t, 920, 1000, 1160) * 0.75,
      leap: reducedMotion ? 0 : heldPulse(t, 400, 620, 720, 1000),
      dash: reducedMotion ? 0 : heldPulse(t, 680, 800, 860, 1040),
      tailSweep: reducedMotion ? 0 : heldPulse(t, 1800, 2050, 2250, 2550),
      domain: reducedMotion ? 0 : smooth(t, 450, 900) * (1 - smooth(t, 2650, 3100)),
      clones: reducedMotion ? 0 : smooth(t, 650, 900) * (1 - smooth(t, 2300, 2800)),
      seal: reducedMotion ? 0 : smooth(t, 1900, 2300),
      burst: reducedMotion || t < 2300 ? 0 : 1 - smooth(t, 2300, 2950),
      intensity: reducedMotion ? 0 : smooth(t, 0, 700) * (1 - smooth(t, 2800, 3200)),
    };
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

/** Viewer-facing projection only; combat positions and the camera remain anchored. */
export function zebraForwardProjection(pose: PetCombatPose, size: number) {
  const approach = pose.id === 'zebra' ? Math.max(0, Math.min(1, pose.frontApproach)) : 0;
  const growth = Math.round((approach * size * 0.1) / 2) * 2;
  return { scale: 1 + growth / size, offsetY: Math.round(approach * 6) };
}

export interface SproutPixel {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface ZebraPixel {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** Lift only the zebra's anatomical left/front leg; all torso source pixels remain fixed. */
export function zebraHoofFrame(
  source: Uint8ClampedArray,
  evolution: number,
  lift: number,
): Uint8ClampedArray {
  if (source.length !== 32 * 32 * 4)
    throw new Error('Zebra hoof motion requires a 32×32 RGBA frame');
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const bounds =
    stage === 0
      ? { left: 18, right: 21, top: 21, bottom: 24 }
      : stage === 1
        ? { left: 18, right: 21, top: 23, bottom: 26 }
        : { left: 23, right: 26, top: 27, bottom: 30 };
  const amount = Math.max(0, Math.min(1, Number.isFinite(lift) ? lift : 0));
  // Shorten the native leg within its own pixels. A large translated patch
  // crosses into the torso and reads as a flicker instead of a hoof stomp.
  const offsetY = -Math.round(amount * 2);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const insideLeg =
        x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      if (!insideLeg) {
        const pixel = (y * 32 + x) * 4;
        output.set(source.subarray(pixel, pixel + 4), pixel);
      }
    }
  }
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    for (let x = bounds.left; x <= bounds.right; x++) {
      const sourcePixel = (y * 32 + x) * 4;
      if (source[sourcePixel + 3] === 0) continue;
      const targetX = x;
      const targetY = y + offsetY;
      if (targetY < bounds.top || targetY > bounds.bottom) continue;
      const targetPixel = (targetY * 32 + targetX) * 4;
      output.set(source.subarray(sourcePixel, sourcePixel + 4), targetPixel);
    }
  }
  return output;
}

/** A planted, hard-edged pair of hoof beats followed by a striped crescent wave. */
export function zebraShockwavePixels(
  pose: PetCombatPose,
  start: Point,
  target: Point,
  evolution: number,
  pixelSize: number,
): ZebraPixel[] {
  if (pose.id !== 'zebra' || (pose.shockwaveProgress <= 0 && pose.hoofStomp <= 0)) return [];
  const unit = Math.max(1, Math.round(pixelSize));
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const bands = 2 + stage;
  const distance = target.x - start.x;
  const columns = Math.max(1, Math.ceil(distance / unit));
  const front = Math.min(columns, Math.floor(columns * pose.shockwaveProgress));
  const pixels: ZebraPixel[] = [];
  const stamp = (x: number, y: number, color: string, width = 1, height = 1) => {
    pixels.push({
      x: Math.round(x / unit) * unit,
      y: Math.round(y / unit) * unit,
      width: width * unit,
      height: height * unit,
      color,
    });
  };
  if (pose.hoofStomp > 0) {
    const lift = Math.round(pose.hoofStomp * 2) * unit;
    stamp(start.x, start.y - (1 + lift / unit) * unit, '#2c2438', 2);
    stamp(start.x, start.y - (2 + lift / unit) * unit, '#ffd84d', 1, 2);
    stamp(start.x - 2 * unit, start.y - unit, '#e8eef7');
    stamp(start.x + 2 * unit, start.y - unit, '#e8eef7');
  }
  if (pose.shockwaveProgress <= 0 || target.x <= start.x) return pixels;
  for (let band = 0; band < stage + 1; band++) {
    const y = start.y - (band * 2 + 2) * unit;
    for (let column = band * 2; column <= front; column += 5) {
      const x = start.x + (distance * column) / columns;
      const stripe = (Math.floor(column / 5) + band) % 2 === 0;
      stamp(x, y, stripe ? '#e8eef7' : '#4a5b8c', 2);
    }
  }
  if (front > 0) {
    const frontX = start.x + (distance * front) / columns;
    const radius = 12 + stage * 7;
    // Layer a dark outer arc, a blue striped body, and a bright inner rim.
    for (let row = -radius; row <= radius; row++) {
      const curve = Math.floor((row * row) / (radius * 2));
      const y = start.y - (radius + row) * unit;
      const x = frontX - curve * unit;
      const stripe = (Math.abs(row) + Math.floor(pose.shockwaveProgress * 12)) % 3;
      stamp(x - unit, y, '#2c2438', 3);
      stamp(x, y, stripe === 0 ? '#4a5b8c' : '#e8eef7', 1, 1);
      if (Math.abs(row) % 3 === 1) stamp(x, y - unit, '#b9c6e8');
      if (stage > 0 && Math.abs(row) % 4 === 0) stamp(x - 2 * unit, y, '#ffd84d');
    }
    // Offset arcs trail the leading crescent like layered moonlit ripples.
    for (let ripple = 1; ripple < bands; ripple++) {
      const rippleRadius = Math.max(2, radius - ripple * 2);
      for (let row = -rippleRadius; row <= rippleRadius; row += 2) {
        const curve = Math.floor((row * row) / (rippleRadius * 2));
        const x = frontX - (curve + ripple * 3) * unit;
        const y = start.y - (radius + row) * unit;
        stamp(x, y, ripple % 2 ? '#b9c6e8' : '#ffd84d');
      }
    }
    stamp(frontX, start.y - radius * unit, '#ffd84d', 2);
    stamp(frontX, start.y - (radius + 1) * unit, '#e8eef7', 1, 2);
    if (stage === 2) {
      for (let spark = -2; spark <= 2; spark++) {
        if (spark === 0) continue;
        stamp(frontX + spark * 2 * unit, start.y - (radius + 2 + (spark % 2)) * unit, '#ffd84d');
        stamp(frontX + spark * 3 * unit, start.y - (radius - 1) * unit, '#e8eef7');
      }
    }
  }
  return pixels;
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

function pulse(time: number, start: number, peak: number, end: number): number {
  return time <= peak ? smooth(time, start, peak) : 1 - smooth(time, peak, end);
}

function heldPulse(
  time: number,
  start: number,
  peakStart: number,
  peakEnd: number,
  end: number,
): number {
  if (time < peakStart) return smooth(time, start, peakStart);
  if (time <= peakEnd) return 1;
  return 1 - smooth(time, peakEnd, end);
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
