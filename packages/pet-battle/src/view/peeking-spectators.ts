import type { BackgroundTheme } from '../contracts.ts';

interface PeekAnchor {
  sourceX: number;
  sourceY: number;
  direction: 'LEFT' | 'RIGHT';
}

export interface PeekSlot extends PeekAnchor {
  x: number;
  y: number;
  durationMs: number;
  delayMs: number;
}

// Straight trunk/column edges in the existing 1915 × 821 backgrounds.
// A slot clips everything on the obstacle side: only the head can emerge.
const ANCHORS: Record<BackgroundTheme, readonly PeekAnchor[]> = {
  MUSHROOM_FOREST: [
    { sourceX: 869, sourceY: 260, direction: 'RIGHT' },
    { sourceX: 1271, sourceY: 266, direction: 'LEFT' },
    { sourceX: 660, sourceY: 248, direction: 'RIGHT' },
  ],
  CRYSTAL_RUINS: [
    { sourceX: 385, sourceY: 250, direction: 'RIGHT' },
    { sourceX: 1150, sourceY: 292, direction: 'LEFT' },
    { sourceX: 1445, sourceY: 210, direction: 'LEFT' },
  ],
  STARLIGHT_SHRINE: [
    { sourceX: 1020, sourceY: 220, direction: 'LEFT' },
    { sourceX: 1355, sourceY: 273, direction: 'RIGHT' },
    { sourceX: 429, sourceY: 246, direction: 'RIGHT' },
  ],
};

export function peekingSpectators(
  theme: BackgroundTheme,
  width: number,
  height: number,
): PeekSlot[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  // Match object-fit: cover / object-position: center, not viewport percentages.
  const scale = Math.max(width / 1915, height / 821);
  const offsetX = (width - 1915 * scale) / 2;
  const offsetY = (height - 821 * scale) / 2;
  return ANCHORS[theme]
    .map((anchor, index) => ({
      ...anchor,
      x: Math.round(offsetX + anchor.sourceX * scale) - (anchor.direction === 'LEFT' ? 30 : 0),
      y: Math.round(offsetY + anchor.sourceY * scale),
      durationMs: 5200 + index * 900,
      delayMs: -index * 1700,
    }))
    .filter(
      (slot) =>
        slot.x >= 4 && slot.x + 30 <= width - 4 && slot.y >= 36 && slot.y + 30 <= height - 8,
    );
}
