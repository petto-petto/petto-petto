export interface AmbientPortrait {
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frameHeight: number;
  scale: number;
}

type FaceCrop = readonly [x: number, y: number, width: number, height: number];

// Native pixel coordinates in the first idle frame, not resized sprite bounds.
const PET_FACES = {
  acorn_squirrel: [
    [3, 5, 15, 10],
    [2, 6, 17, 12],
    [4, 10, 25, 18],
  ],
  star_wizard: [
    [10, 9, 13, 6],
    [7, 9, 20, 8],
    [12, 16, 24, 10],
  ],
  midnight_zebra: [
    [8, 7, 16, 10],
    [6, 7, 19, 11],
    [5, 9, 23, 11],
  ],
  cheek_hamster: [
    [6, 8, 21, 9],
    [3, 9, 26, 9],
    [7, 10, 23, 10],
  ],
  mole_digger: [
    [9, 5, 14, 9],
    [8, 2, 16, 11],
    [9, 8, 14, 9],
  ],
  sprout_treant: [
    [8, 9, 16, 8],
    [5, 6, 22, 11],
    [8, 8, 20, 11],
  ],
} as const satisfies Record<string, readonly FaceCrop[]>;

/** Select a face crop without loading, modifying, or replacing the source asset. */
export function ambientPortrait(asset: string, side: 'PET' | 'ENEMY'): AmbientPortrait {
  const path = asset.split(/[?#]/u, 1)[0]!.replaceAll('\\', '/');
  if (side === 'ENEMY') {
    return portrait(asset, /-exhausted\.png$/iu.test(path) ? [7, 14, 24, 12] : [7, 12, 23, 14]);
  }
  const shared = path.match(
    /(?:^|\/)(acorn_squirrel|star_wizard|midnight_zebra|cheek_hamster|mole_digger|sprout_treant)\/stage([123])\/[^/]+\.png$/u,
  );
  if (shared) {
    const species = shared[1] as keyof typeof PET_FACES;
    const stage = Number(shared[2]);
    const frameHeight =
      stage === 3 && (species === 'acorn_squirrel' || species === 'star_wizard') ? 48 : 32;
    return portrait(asset, PET_FACES[species][stage - 1]!, frameHeight);
  }
  const fallback = path.match(/(?:^|\/)(common|rare|epic)-idle\.png$/u)?.[1];
  if (fallback === 'common') return portrait(asset, PET_FACES.sprout_treant[0]);
  if (fallback === 'rare') return portrait(asset, PET_FACES.cheek_hamster[0]);
  if (fallback === 'epic') return portrait(asset, PET_FACES.acorn_squirrel[0]);
  return portrait(asset, [8, 8, 16, 12]);
}

function portrait(
  asset: string,
  [x, y, width, height]: FaceCrop,
  frameHeight = 32,
): AmbientPortrait {
  return {
    asset,
    x,
    y,
    width,
    height,
    frameHeight,
    scale: Math.min(2, Math.floor(40 / Math.max(width, height))),
  };
}
