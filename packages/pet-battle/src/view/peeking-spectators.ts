import type { BackgroundTheme } from '../contracts.ts';

interface PeekAnchor {
  sourceX: number;
  sourceTop: number;
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

// Safe straight foreground trunk/column edges in the existing 1915 × 821 backgrounds.
// Exclude branches, ornaments, and distant shrub silhouettes from the reveal span.
// Y is the hidden foot/pivot, not the top of a detached head crop.
const ANCHORS: Record<BackgroundTheme, readonly PeekAnchor[]> = {
  MUSHROOM_FOREST: [
    { sourceX: 334, sourceTop: 241, sourceY: 330, direction: 'RIGHT' },
    { sourceX: 1271, sourceTop: 216, sourceY: 350, direction: 'LEFT' },
    { sourceX: 1591, sourceTop: 185, sourceY: 350, direction: 'RIGHT' },
  ],
  CRYSTAL_RUINS: [
    { sourceX: 385, sourceTop: 190, sourceY: 365, direction: 'RIGHT' },
    { sourceX: 1150, sourceTop: 280, sourceY: 390, direction: 'LEFT' },
    { sourceX: 1445, sourceTop: 125, sourceY: 335, direction: 'LEFT' },
  ],
  STARLIGHT_SHRINE: [
    { sourceX: 1060, sourceTop: 167, sourceY: 295, direction: 'RIGHT' },
    { sourceX: 1316, sourceTop: 160, sourceY: 335, direction: 'LEFT' },
    { sourceX: 429, sourceTop: 0, sourceY: 160, direction: 'RIGHT' },
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
  const preferredFrame = 32 * Math.max(2, Math.min(4, Math.round(scale * 4)));
  return ANCHORS[theme]
    .map((anchor, index) => {
      // Quantize down so the whole reveal fits the real edge at every viewport ratio.
      const edgeCapacity = 32 * Math.floor(((anchor.sourceY - anchor.sourceTop) * scale) / 40);
      const frameSize = Math.min(preferredFrame, edgeCapacity);
      const slotHeight = frameSize * 1.25;
      return {
        ...anchor,
        x: Math.round(offsetX + anchor.sourceX * scale) - frameSize,
        y: Math.round(offsetY + anchor.sourceY * scale) - slotHeight,
        frameSize,
        width: frameSize * 2,
        height: slotHeight,
        durationMs: 5200 + index * 900,
        delayMs: -index * 1700,
      };
    })
    .filter(
      (slot) =>
        slot.frameSize >= 32 &&
        slot.x + slot.frameSize >= 4 &&
        slot.x + slot.frameSize <= width - 4 &&
        slot.y >= 36 &&
        slot.y + slot.height <= height - 8,
    );
}
