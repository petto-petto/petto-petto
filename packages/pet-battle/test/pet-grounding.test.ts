import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PetGrounding } from '../src/ui/pet-grounding.ts';
import type { SpriteMetrics } from '../src/view/sprite-grounding.ts';

function fixture() {
  const pending = new Map<
    string,
    { resolve(value: SpriteMetrics): void; reject(error: Error): void }
  >();
  const calls: string[] = [];
  let offset = -1;
  const grounding = new PetGrounding(
    (value) => {
      offset = value;
    },
    (asset) => {
      calls.push(asset);
      return new Promise<SpriteMetrics>((resolve, reject) =>
        pending.set(asset, { resolve, reject }),
      );
    },
  );
  return {
    grounding,
    calls,
    offset: () => offset,
    async complete(asset: string, metrics: SpriteMetrics) {
      pending.get(asset)!.resolve(metrics);
      await Promise.resolve();
      await Promise.resolve();
    },
    async fail(asset: string) {
      pending.get(asset)!.reject(new Error('image cannot be read'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('대기 이미지 1회 분석을 캐시하고 반복 조회·resize에도 최신 크기로 발을 정렬한다', async () => {
  const f = fixture();
  assert.equal(f.grounding.frontRatio, 1);
  assert.equal(
    Object.getOwnPropertyDescriptor(PetGrounding.prototype, 'frontRatio')?.set,
    undefined,
  );
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  f.grounding.resize(192); // resize while the image is still loading
  assert.equal(f.grounding.frontRatio, 1);
  await f.complete('mole-idle.png', { bottomPaddingRatio: 10 / 32, frontRatio: 25 / 32 });
  assert.equal(f.offset(), 60);
  assert.equal(f.grounding.frontRatio, 25 / 32);
  for (let i = 0; i < 30; i++) f.grounding.setSource('mole-idle.png');
  assert.equal(f.offset(), 60);
  assert.equal(f.grounding.frontRatio, 25 / 32);
  f.grounding.resize(128);
  assert.equal(f.offset(), 40);
  assert.equal(f.grounding.frontRatio, 25 / 32);
  assert.deepEqual(f.calls, ['mole-idle.png']);
});

test('이전 펫의 늦은 이미지 분석은 현재 펫의 발 기준을 덮어쓰지 않는다', async () => {
  const f = fixture();
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  f.grounding.setSource('wizard-idle.png');
  await f.complete('wizard-idle.png', { bottomPaddingRatio: 8 / 32, frontRatio: 29 / 32 });
  assert.equal(f.offset(), 32);
  assert.equal(f.grounding.frontRatio, 29 / 32);
  await f.complete('mole-idle.png', { bottomPaddingRatio: 10 / 32, frontRatio: 25 / 32 });
  assert.equal(f.offset(), 32);
  assert.equal(f.grounding.frontRatio, 29 / 32);
  f.grounding.setSource('mole-idle.png');
  assert.equal(f.grounding.frontRatio, 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.offset(), 40);
  assert.equal(f.grounding.frontRatio, 25 / 32);
  assert.deepEqual(f.calls, ['mole-idle.png', 'wizard-idle.png']);
});

test('선택 해제·이미지 읽기 실패에서 이전 펫 보정값이 남지 않는다', async () => {
  const f = fixture();
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  await f.complete('mole-idle.png', { bottomPaddingRatio: 10 / 32, frontRatio: 25 / 32 });
  assert.equal(f.grounding.frontRatio, 25 / 32);
  f.grounding.setSource('missing.png');
  assert.equal(f.offset(), 0);
  assert.equal(f.grounding.frontRatio, 1);
  await f.fail('missing.png');
  assert.equal(f.offset(), 0);
  assert.equal(f.grounding.frontRatio, 1);
  f.grounding.setSource(null);
  f.grounding.setSource('missing.png');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.calls, ['mole-idle.png', 'missing.png']);
  assert.equal(f.offset(), 0);
  assert.equal(f.grounding.frontRatio, 1);
  f.grounding.setSource('pending.png');
  f.grounding.setSource(null);
  assert.equal(f.grounding.frontRatio, 1);
  await f.complete('pending.png', { bottomPaddingRatio: 10 / 32, frontRatio: 25 / 32 });
  assert.equal(f.offset(), 0);
  assert.equal(f.grounding.frontRatio, 1);
});

test('이미지 로더는 실제 알파 하단을 읽고 로드·캔버스 실패는 중립 처리한다', async (t) => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    for (const [name, descriptor] of [
      ['Image', originalImage],
      ['document', originalDocument],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  let image: ImageStub;
  class ImageStub {
    src = '';
    naturalWidth = 128;
    naturalHeight = 32;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      image = this;
    }
  }
  let contextAvailable = true;
  let readable = true;
  let drawn = 0;
  let reads = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext(type: string) {
      assert.equal(type, '2d');
      return contextAvailable
        ? {
            drawImage(source: ImageStub, x: number, y: number) {
              assert.equal(source, image);
              assert.deepEqual([x, y], [0, 0]);
              drawn += 1;
            },
            getImageData(x: number, y: number, width: number, height: number) {
              assert.deepEqual([x, y, width, height], [0, 0, 128, 32]);
              reads += 1;
              if (!readable) throw new Error('unreadable image');
              const data = new Uint8ClampedArray(width * height * 4);
              data[(21 * width + 2) * 4 + 3] = 255;
              data[(10 * width + 64 + 28) * 4 + 3] = 255;
              data[(8 * width + 96 + 12) * 4 + 3] = 255;
              return { width, height, data };
            },
          }
        : null;
    },
  };
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: ImageStub });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, 'canvas');
        return canvas;
      },
    },
  });
  let offset = -1;
  const grounding = new PetGrounding((value) => {
    offset = value;
  });
  grounding.resize(128);
  for (const mode of ['loaded', 'no-context', 'unreadable', 'missing'] as const) {
    contextAvailable = mode !== 'no-context';
    readable = mode !== 'unreadable';
    grounding.setSource(`${mode}.png`);
    assert.equal(grounding.frontRatio, 1);
    assert.equal(image!.src, `${mode}.png`);
    if (mode === 'missing') image!.onerror!();
    else image!.onload!();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(offset, mode === 'loaded' ? 40 : 0);
    assert.equal(grounding.frontRatio, mode === 'loaded' ? 29 / 32 : 1);
    if (mode === 'loaded') {
      for (let i = 0; i < 30; i++) grounding.setSource('loaded.png');
      grounding.resize(192);
      assert.equal(offset, 60);
      assert.equal(grounding.frontRatio, 29 / 32);
      assert.equal(drawn, 1);
      assert.equal(reads, 1);
      grounding.resize(128);
    }
  }
  assert.equal(drawn, 2);
  assert.equal(reads, 2);
});
