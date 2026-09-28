import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PetGrounding } from '../src/ui/pet-grounding.ts';

function fixture() {
  const pending = new Map<string, { resolve(value: number): void; reject(error: Error): void }>();
  const calls: string[] = [];
  let offset = -1;
  const grounding = new PetGrounding(
    (value) => {
      offset = value;
    },
    (asset) => {
      calls.push(asset);
      return new Promise<number>((resolve, reject) => pending.set(asset, { resolve, reject }));
    },
  );
  return {
    grounding,
    calls,
    offset: () => offset,
    async complete(asset: string, padding: number) {
      pending.get(asset)!.resolve(padding);
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
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  f.grounding.resize(192); // resize while the image is still loading
  await f.complete('mole-idle.png', 10 / 32);
  assert.equal(f.offset(), 60);
  for (let i = 0; i < 30; i++) f.grounding.setSource('mole-idle.png');
  assert.equal(f.offset(), 60);
  f.grounding.resize(128);
  assert.equal(f.offset(), 40);
  assert.deepEqual(f.calls, ['mole-idle.png']);
});

test('이전 펫의 늦은 이미지 분석은 현재 펫의 발 기준을 덮어쓰지 않는다', async () => {
  const f = fixture();
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  f.grounding.setSource('wizard-idle.png');
  await f.complete('wizard-idle.png', 8 / 32);
  assert.equal(f.offset(), 32);
  await f.complete('mole-idle.png', 10 / 32);
  assert.equal(f.offset(), 32);
  f.grounding.setSource('mole-idle.png');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.offset(), 40);
  assert.deepEqual(f.calls, ['mole-idle.png', 'wizard-idle.png']);
});

test('선택 해제·이미지 읽기 실패에서 이전 펫 보정값이 남지 않는다', async () => {
  const f = fixture();
  f.grounding.resize(128);
  f.grounding.setSource('mole-idle.png');
  await f.complete('mole-idle.png', 10 / 32);
  f.grounding.setSource('missing.png');
  assert.equal(f.offset(), 0);
  await f.fail('missing.png');
  assert.equal(f.offset(), 0);
  f.grounding.setSource('pending.png');
  f.grounding.setSource(null);
  await f.complete('pending.png', 10 / 32);
  assert.equal(f.offset(), 0);
});
