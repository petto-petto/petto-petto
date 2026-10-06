import type { PetCombatPose } from './pet-combat-animations.ts';
import type { Point } from './layout.ts';

export interface FoodPixel extends Point {
  width: number;
  height: number;
  color: string;
}

export interface HamsterPlacement {
  x: number;
  foot: number;
  width: number;
  height: number;
}

/** One crouch/hop/recoil/landing, rendered locally so pursuit and camera clocks stay unchanged. */
export function hamsterBodyProjection(
  pose: Pick<PetCombatPose, 'id' | 'bodyDip' | 'chargeHop' | 'shotRecoil'>,
  size: number,
  placement?: HamsterPlacement,
) {
  const neutral = { x: 0, y: 0, scaleX: 1, scaleY: 1, tilt: 0, shadowScale: 1, shadowOpacity: 1 };
  if (pose.id !== 'hamster') return neutral;
  const unit = size / 32;
  const dip = Math.max(0, Math.min(1, pose.bodyDip));
  const hop = Math.max(0, Math.min(1, pose.chargeHop));
  const kick = Math.max(0, Math.min(1, pose.shotRecoil));
  const projection = {
    x: -Math.round(kick * 4) * unit || 0,
    y: -Math.round(hop * 8) * unit || 0,
    scaleX: 1 + (Math.round(dip * 4) + Math.round(hop)) / 32,
    scaleY: 1 + (Math.round(hop) - Math.round(dip * 5)) / 32,
    tilt: -Math.round(kick * 7) || 0,
    shadowScale: 1 + dip * 0.12 - hop * 0.35,
    shadowOpacity: 1 - hop * 0.4,
  };
  if (placement) {
    const angle = (projection.tilt * Math.PI) / 180;
    const corners = [
      [-size / 2, -size],
      [size / 2, -size],
      [-size / 2, 0],
      [size / 2, 0],
    ].map(([x, y]) => ({
      x: x! * projection.scaleX * Math.cos(angle) - y! * projection.scaleY * Math.sin(angle),
      y: x! * projection.scaleX * Math.sin(angle) + y! * projection.scaleY * Math.cos(angle),
    }));
    const centerX = placement.x + size / 2;
    const lowX = Math.ceil((4 - centerX - Math.min(...corners.map((p) => p.x))) / unit) * unit;
    const highX =
      Math.floor((placement.width - 4 - centerX - Math.max(...corners.map((p) => p.x))) / unit) *
      unit;
    const lowY =
      Math.ceil((4 - placement.foot - Math.min(...corners.map((p) => p.y))) / unit) * unit;
    const highY =
      Math.floor(
        (placement.height - 4 - placement.foot - Math.max(...corners.map((p) => p.y))) / unit,
      ) * unit;
    projection.x = Math.max(lowX, Math.min(highX, projection.x));
    projection.y = Math.max(lowY, Math.min(highY, projection.y));
  }
  return projection;
}

/** The fired seed keeps the launch anchor instead of following the subsequent recoil. */
export function hamsterMouthPosition(
  pose: PetCombatPose,
  evolution: number,
  size: number,
  groundOffset: number,
  placement: HamsterPlacement,
): Point {
  const firing =
    pose.phase === 'HAMSTER_FIRE' ||
    pose.phase === 'HAMSTER_BURST' ||
    pose.phase === 'HAMSTER_RECOVER';
  const body = hamsterBodyProjection(
    firing ? { id: 'hamster', bodyDip: 0, chargeHop: 1, shotRecoil: 0 } : pose,
    size,
    placement,
  );
  const mouth = hamsterFace(evolution).mouth;
  const dx = ((mouth.x * size) / 32 - size / 2) * body.scaleX;
  const dy = ((mouth.y * size) / 32 + groundOffset - size) * body.scaleY;
  const angle = (body.tilt * Math.PI) / 180;
  return {
    x: placement.x + size / 2 + body.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: placement.foot + body.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

/** Audited native first-idle-frame face coordinates. Eyes, ears and torso stay fixed. */
export function hamsterFace(evolution: number) {
  const stage = evolution === 1 || evolution === 2 ? evolution : 0;
  return stage === 0
    ? { stage, top: 11, bottom: 15, leftInner: 10, rightInner: 21, mouth: { x: 15, y: 14 } }
    : stage === 1
      ? { stage, top: 13, bottom: 16, leftInner: 10, rightInner: 21, mouth: { x: 15, y: 16 } }
      : { stage, top: 13, bottom: 18, leftInner: 11, rightInner: 22, mouth: { x: 16, y: 17 } };
}

/** Stretch only the cheek edges outward, preserving opaque neighbours such as the stage-3 tail. */
export function hamsterCheekFrame(
  source: Uint8ClampedArray,
  evolution: number,
  puff: number,
  mouthOpen: boolean,
): Uint8ClampedArray {
  if (source.length !== 32 * 32 * 4)
    throw new Error('Hamster cheek motion requires a 32×32 RGBA frame');
  const face = hamsterFace(evolution);
  const growth = Math.round(Math.max(0, Math.min(1, Number.isFinite(puff) ? puff : 0)) * 2);
  const output = new Uint8ClampedArray(source);
  if (growth > 0)
    for (let y = face.top; y <= face.bottom; y++) {
      let left = face.stage === 2 ? [4, 4, 6, 6, 7, 8][y - face.top]! : 0;
      while (left < face.leftInner && source[(y * 32 + left) * 4 + 3] === 0) left++;
      let right = 31;
      while (right > face.rightInner && source[(y * 32 + right) * 4 + 3] === 0) right--;
      for (const side of ['LEFT', 'RIGHT'] as const) {
        const inner = side === 'LEFT' ? face.leftInner : face.rightInner;
        const edge = side === 'LEFT' ? left : right;
        const direction = side === 'LEFT' ? -1 : 1;
        const length = Math.abs(edge - inner) + 1;
        for (let step = 0; step < length + growth; step++) {
          const x = inner + direction * step;
          if (x < 0 || x >= 32) continue;
          const destination = (y * 32 + x) * 4;
          // A grown cheek can approach the curled tail; never replace its original pixels.
          if (step >= length && source[destination + 3] !== 0) continue;
          const sample =
            inner +
            direction * Math.min(length - 1, Math.floor((step * length) / (length + growth)));
          const pixel = (y * 32 + sample) * 4;
          output.set(source.subarray(pixel, pixel + 4), destination);
        }
      }
    }
  if (mouthOpen) {
    for (const [dx, dy, color] of [
      [0, -1, [44, 36, 56, 255]],
      [-1, 0, [44, 36, 56, 255]],
      [1, 0, [44, 36, 56, 255]],
      [0, 1, [44, 36, 56, 255]],
      [0, 0, [255, 240, 210, 255]],
    ] as const)
      output.set(color, ((face.mouth.y + dy) * 32 + face.mouth.x + dx) * 4);
  }
  return output;
}

/** One food seed follows a compact arc. Additional grain dots are decoration, never extra hits. */
export function hamsterFoodPixels(
  pose: PetCombatPose,
  start: Point,
  target: Point,
  evolution: number,
  pixelSize: number,
): FoodPixel[] {
  if (pose.id !== 'hamster') return [];
  const unit = Math.max(1, Math.round(pixelSize));
  const stage = hamsterFace(evolution).stage;
  const pixels: FoodPixel[] = [];
  const stamp = (x: number, y: number, color: string, width = 1, height = 1) =>
    pixels.push({
      x: Math.round(x / unit) * unit,
      y: Math.round(y / unit) * unit,
      width: width * unit,
      height: height * unit,
      color,
    });
  const grain = (x: number, y: number, radius: number) => {
    for (let row = -radius; row <= radius; row++) {
      const half = radius - Math.floor(Math.abs(row) / 2);
      stamp(x - half * unit, y + row * unit, '#2c2438', half * 2 + 1);
      if (half > 0)
        stamp(x - (half - 1) * unit, y + row * unit, row < 0 ? '#fff0d2' : '#ffd166', half * 2 - 1);
    }
    stamp(x, y - unit, '#a5763f', 1, 3);
  };
  if (pose.cheekPuff > 0 && ['HAMSTER_PUFF', 'HAMSTER_HOLD'].includes(pose.phase)) {
    const radius = (8 + stage * 2 + pose.cheekPuff * 2) * unit;
    for (let dot = 0; dot < 6 + stage * 2; dot++) {
      const angle = (dot * Math.PI * 2) / (6 + stage * 2) + pose.cheekPuff * Math.PI * 0.6;
      const x = start.x + Math.cos(angle) * radius;
      const y = start.y - 2 * unit + Math.sin(angle) * radius * 0.65;
      stamp(x, y, dot % 2 ? '#35d6b0' : '#ffd166');
      if (stage > 0 && dot % 3 === 0) {
        stamp(x - unit, y, '#fff0d2', 3);
        stamp(x, y - unit, '#fff0d2', 1, 3);
      }
    }
  }
  if (pose.phase === 'HAMSTER_FIRE' && pose.mouthOpen) {
    const progress = Math.max(0, Math.min(1, pose.foodFlight));
    const x = start.x + (target.x - start.x) * progress;
    const y =
      start.y + (target.y - start.y) * progress - Math.sin(progress * Math.PI) * (4 + stage) * unit;
    for (let trail = 1; trail <= 5 + stage * 2; trail++) {
      const behind = progress - trail * 0.05;
      if (behind <= 0) continue;
      const tx = start.x + (target.x - start.x) * behind;
      const ty =
        start.y + (target.y - start.y) * behind - Math.sin(behind * Math.PI) * (4 + stage) * unit;
      const curl = Math.sin(trail * 1.2) * (2 + stage) * unit;
      stamp(tx, ty + curl, trail % 2 ? '#35d6b0' : '#ffd166', 2);
      if (stage === 2) stamp(tx, ty - 2 * unit, '#fff0d2');
    }
    const radius = Math.min(3 + stage, 1 + Math.floor(progress * (2 + stage) * 4));
    for (let dot = 0; dot < 6 + stage * 2; dot++) {
      const angle = (dot * Math.PI * 2) / (6 + stage * 2) + progress * Math.PI;
      stamp(
        x + Math.cos(angle) * (radius + 2) * unit,
        y + Math.sin(angle) * (radius + 2) * unit,
        dot % 2 ? '#35d6b0' : '#fff0d2',
      );
    }
    if (progress < 0.2) {
      stamp(start.x - 2 * unit, start.y, '#fff0d2', 5);
      stamp(start.x, start.y - 2 * unit, '#ffd166', 1, 5);
    }
    grain(x, y, radius);
  }
  if (pose.foodBurst > 0) {
    const spread = (1 - pose.foodBurst) * (9 + stage * 4) + 2;
    for (let dot = 0; dot < 12 + stage * 4; dot++) {
      const angle = (dot * Math.PI * 2) / (12 + stage * 4);
      stamp(
        target.x + Math.cos(angle) * spread * unit,
        target.y + Math.sin(angle) * spread * unit,
        '#ffd166',
        2,
      );
      stamp(
        target.x + Math.cos(angle + 0.12) * spread * unit * 0.7,
        target.y + Math.sin(angle + 0.12) * spread * unit * 0.7,
        '#35d6b0',
      );
    }
    for (let ray = 0; ray < 8 + stage * 4; ray++) {
      const angle = (ray * Math.PI * 2) / (8 + stage * 4);
      const x = target.x + Math.cos(angle) * spread * unit;
      const y = target.y + Math.sin(angle) * spread * unit;
      stamp(x, y, ray % 3 === 0 ? '#35d6b0' : ray % 2 ? '#ffd166' : '#fff0d2');
      if (stage > 0 && ray % 2 === 0) {
        stamp(x - unit, y, '#fff0d2', 3);
        stamp(x, y - unit, '#fff0d2', 1, 3);
      }
    }
    if (pose.foodBurst > 0.5) {
      stamp(target.x - 2 * unit, target.y, '#fff0d2', 5);
      stamp(target.x, target.y - 2 * unit, '#ffd166', 1, 5);
    }
  }
  return pixels;
}
