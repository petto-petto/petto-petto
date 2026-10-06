import type { PetCombatPose } from './pet-combat-animations.ts';
import type { Point } from './layout.ts';

export interface WizardSpellPose {
  enabled: boolean;
  elapsedMs: number;
  charge: number;
  staffRaise: number;
  legSpread: number;
  lift: number;
  lean: number;
  rain: number;
  finisher: number;
  burst: number;
  intensity: number;
}
export interface SpellPixel extends Point {
  width: number;
  height: number;
  color: string;
}
export interface WizardLayout {
  width: number;
  height: number;
  size: number;
  caster: Point;
  casterFoot: Point;
  target: Point;
  targetFoot: Point;
}
export const wizardFrameSize = (evolution: number): 32 | 48 => (evolution === 2 ? 48 : 32);

/** Native first-idle pixels, sampled at the real 32/48 frame size. The last form opens its six feet. */
export function wizardCasterFrame(
  source: Uint8ClampedArray,
  evolution: number,
  progress: number,
): Uint8ClampedArray {
  const size = wizardFrameSize(evolution);
  if (source.length !== size * size * 4)
    throw new Error(`Wizard sprite requires ${size}×${size} RGBA pixels`);
  const amount = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const output = new Uint8ClampedArray(source);
  const copyPixel = (sx: number, sy: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const pixel = (sy * size + sx) * 4;
    if (source[pixel + 3]! > 0) output.set(source.subarray(pixel, pixel + 4), (y * size + x) * 4);
  };
  if (evolution === 2 && amount > 0) {
    for (let foot = 0; foot < 6; foot++) {
      const left = 13 + foot * 4;
      for (let y = 42; y <= 44; y++)
        for (let x = left; x <= left + 1; x++)
          output.fill(0, (y * size + x) * 4, (y * size + x + 1) * 4);
    }
    for (let foot = 0; foot < 6; foot++) {
      const left = 13 + foot * 4,
        shift = Math.round(amount * (foot < 3 ? -2 : 2));
      for (let y = 42; y <= 44; y++)
        for (let x = left; x <= left + 1; x++) copyPixel(x, y, x + shift, y);
    }
  } else if (evolution === 1 && amount > 0) {
    for (let y = 10; y <= 25; y++)
      for (let x = 24; x <= 27; x++) output.fill(0, (y * size + x) * 4, (y * size + x + 1) * 4);
    const angle = (amount * 18 * Math.PI) / 180;
    for (let y = 10; y <= 25; y++)
      for (let x = 24; x <= 27; x++) {
        const dx = x - 24,
          dy = y - 20;
        copyPixel(
          x,
          y,
          Math.round(24 + dx * Math.cos(angle) - dy * Math.sin(angle)),
          Math.round(20 + dx * Math.sin(angle) + dy * Math.cos(angle) - amount * 2),
        );
      }
  } else if (evolution !== 1 && evolution !== 2 && amount > 0) {
    // A conjured star wand belongs to battle, never to the shared pet PNG.
    const color = (x: number, y: number, rgba: readonly number[]) => {
      if (x >= 0 && y >= 0 && x < size && y < size) output.set(rgba, (y * size + x) * 4);
    };
    const top = 13 - Math.round(amount * 8);
    for (let y = top; y <= 23; y++) {
      color(25, y, [44, 36, 56, 255]);
      color(26, y, [92, 123, 232, 255]);
    }
    for (const [dx, dy] of [
      [0, -2],
      [-1, -1],
      [0, -1],
      [1, -1],
      [-2, 0],
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
      [0, 2],
    ])
      color(26 + dx!, top + dy!, [255, 197, 61, 255]);
    color(26, top, [245, 236, 216, 255]);
  }
  return output;
}

/** Local projection protects the existing world/camera anchor and all window edges. */
export function wizardBodyProjection(
  pose: PetCombatPose,
  evolution: number,
  size: number,
  placement?: { x: number; foot: number; width: number; height: number },
) {
  const normal = { x: 0, y: 0, scaleX: 1, scaleY: 1, tilt: 0, shadowScale: 1, shadowOpacity: 1 };
  const spell = pose.wizard;
  if (pose.id !== 'wizard' || !spell?.enabled) return normal;
  const unit = size / wizardFrameSize(evolution);
  const brace =
    evolution === 2 && spell.elapsedMs < 500 ? Math.sin((spell.elapsedMs / 500) * Math.PI) : 0;
  const body = {
    x: 0,
    y: -Math.round(spell.lift * ((size / unit) * 0.28)) * unit || 0,
    scaleX: 1 + Math.round(brace * 3) / 48,
    scaleY: 1 - Math.round(brace * 5) / 48,
    tilt: evolution === 2 ? 0 : Math.round(spell.lean * 4) || 0,
    shadowScale: 1 - spell.lift * 0.35,
    shadowOpacity: 1 - spell.lift * 0.45,
  };
  if (placement) {
    const angle = (body.tilt * Math.PI) / 180;
    const corners = [
      [-size / 2, -size],
      [size / 2, -size],
      [-size / 2, 0],
      [size / 2, 0],
    ].map(([x, y]) => ({
      x: x! * body.scaleX * Math.cos(angle) - y! * body.scaleY * Math.sin(angle),
      y: x! * body.scaleX * Math.sin(angle) + y! * body.scaleY * Math.cos(angle),
    }));
    const lowX =
      Math.ceil((4 - placement.x - size / 2 - Math.min(...corners.map((p) => p.x))) / unit) * unit;
    const highX =
      Math.floor(
        (placement.width - 4 - placement.x - size / 2 - Math.max(...corners.map((p) => p.x))) /
          unit,
      ) * unit;
    const lowY =
      Math.ceil((4 - placement.foot - Math.min(...corners.map((p) => p.y))) / unit) * unit;
    const highY =
      Math.floor(
        (placement.height - 4 - placement.foot - Math.max(...corners.map((p) => p.y))) / unit,
      ) * unit;
    body.x = Math.max(lowX, Math.min(highX, body.x));
    body.y = Math.max(lowY, Math.min(highY, body.y));
  }
  return body;
}

/** Bounded deterministic weather. Small meteors never emit contact; the main one arrives at 2200 ms. */
export function wizardSpellPixels(pose: PetCombatPose, evolution: number, layout: WizardLayout) {
  const back: SpellPixel[] = [],
    front: SpellPixel[] = [];
  const spell = pose.wizard;
  if (pose.id !== 'wizard' || !spell?.enabled || spell.intensity <= 0)
    return { back, front, dim: 0, meteorCount: 0 };
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const unit = Math.max(1, Math.round(layout.size / wizardFrameSize(evolution)));
  const { width, height, caster, casterFoot, target, targetFoot } = layout;
  const stamp = (out: SpellPixel[], x: number, y: number, color: string, w = 1, h = 1) =>
    out.push({
      x: Math.round(x / unit) * unit,
      y: Math.round(y / unit) * unit,
      width: w * unit,
      height: h * unit,
      color,
    });
  const star = (out: SpellPixel[], x: number, y: number, radius: number, color: string) => {
    stamp(out, x - radius * unit, y, color, radius * 2 + 1);
    stamp(out, x, y - radius * unit, color, 1, radius * 2 + 1);
    stamp(out, x, y, '#f5ecd8');
  };
  const line = (out: SpellPixel[], a: Point, b: Point, color: string, thickness = 1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / unit));
    for (let s = 0; s <= steps; s++)
      stamp(
        out,
        a.x + ((b.x - a.x) * s) / steps,
        a.y + ((b.y - a.y) * s) / steps,
        color,
        thickness,
      );
  };
  const ring = (
    out: SpellPixel[],
    center: Point,
    rx: number,
    ry: number,
    color: string,
    dots: number,
    angle = 0,
  ) => {
    for (let i = 0; i < dots; i++)
      stamp(
        out,
        center.x + Math.cos((i / dots) * Math.PI * 2 + angle) * rx,
        center.y + Math.sin((i / dots) * Math.PI * 2 + angle) * ry,
        color,
        2,
      );
  };
  // A constellation reaches every quadrant while leaving UI above the effect layers.
  const stars = 32 + stage * 16;
  for (let i = 0; i < stars; i++) {
    const x = 8 + ((i * 173 + 37) % Math.max(1, width - 16)),
      y = 48 + ((i * 97 + 19) % Math.max(1, height - 64));
    star(back, x, y, i % 7 === 0 ? 1 : 0, i % 3 === 0 ? '#ffc53d' : i % 2 ? '#5c7be8' : '#4ce89a');
  }
  const circle = { x: width * 0.5, y: height * 0.27 };
  const radius = Math.min(width * 0.35, height * 0.3) * Math.max(0.1, spell.charge);
  ring(back, circle, radius, radius * 0.42, '#5c7be8', 48 + stage * 16, spell.staffRaise * 0.5);
  ring(
    back,
    circle,
    radius * 0.78,
    radius * 0.33,
    '#ffc53d',
    32 + stage * 12,
    -spell.staffRaise * 0.4,
  );
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + spell.staffRaise * 0.5;
    const b = a + (Math.PI * 2) / 3;
    line(
      back,
      { x: circle.x + Math.cos(a) * radius * 0.65, y: circle.y + Math.sin(a) * radius * 0.27 },
      { x: circle.x + Math.cos(b) * radius * 0.65, y: circle.y + Math.sin(b) * radius * 0.27 },
      '#4b3b99',
    );
  }
  ring(
    front,
    casterFoot,
    (12 + stage * 3) * unit,
    4 * unit,
    '#5c7be8',
    24 + stage * 8,
    spell.staffRaise,
  );
  if (spell.elapsedMs < 1900) {
    const wand = {
      x: caster.x + (stage === 0 ? 10 : stage === 1 ? 11 : 0) * unit,
      y:
        caster.y +
        (stage === 0
          ? -3 - spell.staffRaise * 8
          : stage === 1
            ? -4 - spell.staffRaise * 3
            : -24 - spell.staffRaise * 4) *
          unit,
    };
    star(front, wand.x, wand.y, 2 + stage, '#ffc53d');
    for (let i = 0; i < 4 + stage * 2; i++) {
      const angle = (i / (4 + stage * 2)) * Math.PI * 2 + spell.charge * Math.PI;
      star(
        front,
        wand.x + Math.cos(angle) * (5 + stage) * unit,
        wand.y + Math.sin(angle) * (5 + stage) * unit,
        0,
        '#4ce89a',
      );
    }
    line(front, wand, circle, '#5c7be8');
  }
  const meteor = (center: Point, radius: number, tail: number, large = false) => {
    for (let s = tail; s >= 1; s--) {
      const shade =
        s > tail * 0.7
          ? '#4b3b99'
          : s > tail * 0.4
            ? '#5c7be8'
            : s > tail * 0.15
              ? '#4ce89a'
              : '#ffc53d';
      stamp(
        front,
        center.x - s * unit * 0.35,
        center.y - s * unit,
        shade,
        large ? Math.max(2, Math.round(radius * 0.7)) : 2,
        2,
      );
    }
    for (let row = -radius; row <= radius; row++) {
      const half = radius - Math.floor(Math.abs(row) * 0.65);
      stamp(front, center.x - half * unit, center.y + row * unit, '#ffc53d', half * 2 + 1);
      if (half > 1)
        stamp(front, center.x - (half - 1) * unit, center.y + row * unit, '#f5ecd8', half * 2 - 1);
    }
    star(front, center.x, center.y, 1, '#4ce89a');
  };
  let meteorCount = 0;
  const count = 8 + stage * 8;
  for (let i = 0; i < count; i++) {
    const age = spell.elapsedMs - 900 - (i % 3) * 180 - Math.floor(i / 3) * 25;
    const duration = 720 + (i % 3) * 80;
    if (age < 0 || age >= duration) continue;
    const progress = age / duration;
    const startX = ((i + 0.5) / count) * width;
    const endX = Math.max(8, Math.min(width - 8, startX + (i % 2 ? -1 : 1) * width * 0.1));
    meteor(
      {
        x: startX + (endX - startX) * progress,
        y: -height * 0.12 + (height * (0.72 + (i % 3) * 0.08) + height * 0.12) * progress,
      },
      2 + stage,
      18 + stage * 7,
    );
    meteorCount++;
  }
  if (spell.elapsedMs >= 1900 && spell.elapsedMs < 2200) {
    meteor(
      {
        x: target.x - width * 0.2 * (1 - spell.finisher),
        y: -height * 0.2 + (target.y + height * 0.2) * spell.finisher,
      },
      12 + stage * 3,
      54 + stage * 10,
      true,
    );
  }
  if (spell.burst > 0) {
    const expansion = 1 - spell.burst;
    const blast = (8 + expansion * ((Math.min(width, height) * 0.32) / unit)) * unit;
    for (let layer = 0; layer < 2 + stage; layer++)
      ring(
        front,
        target,
        blast * (1 - layer * 0.15),
        blast * (1 - layer * 0.15),
        layer % 2 ? '#5c7be8' : '#ffc53d',
        40 + stage * 16,
        expansion + layer * 0.1,
      );
    ring(
      front,
      targetFoot,
      width * 0.48 * expansion,
      18 * unit * expansion,
      '#4ce89a',
      64 + stage * 16,
    );
    for (let ray = 0; ray < 16 + stage * 8; ray++) {
      const angle = (ray / (16 + stage * 8)) * Math.PI * 2;
      star(
        front,
        target.x + Math.cos(angle) * blast * 0.85,
        target.y + Math.sin(angle) * blast * 0.85,
        ray % 4 === 0 ? 2 : 1,
        ray % 2 ? '#ffc53d' : '#4ce89a',
      );
    }
  }
  return { back, front, dim: spell.intensity * 0.4, meteorCount };
}
