import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineReadiness } from '@pet/combine';

test('재료 수와 비용을 늘 보인다', () => {
  assert.equal(combineReadiness('common', 5, 255_309).materials, '재료 5 / 10 · 30,000 토큰');
  assert.equal(combineReadiness('rare', 0, 0).materials, '재료 0 / 10 · 100,000 토큰');
});

test('재료가 모자라면 몇 장 더 필요한지 알리고 누를 수 없다', () => {
  assert.deepEqual(combineReadiness('common', 5, 255_309), {
    ready: false,
    materials: '재료 5 / 10 · 30,000 토큰',
    reason: '재료가 5장 더 필요해요.',
  });
});

test('재료와 토큰이 둘 다 모자라면 재료 쪽을 먼저 알린다', () => {
  assert.equal(combineReadiness('rare', 3, 0).reason, '재료가 7장 더 필요해요.');
});

test('재료는 충분하고 토큰이 모자라면 부족분을 알린다', () => {
  assert.deepEqual(combineReadiness('common', 10, 20_000), {
    ready: false,
    materials: '재료 10 / 10 · 30,000 토큰',
    reason: '토큰이 10,000 부족해요.',
  });
});

test('재료 10장과 비용 이상의 잔액이면 누를 수 있고 이유가 없다', () => {
  assert.deepEqual(combineReadiness('common', 10, 30_000), {
    ready: true,
    materials: '재료 10 / 10 · 30,000 토큰',
    reason: undefined,
  });
});
