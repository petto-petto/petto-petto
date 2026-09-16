import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peekingSpectators } from '../src/view/peeking-spectators.ts';
import type { BackgroundTheme } from '../src/contracts.ts';

const themes: BackgroundTheme[] = ['MUSHROOM_FOREST', 'CRYSTAL_RUINS', 'STARLIGHT_SHRINE'];

test('각 배경의 실제 나무·기둥 좌표에서 최대 세 마리가 서로 다른 방향·박자로 빼꼼한다', () => {
  const plans = themes.map((theme) => peekingSpectators(theme, 640, 420));
  for (const plan of plans) {
    assert.ok(plan.length > 0 && plan.length <= 3);
    assert.equal(new Set(plan.map((slot) => slot.durationMs)).size, plan.length);
    assert.equal(new Set(plan.map((slot) => slot.delayMs)).size, plan.length);
  }
  assert.notDeepEqual(plans[0], plans[1]);
  assert.notDeepEqual(plans[1], plans[2]);
});

test('cover 중앙 크롭과 같은 좌표계로 이동하며 장애물에서 임의로 떨어지지 않는다', () => {
  for (const theme of themes) {
    for (const [width, height] of [
      [360, 180],
      [640, 420],
      [960, 540],
      [1440, 900],
      [1920, 1080],
      [280, 180],
      [360, 640],
    ]) {
      const slots = peekingSpectators(theme, width!, height!);
      assert.ok(slots.length <= 3);
      const scale = Math.max(width! / 1915, height! / 821);
      for (const slot of slots) {
        const edge = (width! - 1915 * scale) / 2 + slot.sourceX * scale;
        assert.equal(slot.x + slot.frameSize, Math.round(edge));
        assert.equal(
          slot.y + slot.height,
          Math.round((height! - 821 * scale) / 2 + slot.sourceY * scale),
        );
        assert.ok(edge >= 4 && edge <= width! - 4);
        assert.ok(slot.y + slot.height > 36);
      }
    }
  }
});

test('등장 영역 전체가 실제 전경 줄기·기둥의 곧은 구간 안에만 놓인다', () => {
  // Measured source-image edges: x, top, bottom, exposed side. Not distant shrub silhouettes.
  const edges = {
    MUSHROOM_FOREST: [
      [334, 241, 330, 'RIGHT'],
      [1271, 216, 350, 'LEFT'],
      [1591, 185, 350, 'RIGHT'],
    ],
    CRYSTAL_RUINS: [
      [385, 190, 365, 'RIGHT'],
      [1150, 280, 390, 'LEFT'],
      [1445, 125, 335, 'LEFT'],
    ],
    STARLIGHT_SHRINE: [
      [1060, 167, 295, 'RIGHT'],
      [1316, 160, 335, 'LEFT'],
      [429, 0, 160, 'RIGHT'],
    ],
  } as const;
  for (const theme of themes) {
    for (const [width, height] of [
      [360, 180],
      [640, 420],
      [1440, 900],
      [1920, 1080],
      [2560, 1080],
      [900, 1440],
    ]) {
      const scale = Math.max(width! / 1915, height! / 821);
      const offsetY = (height! - 821 * scale) / 2;
      for (const slot of peekingSpectators(theme, width!, height!)) {
        const edge = edges[theme].find(
          ([x, , bottom, direction]) =>
            x === slot.sourceX && bottom === slot.sourceY && direction === slot.direction,
        );
        assert.ok(
          edge,
          `${theme}: ${slot.sourceX},${slot.sourceY} must be a foreground trunk/column`,
        );
        assert.ok(
          slot.y >= Math.round(offsetY + edge[1] * scale),
          'the reveal must not extend above the straight trunk edge',
        );
        assert.ok(slot.y >= 36, 'do not reveal a pet from an offscreen obstacle');
      }
    }
  }
  assert.deepEqual(peekingSpectators('MUSHROOM_FOREST', 360, 640), []);
});

test('큰 창에서는 관중 프레임도 배경에 맞춰 커지고 얼굴만 고정 크롭하지 않는다', () => {
  for (const theme of themes) {
    const small = peekingSpectators(theme, 640, 420)[0]!;
    const large = peekingSpectators(theme, 1440, 900)[0]!;
    assert.ok(large.frameSize > small.frameSize);
    assert.equal(large.frameSize % 32, 0);
    assert.ok(large.frameSize <= 128);
    assert.equal(large.width, large.frameSize * 2);
    assert.equal(large.height, large.frameSize * 1.25);
  }
});

test('빈 화면과 잘린 장애물은 가짜 위치에 관중을 띄우지 않는다', () => {
  assert.deepEqual(peekingSpectators('MUSHROOM_FOREST', 0, 0), []);
  assert.deepEqual(peekingSpectators('CRYSTAL_RUINS', Number.NaN, 180), []);
  assert.deepEqual(peekingSpectators('STARLIGHT_SHRINE', -20, 180), []);
  assert.ok(peekingSpectators('MUSHROOM_FOREST', 360, 640).length < 3);
});
