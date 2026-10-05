import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BattleImages, setImageSource } from '../src/ui/battle-images.ts';

test('동일 이미지의 100회 상태 조회는 실제 src를 한 번만 변경한다', () => {
  let src = '';
  let writes = 0;
  const image = {
    decoding: 'auto',
    get src() {
      return src;
    },
    set src(value: string) {
      writes += 1;
      src = value;
    },
  };
  for (let i = 0; i < 100; i++) setImageSource(image, 'file:///battle/forest.png');
  assert.equal(writes, 1);
  assert.equal(image.decoding, 'async');
  setImageSource(image, 'file:///battle/shrine.png');
  assert.equal(writes, 2);
  assert.equal(src, 'file:///battle/shrine.png');
});

test('현재 펫의 공격 이미지 준비는 URL별 한 번이며 폴링·재선택에서 재사용한다', async () => {
  const calls: string[] = [];
  const images = new BattleImages(async (asset) => {
    calls.push(asset);
    return { src: asset };
  });
  await images.preload(null);
  const first = images.preload('wizard-attack.png');
  for (let i = 0; i < 100; i++) assert.equal(images.preload('wizard-attack.png'), first);
  await first;
  await images.preload('mole-attack.png');
  await images.preload('wizard-attack.png');
  assert.deepEqual(calls, ['wizard-attack.png', 'mole-attack.png']);
});

test('준비 실패는 렌더링 오류로 전파되거나 매 조회마다 재시도되지 않는다', async () => {
  let attempts = 0;
  const images = new BattleImages(async () => {
    attempts += 1;
    throw new Error('missing asset');
  });
  await assert.doesNotReject(images.preload('missing.png'));
  await assert.doesNotReject(images.preload('missing.png'));
  assert.equal(attempts, 1);
});

test('이전 펫의 늦은 준비 완료가 선택·중지로 변경된 표시 이미지를 덮어쓰지 않는다', async () => {
  let complete!: (image: object) => void;
  const images = new BattleImages(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const image = { src: '', decoding: 'auto' };
  setImageSource(image, 'wizard-idle.png');
  const pending = images.preload('wizard-attack.png');
  setImageSource(image, 'mole-idle.png');
  complete({ src: 'wizard-attack.png' });
  await pending;
  assert.equal(image.src, 'mole-idle.png');
});

test('기본 로더는 비동기 디코딩이 끝난 이미지를 캐시에 보관한다', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Image', original);
    else Reflect.deleteProperty(globalThis, 'Image');
  });
  let decodes = 0;
  class ImageStub {
    src = '';
    decoding = 'auto';
    async decode() {
      assert.equal(this.src, 'attack.png');
      assert.equal(this.decoding, 'async');
      decodes += 1;
    }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: ImageStub });
  const images = new BattleImages();
  const result = await images.preload('attack.png');
  assert.ok(result instanceof ImageStub);
  await images.preload('attack.png');
  assert.equal(decodes, 1);
});
