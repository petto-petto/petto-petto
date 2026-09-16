import type { BackgroundTheme } from '../contracts.ts';

interface PeekAnchor {
  sourceX: number;
  sourceY: number;
  direction: 'LEFT' | 'RIGHT';
  /** Source-image staircase silhouette, [start Y, edge X]. */
  edge: readonly (readonly [number, number])[];
}

export interface PeekSlot extends Omit<PeekAnchor, 'edge'> {
  x: number;
  y: number;
  frameSize: number;
  width: number;
  height: number;
  durationMs: number;
  delayMs: number;
  clipPath: string;
}

// Existing 1915×821 artwork: foreground edges, including their branches/caps.
// Last forest anchor is a central tree for portrait crops, not free-space fallback.
const ANCHORS: Record<BackgroundTheme, readonly PeekAnchor[]> = {
  MUSHROOM_FOREST: [
    {
      sourceX: 334,
      sourceY: 330,
      direction: 'RIGHT',
      edge: [
        [0, 408],
        [64, 383],
        [95, 350],
        [113, 334],
        [185, 397],
        [207, 376],
        [218, 352],
        [241, 334],
      ],
    },
    {
      sourceX: 1271,
      sourceY: 350,
      direction: 'LEFT',
      edge: [
        [0, 1296],
        [113, 1248],
        [137, 1225],
        [161, 1248],
        [185, 1271],
      ],
    },
    {
      sourceX: 1543,
      sourceY: 270,
      direction: 'LEFT',
      edge: [
        [0, 1543],
        [64, 1470],
        [95, 1495],
        [113, 1527],
        [160, 1543],
      ],
    },
    { sourceX: 869, sourceY: 365, direction: 'RIGHT', edge: [[0, 869]] },
  ],
  CRYSTAL_RUINS: [
    {
      sourceX: 385,
      sourceY: 365,
      direction: 'RIGHT',
      edge: [
        [0, 401],
        [117, 414],
        [148, 394],
        [180, 385],
      ],
    },
    {
      sourceX: 1150,
      sourceY: 390,
      direction: 'LEFT',
      edge: [
        [0, 1122],
        [248, 1138],
        [270, 1150],
      ],
    },
    {
      sourceX: 1445,
      sourceY: 335,
      direction: 'LEFT',
      edge: [
        [0, 1427],
        [109, 1445],
      ],
    },
  ],
  STARLIGHT_SHRINE: [
    {
      sourceX: 1060,
      sourceY: 295,
      direction: 'RIGHT',
      edge: [
        [0, 1118],
        [146, 1098],
        [166, 1079],
        [187, 1060],
      ],
    },
    {
      sourceX: 1316,
      sourceY: 335,
      direction: 'LEFT',
      edge: [
        [0, 1316],
        [42, 1296],
        [85, 1275],
        [112, 1296],
        [158, 1316],
      ],
    },
    {
      sourceX: 429,
      sourceY: 300,
      direction: 'RIGHT',
      edge: [
        [0, 429],
        [184, 441],
        [222, 429],
      ],
    },
  ],
};

function revealClip(
  anchor: PeekAnchor,
  slot: { x: number; y: number; width: number; height: number },
  scale: number,
  offsetX: number,
  offsetY: number,
): string {
  const projectX = (x: number) =>
    Math.max(0, Math.min(slot.width, Math.round(offsetX + x * scale) - slot.x));
  let edgeX = anchor.edge[0]![1];
  const points: string[] = [];
  for (const [sourceY, nextX] of anchor.edge) {
    const y = Math.round(offsetY + sourceY * scale) - slot.y;
    if (y <= 0) {
      edgeX = nextX;
      continue;
    }
    if (points.length === 0) points.push(`${projectX(edgeX)}px 0px`);
    if (y >= slot.height) break;
    points.push(`${projectX(edgeX)}px ${y}px`, `${projectX(nextX)}px ${y}px`);
    edgeX = nextX;
  }
  if (points.length === 0) points.push(`${projectX(edgeX)}px 0px`);
  points.push(`${projectX(edgeX)}px ${slot.height}px`);
  const outerX = anchor.direction === 'RIGHT' ? slot.width : 0;
  points.push(`${outerX}px ${slot.height}px`, `${outerX}px 0px`);
  return `polygon(${points.join(', ')})`;
}

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
    .map((anchor, index) => {
      const slot = {
        sourceX: anchor.sourceX,
        sourceY: anchor.sourceY,
        direction: anchor.direction,
        x: Math.round(offsetX + anchor.sourceX * scale) - frameSize,
        y: Math.round(offsetY + anchor.sourceY * scale) - slotHeight,
        frameSize,
        width: frameSize * 2,
        height: slotHeight,
        durationMs: 5200 + index * 900,
        delayMs: -index * 1700,
      };
      return { ...slot, clipPath: revealClip(anchor, slot, scale, offsetX, offsetY) };
    })
    .filter(
      (slot) =>
        slot.x + slot.frameSize >= 0 &&
        slot.x + slot.frameSize <= width &&
        slot.y + slot.height > 36 &&
        slot.y + slot.height <= height - 8,
    )
    .slice(0, 3);
}
