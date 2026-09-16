export interface Point {
  x: number;
  y: number;
}

export interface BattleLayout {
  width: number;
  height: number;
  petSize: number;
  scale: number;
  petLeft: number;
  enemyLeft: number;
  floor: number;
  spectatorSize: number;
  attackDistance: number;
  compact: boolean;
}

/** Presentation only: the host owns window size, Rust owns combat timing/state. */
export function battleLayout(width: number, height: number): BattleLayout {
  const availableSize = Math.min(128, width * 0.21, height - 80);
  const petSize = Math.max(32, Math.floor(availableSize / 32) * 32);
  const scale = petSize / 128;
  const gap = Math.round(Math.max(4, Math.min(16, width / 80)));
  const petLeft = Math.round((width - petSize * 2 - gap) / 2);
  const enemyLeft = petLeft + petSize + gap;
  const floor = height - Math.round(Math.max(28, Math.min(58, height * 0.14)));
  const spectatorSize = Math.max(0, Math.min(64, Math.floor((petLeft - 24) / 3 / 8) * 8));

  return {
    width,
    height,
    petSize,
    scale,
    petLeft,
    enemyLeft,
    floor,
    spectatorSize,
    // The v2 impact pose contacts a LARGE enemy at 102 / 128 frame separation.
    attackDistance: enemyLeft - petLeft - 102 * scale,
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

  const radius = layout.petSize / 2 + 24;
  const left = target === 'PET' ? layout.petLeft : layout.enemyLeft;
  const centerX = Math.max(
    radius + 20,
    Math.min(layout.width - radius - 20, left + layout.petSize / 2),
  );
  const centerY = Math.max(
    radius + 52,
    Math.min(layout.height - radius - 48, layout.floor - layout.petSize / 2),
  );
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI + (index * Math.PI * 2) / count;
    return {
      x: Math.round(centerX + Math.cos(angle) * radius - 16),
      y: Math.round(centerY + Math.sin(angle) * radius - 16),
    };
  });
}
