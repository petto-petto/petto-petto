import type { BackgroundTheme } from '../contracts.ts';

interface PeekAnchor {
  sourceX: number;
  sourceY: number;
  direction: 'LEFT' | 'RIGHT';
}

export interface PeekSlot extends PeekAnchor {
  x: number;
  y: number;
  frameSize: number;
  width: number;
  height: number;
  durationMs: number;
  delayMs: number;
}

// Straight trunk/column edges in the existing 1915 × 821 backgrounds.
// Y is the hidden foot/pivot, not the top of a detached head crop.
const ANCHORS: Record<BackgroundTheme, readonly PeekAnchor[]> = {
  MUSHROOM_FOREST: [
    { sourceX: 869, sourceY: 365, direction: 'RIGHT' },
    { sourceX: 1271, sourceY: 390, direction: 'LEFT' },
    { sourceX: 660, sourceY: 325, direction: 'RIGHT' },
  ],
  CRYSTAL_RUINS: [
    { sourceX: 385, sourceY: 365, direction: 'RIGHT' },
    { sourceX: 1150, sourceY: 390, direction: 'LEFT' },
    { sourceX: 1445, sourceY: 335, direction: 'LEFT' },
  ],
  STARLIGHT_SHRINE: [
    { sourceX: 1000, sourceY: 295, direction: 'LEFT' },
    { sourceX: 1355, sourceY: 335, direction: 'RIGHT' },
    { sourceX: 429, sourceY: 300, direction: 'RIGHT' },
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
  // Only background spectators scale; the combat pet remains 128px.
  const frameSize = 32 * Math.max(2, Math.min(4, Math.round(scale * 4)));
  const slotHeight = frameSize * 1.25;
  return ANCHORS[theme]
    .map((anchor, index) => ({
      ...anchor,
      x: Math.round(offsetX + anchor.sourceX * scale) - frameSize,
      y: Math.round(offsetY + anchor.sourceY * scale) - slotHeight,
      frameSize,
      width: frameSize * 2,
      height: slotHeight,
      durationMs: 5200 + index * 900,
      delayMs: -index * 1700,
    }))
    .filter(
      (slot) =>
        slot.x + frameSize >= 4 &&
        slot.x + frameSize <= width - 4 &&
        slot.y + slotHeight > 36 &&
        slot.y + slotHeight <= height - 8,
    );
}
