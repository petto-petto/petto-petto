export interface Point {
  x: number;
  y: number;
}

export interface BattleLayout {
  width: number;
  height: number;
  petSize: number;
  enemyFrameSize: number;
  scale: number;
  petLeft: number;
  enemyLeft: number;
  floor: number;
  spectatorSize: number;
  attackDistance: number;
  compact: boolean;
}

/** Presentation only: the host owns window size, the engine owns combat timing/state. */
export function battleLayout(width: number, height: number): BattleLayout {
  const petSize = 96;
  const enemyFrameSize = 128;
  const scale = 1;
  const gap = Math.round(Math.max(4, Math.min(16, width / 80)));
  // Narrow windows share the transparent frame margins, never shrink the sprite.
  const separation = Math.min(petSize + gap, Math.max(petSize, width - enemyFrameSize - 32));
  const petLeft = Math.round((width - enemyFrameSize - separation) / 2);
  const enemyLeft = petLeft + separation;
  const preferredFloor = height - Math.round(Math.max(28, Math.min(58, height * 0.14)));
  const floor = Math.min(height - 8, Math.max(enemyFrameSize + 36, preferredFloor));
  const spectatorSize = Math.max(0, Math.min(64, Math.floor((petLeft - 24) / 3 / 8) * 8));

  return {
    width,
    height,
    petSize,
    enemyFrameSize,
    scale,
    petLeft,
    enemyLeft,
    floor,
    spectatorSize,
    // Preserve the v2 impact reach at the 96px pet size; enemy assets stay unscaled.
    attackDistance: enemyLeft - petLeft - Math.round(petSize * (102 / 128)),
    compact: width < 480 || height < 300,
  };
}

export function projectPetOffset(layout: BattleLayout, offset: Point): Point {
  return {
    x: offset.x > 0 ? (offset.x / 34) * layout.attackDistance : offset.x * layout.scale,
    y: offset.y * layout.scale,
  };
}

/** Keep 32px controls usable; small windows use a wrapped toolbar instead of shrinking buttons. */
export function menuPositions(layout: BattleLayout, target: 'PET' | 'ENEMY'): Point[] {
  const count = target === 'PET' ? 6 : 7;
  if (layout.compact) {
    const columns = Math.max(1, Math.min(count, Math.floor((layout.width - 16) / 36)));
    const left = Math.round((layout.width - (columns * 36 - 4)) / 2);
    return Array.from({ length: count }, (_, index) => ({
      x: left + (index % columns) * 36,
      y: 40 + Math.floor(index / columns) * 36,
    }));
  }

  const frameSize = target === 'PET' ? layout.petSize : layout.enemyFrameSize;
  const radius = frameSize / 2 + 24;
  const left = target === 'PET' ? layout.petLeft : layout.enemyLeft;
  const centerX = Math.max(radius + 20, Math.min(layout.width - radius - 20, left + frameSize / 2));
  const centerY = Math.max(
    radius + 52,
    Math.min(layout.height - radius - 48, layout.floor - frameSize / 2),
  );
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI + (index * Math.PI * 2) / count;
    return {
      x: Math.round(centerX + Math.cos(angle) * radius - 16),
      y: Math.round(centerY + Math.sin(angle) * radius - 16),
    };
  });
}
