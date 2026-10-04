interface SpritePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SpriteMetrics {
  bottomPaddingRatio: number;
  frontRatio: number;
}

/** Measure idle alpha bounds across square frames without changing the sprite size. */
export function measurePetSprite({ width, height, data }: SpritePixels): SpriteMetrics {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length !== width * height * 4
  ) {
    return { bottomPaddingRatio: 0, frontRatio: 1 };
  }
  let bottom = -1;
  let front = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! <= 0) continue;
      bottom = y;
      front = Math.max(front, x % height);
    }
  }
  if (bottom < 0) return { bottomPaddingRatio: 0, frontRatio: 1 };
  return {
    bottomPaddingRatio: (height - bottom - 1) / height,
    frontRatio: (front + 1) / height,
  };
}

/** Preserve the existing foot-anchor API for callers that only need bottom padding. */
export function bottomPaddingRatio(pixels: SpritePixels): number {
  return measurePetSprite(pixels).bottomPaddingRatio;
}
