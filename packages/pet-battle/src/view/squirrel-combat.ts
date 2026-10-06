import type { PetCombatPose } from './pet-combat-animations.ts';
import type { Point } from './layout.ts';

export interface SquirrelSpellPose {
  enabled: boolean;
  elapsedMs: number;
  brace: number;
  leap: number;
  dash: number;
  tailSweep: number;
  domain: number;
  clones: number;
  seal: number;
  burst: number;
  intensity: number;
}
export interface ForestPixel extends Point {
  width: number;
  height: number;
  color: string;
}
export interface ForestClone extends Point {
  scale: number;
  alpha: number;
}
export interface SquirrelLayout {
  width: number;
  height: number;
  size: number;
  caster: Point;
  casterFoot: Point;
  target: Point;
  targetFoot: Point;
}
export const squirrelFrameSize = (evolution: number): 32 | 48 => (evolution === 2 ? 48 : 32);

function nativeTail(x: number, y: number, evolution: number): boolean {
  return evolution === 2
    ? (x >= 32 && y >= 14) || (x >= 28 && y >= 36)
    : (x >= 21 && y >= 4) || (x >= 19 && y >= 21);
}

/** A wider native canvas gives the large tail room to sweep without cropping or repainting the face. */
export function squirrelCasterFrame(
  source: Uint8ClampedArray,
  evolution: number,
  sweep: number,
): Uint8ClampedArray {
  const size = squirrelFrameSize(evolution),
    width = size * 1.5;
  if (source.length !== size * size * 4)
    throw new Error(`Squirrel sprite requires ${size}×${size} RGBA pixels`);
  const amount = Math.max(0, Math.min(1, Number.isFinite(sweep) ? sweep : 0));
  const output = new Uint8ClampedArray(width * size * 4);
  const pivot = evolution === 2 ? { x: 30, y: 42 } : { x: 20, y: 25 };
  const angle = (amount * 65 * Math.PI) / 180;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      if (!nativeTail(x, y, evolution) || amount === 0)
        output.set(source.subarray(at, at + 4), (y * width + x) * 4);
    }
  if (amount > 0)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < width; x++) {
        const dx = x + 0.5 - pivot.x,
          dy = y + 0.5 - pivot.y;
        const sx = Math.floor(pivot.x + dx * Math.cos(angle) + dy * Math.sin(angle));
        const sy = Math.floor(pivot.y - dx * Math.sin(angle) + dy * Math.cos(angle));
        if (sx < 0 || sy < 0 || sx >= size || sy >= size || !nativeTail(sx, sy, evolution))
          continue;
        const at = (sy * size + sx) * 4;
        if (source[at + 3]! > 0) output.set(source.subarray(at, at + 4), (y * width + x) * 4);
      }
  return output;
}

/** Shadow clones are visual derivatives, not additional owned pets or damage sources. */
export function squirrelShadowFrame(source: Uint8ClampedArray): Uint8ClampedArray {
  const shadow = new Uint8ClampedArray(source.length);
  for (let p = 0; p < source.length; p += 4) {
    if (source[p + 3] === 0) continue;
    const rim = source[p]! < 70 && source[p + 1]! < 70;
    shadow.set(rim ? [79, 217, 192, 255] : [35, 78, 69, 255], p);
  }
  return shadow;
}

/** Local ninja motion keeps the combat/camera anchor intact; the wider tail also stays inside the window. */
export function squirrelBodyProjection(
  pose: PetCombatPose,
  evolution: number,
  size: number,
  placement?: { x: number; foot: number; width: number; height: number },
) {
  const normal = { x: 0, y: 0, scaleX: 1, scaleY: 1, tilt: 0, shadowScale: 1, shadowOpacity: 1 };
  const spell = pose.squirrel;
  if (pose.id !== 'squirrel' || !spell?.enabled) return normal;
  const unit = size / squirrelFrameSize(evolution),
    dip = Math.min(1, spell.brace);
  const body = {
    x: Math.round(spell.dash * 4) * unit,
    y: -Math.round(spell.leap * ((size / unit) * 0.32)) * unit || 0,
    scaleX: 1 + Math.round(dip * 4) / 32,
    scaleY: 1 - Math.round(dip * 5) / 32,
    tilt: Math.round(-spell.dash * 8 + spell.tailSweep * 6) || 0,
    shadowScale: 1 - spell.leap * 0.4,
    shadowOpacity: 1 - spell.leap * 0.45,
  };
  if (placement) {
    const a = (body.tilt * Math.PI) / 180;
    const right = size / 2 + size * 0.5 * spell.tailSweep;
    const corners = [
      [-size / 2, -size],
      [right, -size],
      [-size / 2, 0],
      [right, 0],
    ].map(([x, y]) => ({
      x: x! * body.scaleX * Math.cos(a) - y! * body.scaleY * Math.sin(a),
      y: x! * body.scaleX * Math.sin(a) + y! * body.scaleY * Math.cos(a),
    }));
    const loX =
      Math.ceil((4 - placement.x - size / 2 - Math.min(...corners.map((p) => p.x))) / unit) * unit;
    const hiX =
      Math.floor(
        (placement.width - 4 - placement.x - size / 2 - Math.max(...corners.map((p) => p.x))) /
          unit,
      ) * unit;
    const loY =
      Math.ceil((4 - placement.foot - Math.min(...corners.map((p) => p.y))) / unit) * unit;
    const hiY =
      Math.floor(
        (placement.height - 4 - placement.foot - Math.max(...corners.map((p) => p.y))) / unit,
      ) * unit;
    body.x = Math.max(loX, Math.min(hiX, body.x));
    body.y = Math.max(loY, Math.min(hiY, body.y));
  }
  return body;
}

/** Full-field forest and crossed acorn blades; the seal closes once at 2300ms. */
export function squirrelForestPixels(
  pose: PetCombatPose,
  evolution: number,
  layout: SquirrelLayout,
) {
  const back: ForestPixel[] = [],
    front: ForestPixel[] = [],
    clones: ForestClone[] = [];
  const spell = pose.squirrel;
  if (pose.id !== 'squirrel' || !spell?.enabled || spell.intensity <= 0)
    return { back, front, clones, dim: 0, bladeCount: 0 };
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  const unit = Math.max(1, Math.round(layout.size / squirrelFrameSize(evolution)));
  const { width, height, caster, casterFoot, target, targetFoot } = layout;
  const stamp = (out: ForestPixel[], x: number, y: number, color: string, w = 1, h = 1) =>
    out.push({
      x: Math.round(x / unit) * unit,
      y: Math.round(y / unit) * unit,
      width: w * unit,
      height: h * unit,
      color,
    });
  const line = (out: ForestPixel[], a: Point, b: Point, color: string, thickness = 1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / unit));
    for (let i = 0; i <= steps; i++)
      stamp(
        out,
        a.x + ((b.x - a.x) * i) / steps,
        a.y + ((b.y - a.y) * i) / steps,
        color,
        thickness,
        thickness,
      );
  };
  const ring = (
    out: ForestPixel[],
    center: Point,
    rx: number,
    ry: number,
    color: string,
    count: number,
    twist = 0,
  ) => {
    for (let i = 0; i < count; i++)
      stamp(
        out,
        center.x + Math.cos((i / count) * Math.PI * 2 + twist) * rx,
        center.y + Math.sin((i / count) * Math.PI * 2 + twist) * ry,
        color,
        2,
      );
  };
  const seed = (out: ForestPixel[], x: number, y: number, color: string, radius = 2) => {
    for (let row = -radius; row <= radius; row++) {
      const half = radius - Math.abs(row);
      stamp(out, x - half * unit, y + row * unit, color, half * 2 + 1);
    }
    stamp(out, x, y, '#ffe9c4');
  };
  const leaf = (out: ForestPixel[], x: number, y: number, color: string, radius = 2) => {
    for (let row = -radius; row <= radius; row++) {
      const half = radius - Math.abs(row);
      stamp(out, x - (half + row) * unit, y + row * unit, color, half * 2 + 1);
    }
    stamp(out, x + unit, y - unit, color === '#ffd84d' ? '#ffe9c4' : '#8fd68a');
  };
  // Roots and branches rise from both borders, leaving the actors and HUD above the forest.
  for (let tree = 0; tree < 4 + stage; tree++) {
    const left = tree % 2 === 0;
    const base = {
      x: left
        ? width * (0.015 + Math.floor(tree / 2) * 0.065)
        : width * (0.985 - Math.floor(tree / 2) * 0.065),
      y: height,
    };
    const tip = {
      x: base.x + (left ? 1 : -1) * width * 0.035,
      y: height - height * (0.65 + (tree % 3) * 0.1) * spell.domain,
    };
    line(back, base, tip, '#10231a', 5);
    line(back, { x: base.x + unit, y: base.y }, tip, '#a5622e', 2);
    for (let branch = 0; branch < 3; branch++) {
      const fraction = (branch + 1) * 0.2;
      const root = {
        x: tip.x + (base.x - tip.x) * fraction,
        y: tip.y + (base.y - tip.y) * fraction,
      };
      const end = {
        x: root.x + (left ? 1 : -1) * width * (0.16 + branch * 0.035) * spell.domain,
        y: root.y - height * 0.08 * spell.domain,
      };
      const canopySize = Math.round((4 + stage) * spell.domain);
      if (canopySize > 0) {
        for (const [dx, dy] of [
          [-3, 1],
          [2, -2],
          [5, 2],
        ])
          leaf(back, end.x + dx! * unit, end.y + dy! * unit, '#10231a', canopySize + 2);
        leaf(back, end.x, end.y - unit, '#1c4a34', canopySize);
        leaf(back, end.x + 3 * unit, end.y - 3 * unit, '#3c7a4a', canopySize - 1);
      }
      line(back, root, end, '#a5622e', 3);
      line(back, root, end, '#4fd9c0');
    }
  }
  const leafCount = 48 + stage * 24;
  for (let i = 0; i < leafCount; i++) {
    const x = (((i * 137 + spell.elapsedMs * (i % 2 ? 0.055 : -0.075)) % width) + width) % width;
    const y = (((i * 83 + spell.elapsedMs * 0.045) % height) + height) % height;
    leaf(back, x, y, i % 3 === 0 ? '#ffd84d' : '#4fd9c0', i % 5 === 0 ? 2 : 1);
  }
  const domainCenter = { x: width * 0.5, y: height * 0.78 };
  for (let layer = 0; layer < 2 + stage; layer++)
    ring(
      back,
      domainCenter,
      width * (0.43 - layer * 0.05) * spell.domain,
      height * (0.14 - layer * 0.016) * spell.domain,
      layer % 2 ? '#a5622e' : '#4fd9c0',
      64 + stage * 16,
      spell.domain * 0.35,
    );
  // A held acorn glyph and trailing scarf accent make the original character read as the caster.
  if (spell.elapsedMs < 900) {
    seed(front, caster.x, caster.y + 8 * unit, '#ffd84d', 2);
    line(
      front,
      { x: caster.x - 4 * unit, y: caster.y },
      { x: caster.x - (6 + spell.leap * 9) * unit, y: caster.y + 4 * unit },
      '#4fd9c0',
      2,
    );
  }
  const cloneCount = 2 + stage,
    cloneScale = 2,
    frame = squirrelFrameSize(evolution);
  if (spell.clones > 0)
    for (let i = 0; i < cloneCount; i++) {
      const center = width * (0.16 + (0.68 * i) / (cloneCount - 1));
      const x = Math.max(
        4,
        Math.min(width - frame * 1.5 * cloneScale - 4, center - (frame * cloneScale) / 2),
      );
      const y = Math.max(
        44,
        height * (0.24 + (i % 2) * 0.25) -
          Math.sin(Math.min(1, (spell.elapsedMs - 650) / 800) * Math.PI) * 12,
      );
      clones.push({ x, y, scale: cloneScale, alpha: spell.clones * (i % 2 ? 0.44 : 0.36) });
    }
  const blade = (point: Point, spin: number) => {
    for (let arm = 0; arm < 4; arm++)
      for (let step = 2; step < 6 + stage; step++) {
        const angle = spin + (arm * Math.PI) / 2;
        stamp(
          front,
          point.x + Math.cos(angle) * step * unit,
          point.y + Math.sin(angle) * step * unit,
          '#4fd9c0',
          2,
        );
      }
    seed(front, point.x, point.y, '#ffd84d', 2 + Math.floor(stage / 2));
    stamp(front, point.x - 2 * unit, point.y - 2 * unit, '#a5622e', 5);
  };
  let bladeCount = 0;
  const shots = 8 + stage * 8;
  for (let i = 0; i < shots; i++) {
    const age = spell.elapsedMs - 900 - (i % 4) * 110 - Math.floor(i / 4) * 35;
    if (age < 0 || age >= 650) continue;
    const clone = clones[i % cloneCount];
    if (!clone) continue;
    const start = {
      x: clone.x + frame * clone.scale * 0.5,
      y: clone.y + frame * clone.scale * 0.55,
    };
    const angle = (i / shots) * Math.PI * 2,
      end = {
        x: target.x + Math.cos(angle) * (10 + stage * 2) * unit,
        y: target.y + Math.sin(angle) * (10 + stage * 2) * unit,
      };
    const progress = age / 650;
    const point = {
      x: start.x + (end.x - start.x) * progress,
      y:
        start.y +
        (end.y - start.y) * progress +
        Math.sin(progress * Math.PI) * ((i % 2 ? 1 : -1) * 4 * unit),
    };
    for (let trail = 1; trail <= 5 + stage; trail++) {
      const p = progress - trail * 0.04;
      if (p < 0) continue;
      stamp(
        front,
        start.x + (end.x - start.x) * p,
        start.y + (end.y - start.y) * p + Math.sin(p * Math.PI) * ((i % 2 ? 1 : -1) * 4 * unit),
        trail % 2 ? '#4fd9c0' : '#ffd84d',
        2,
      );
    }
    blade(point, progress * Math.PI * 2 + i);
    bladeCount++;
  }
  if (spell.elapsedMs >= 1900) {
    const radius = (18 * (1 - spell.seal) + 6) * unit;
    for (let ringIndex = 0; ringIndex < 2 + stage; ringIndex++)
      ring(
        front,
        target,
        radius + ringIndex * 3 * unit,
        radius + ringIndex * 3 * unit,
        ringIndex % 2 ? '#4fd9c0' : '#ffd84d',
        40 + stage * 12,
        spell.seal * 0.7,
      );
    for (let arm = 0; arm < 4; arm++) {
      const angle = (arm * Math.PI) / 2 + spell.seal * 0.7;
      line(
        front,
        {
          x: target.x + Math.cos(angle) * (radius + 8 * unit),
          y: target.y + Math.sin(angle) * (radius + 8 * unit),
        },
        target,
        '#ffd84d',
        2,
      );
    }
    seed(front, target.x, target.y, '#ffd84d', 3 + stage);
    stamp(front, target.x - 4 * unit, target.y - (4 + stage) * unit, '#a5622e', 9);
  }
  if (spell.burst > 0) {
    const spread = (1 - spell.burst) * Math.min(width, height) * 0.32 + 4 * unit;
    for (let i = 0; i < 20 + stage * 8; i++) {
      const angle = (i / (20 + stage * 8)) * Math.PI * 2;
      leaf(
        front,
        target.x + Math.cos(angle) * spread,
        target.y + Math.sin(angle) * spread,
        i % 2 ? '#4fd9c0' : '#ffd84d',
        i % 4 === 0 ? 2 : 1,
      );
    }
    ring(
      front,
      targetFoot,
      width * 0.46 * (1 - spell.burst),
      height * 0.12 * (1 - spell.burst),
      '#ffd84d',
      64 + stage * 16,
    );
  }
  return { back, front, clones, dim: spell.domain * 0.42, bladeCount };
}
