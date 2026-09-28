import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bottomPaddingRatio } from '../src/view/sprite-grounding.ts';
import { battleLayout } from '../src/view/layout.ts';

function pixels(frameHeight: number, bottom: number) {
  const width = frameHeight * 4;
  const data = new Uint8ClampedArray(width * frameHeight * 4);
  if (bottom > 0) data[((bottom - 1) * width + 2) * 4 + 3] = 255;
  return { width, height: frameHeight, data };
}

test('공통 6종·3단계의 서로 다른 발밑 여백을 같은 바닥에 맞춘다', () => {
  // Measured idle alpha bounds from the shared sprites; original PNGs remain untouched.
  const feet = [
    [32, 22],
    [32, 25],
    [32, 29], // mole
    [32, 26],
    [32, 28],
    [32, 31], // treant
    [32, 26],
    [32, 30],
    [48, 46], // squirrel
    [32, 24],
    [32, 29],
    [48, 45], // wizard
    [32, 25],
    [32, 28],
    [32, 30], // hamster
    [32, 25],
    [32, 27],
    [32, 31], // zebra
  ] as const;
  for (const [width, height] of [
    [276, 176],
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ] as const) {
    const layout = battleLayout(width, height);
    for (const [frameHeight, bottom] of feet) {
      const padding = bottomPaddingRatio(pixels(frameHeight, bottom));
      const offset = Math.round(padding * layout.petSize);
      const visibleBottom =
        layout.floor - layout.petSize + offset + (bottom / frameHeight) * layout.petSize;
      assert.ok(
        Math.abs(visibleBottom - layout.floor) <= 0.5,
        `${frameHeight}/${bottom} at ${width}×${height}`,
      );
      assert.ok(visibleBottom <= height - 7);
      assert.equal(layout.petSize, 128);
    }
  }
});

test('투명 픽셀의 RGB는 발 기준이 아니며 어느 열의 불투명 픽셀도 누락하지 않는다', () => {
  const image = pixels(32, 22);
  image.data[image.data.length - 2] = 255; // RGB only: still transparent.
  assert.equal(bottomPaddingRatio(image), 10 / 32);
  image.data[image.data.length - 1] = 255;
  assert.equal(bottomPaddingRatio(image), 0);
});

test('완전히 투명하거나 잘못된 이미지 크기는 중립 보정값을 사용한다', () => {
  assert.equal(bottomPaddingRatio(pixels(32, 0)), 0);
  assert.equal(bottomPaddingRatio({ width: 0, height: 0, data: new Uint8ClampedArray() }), 0);
  assert.equal(bottomPaddingRatio({ width: 2, height: 2, data: new Uint8ClampedArray(1) }), 0);
});
