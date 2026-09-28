interface SpritePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Measure the transparent rows below the idle sprite without changing its size. */
export function bottomPaddingRatio({ width, height, data }: SpritePixels): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length !== width * height * 4
  ) {
    return 0;
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! > 0) return (height - y - 1) / height;
    }
  }
  return 0;
}
