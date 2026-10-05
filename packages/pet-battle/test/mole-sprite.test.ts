import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MoleSprite } from '../src/ui/mole-sprite.ts';
import { petCombatAnimation, petCombatPose } from '../src/view/pet-combat-animations.ts';

const slap = petCombatPose(petCombatAnimation('mole_digger'), 1100, { x: 0, y: 0 }, { x: 0, y: 0 });

function fixture() {
  const calls: { draws: unknown[][]; paints: Uint8ClampedArray[]; fail: boolean } = {
    draws: [],
    paints: [],
    fail: false,
  };
  const dataset: Record<string, string> = {};
  const source = new Uint8ClampedArray(32 * 32 * 4);
  source.set([240, 220, 192, 255], (18 * 32 + 24) * 4);
  const canvas = {
    getContext: () => ({
      canvas: { dataset },
      clearRect: () => {},
      drawImage: (...args: unknown[]) => {
        if (calls.fail) throw new Error('tainted image');
        calls.draws.push(args);
      },
      getImageData: () => ({ data: source }),
      createImageData: () => ({ data: new Uint8ClampedArray(48 * 32 * 4) }),
      putImageData: (frame: ImageData) => calls.paints.push(frame.data),
    }),
  } as unknown as HTMLCanvasElement;
  const image = {
    complete: true,
    naturalHeight: 32,
    src: 'file:///mole-stage1.png',
    currentSrc: 'file:///mole-stage1.png',
  } as HTMLImageElement;
  return { sprite: new MoleSprite(canvas), image, dataset, calls };
}

test('보이는 원본의 첫 프레임만 읽고 같은 타격 포즈는 캐시한다', () => {
  const f = fixture();
  assert.equal(f.sprite.paint(f.image, slap, 0), true);
  assert.deepEqual(f.calls.draws[0]!.slice(1), [0, 0, 32, 32, 0, 0, 32, 32]);
  for (let i = 0; i < 60; i++) assert.equal(f.sprite.paint(f.image, slap, 0), true);
  assert.equal(f.calls.draws.length, 1);
  assert.equal(f.calls.paints.length, 1);
  assert.equal(f.dataset.source, f.image.currentSrc);
  assert.equal(f.dataset.evolution, '0');
  f.sprite.paint(f.image, { ...slap, handSwing: 0.5 }, 0);
  assert.equal(f.calls.paints.length, 2);
  f.sprite.paint(f.image, slap, 1);
  assert.equal(f.dataset.evolution, '1');
});

test('새 에셋 디코딩 중에는 이전 두더지의 팔을 표시하지 않는다', () => {
  const f = fixture();
  assert.equal(f.sprite.paint(f.image, slap, 0), true);
  f.image.src = 'file:///mole-stage3.png';
  assert.equal(f.sprite.paint(f.image, slap, 2), false);
  Object.assign(f.image, { currentSrc: f.image.src, complete: false });
  assert.equal(f.sprite.paint(f.image, slap, 2), false);
  Object.assign(f.image, { complete: true });
  assert.equal(f.sprite.paint(f.image, slap, 2), true);
  assert.equal(f.calls.draws.length, 2);
  assert.equal(f.dataset.source, f.image.src);
  assert.equal(f.dataset.evolution, '2');
});

test('정지·다른 펫·프레임 오류·캔버스 실패는 원본 전체를 표시하게 한다', () => {
  const f = fixture();
  assert.equal(f.sprite.paint(f.image, { ...slap, hand: null }, 0), false);
  assert.equal(f.sprite.paint(f.image, { ...slap, id: 'default' }, 0), false);
  Object.assign(f.image, { naturalHeight: 48 });
  assert.equal(f.sprite.paint(f.image, slap, 0), false);
  Object.assign(f.image, { naturalHeight: 32 });
  f.calls.fail = true;
  assert.equal(f.sprite.paint(f.image, slap, 0), false);
  assert.equal(f.sprite.paint(f.image, slap, 0), false);
  const missingContext = new MoleSprite({ getContext: () => null } as unknown as HTMLCanvasElement);
  assert.equal(missingContext.paint(f.image, slap, 0), false);
  assert.equal(f.calls.paints.length, 0);
});
