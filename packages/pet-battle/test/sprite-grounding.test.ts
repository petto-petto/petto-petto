import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bottomPaddingRatio } from '../src/view/sprite-grounding.ts';
import * as spriteGrounding from '../src/view/sprite-grounding.ts';
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
      assert.equal(layout.petSize, 96);
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

test('모든 정사각 idle 프레임의 알파 앞끝과 기존 발밑 여백을 함께 측정한다', () => {
  for (const frameHeight of [32, 48]) {
    const image = pixels(frameHeight, 22);
    for (const [frame, right, y] of [
      [1, frameHeight - 7, 4],
      [2, frameHeight - 3, 7],
      [3, 4, 12],
    ]) {
      const x = frame! * frameHeight + right!;
      image.data[(y! * image.width + x) * 4 + 3] = 255;
    }
    const metrics = spriteGrounding.measurePetSprite(image);
    assert.deepEqual(metrics, {
      bottomPaddingRatio: (frameHeight - 22) / frameHeight,
      frontRatio: (frameHeight - 2) / frameHeight,
    });
    assert.equal(metrics.bottomPaddingRatio, bottomPaddingRatio(image));
  }
});

test('앞끝은 프레임 내 우측 exclusive 경계이며 투명 RGB를 무시한다', () => {
  const image = pixels(32, 0);
  image.data[(10 * image.width + 32) * 4 + 3] = 255;
  image.data[image.data.length - 2] = 255;
  assert.deepEqual(spriteGrounding.measurePetSprite(image), {
    bottomPaddingRatio: 21 / 32,
    frontRatio: 1 / 32,
  });
  image.data[image.data.length - 1] = 1;
  assert.deepEqual(spriteGrounding.measurePetSprite(image), {
    bottomPaddingRatio: 0,
    frontRatio: 1,
  });
});

test('알파가 없거나 읽을 수 없는 크기는 하단 0·앞끝 1로 안전하게 처리한다', () => {
  for (const image of [
    pixels(32, 0),
    { width: 0, height: 0, data: new Uint8ClampedArray() },
    { width: 2, height: 2, data: new Uint8ClampedArray(1) },
    { width: 1.5, height: 2, data: new Uint8ClampedArray(12) },
    { width: 2, height: -1, data: new Uint8ClampedArray() },
  ]) {
    assert.deepEqual(spriteGrounding.measurePetSprite(image), {
      bottomPaddingRatio: 0,
      frontRatio: 1,
    });
  }
});
