import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peekingSpectators } from '../src/view/peeking-spectators.ts';
import type { BackgroundTheme } from '../src/contracts.ts';

const themes: BackgroundTheme[] = ['MUSHROOM_FOREST', 'CRYSTAL_RUINS', 'STARLIGHT_SHRINE'];

test('각 배경의 실제 나무·기둥 좌표에서 최대 세 마리가 서로 다른 방향·박자로 빼꼼한다', () => {
  const plans = themes.map((theme) => peekingSpectators(theme, 640, 420));
  for (const plan of plans) {
    assert.equal(plan.length, 3);
    assert.equal(new Set(plan.map((slot) => slot.durationMs)).size, 3);
    assert.equal(new Set(plan.map((slot) => slot.delayMs)).size, 3);
    assert.equal(new Set(plan.map((slot) => slot.direction)).size, 2);
  }
  assert.notDeepEqual(plans[0], plans[1]);
  assert.notDeepEqual(plans[1], plans[2]);
});

test('cover 중앙 크롭과 같은 좌표계로 이동하며 장애물에서 임의로 떨어지지 않는다', () => {
  for (const theme of themes) {
    for (const [width, height] of [[360, 180], [640, 420], [960, 540], [280, 180], [360, 640]]) {
      const slots = peekingSpectators(theme, width!, height!);
      assert.ok(slots.length > 0 && slots.length <= 3);
      const scale = Math.max(width! / 1915, height! / 821);
      for (const slot of slots) {
        const edge = (width! - 1915 * scale) / 2 + slot.sourceX * scale;
        assert.equal(slot.x, Math.round(edge) - (slot.direction === 'LEFT' ? 30 : 0));
        assert.equal(slot.y, Math.round((height! - 821 * scale) / 2 + slot.sourceY * scale));
        assert.ok(slot.x >= 4 && slot.x + 30 <= width! - 4);
        assert.ok(slot.y >= 36 && slot.y + 30 <= height! - 8);
      }
    }
  }
});

test('빈 화면과 잘린 장애물은 가짜 위치에 관중을 띄우지 않는다', () => {
  assert.deepEqual(peekingSpectators('MUSHROOM_FOREST', 0, 0), []);
  assert.deepEqual(peekingSpectators('CRYSTAL_RUINS', Number.NaN, 180), []);
  assert.deepEqual(peekingSpectators('STARLIGHT_SHRINE', -20, 180), []);
  assert.ok(peekingSpectators('MUSHROOM_FOREST', 360, 640).length < 3);
});
