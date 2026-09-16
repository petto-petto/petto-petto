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
      assert.ok(slots.length > 0 && slots.length <= 3);
      const scale = Math.max(width! / 1915, height! / 821);
      for (const slot of slots) {
        const edge = (width! - 1915 * scale) / 2 + slot.sourceX * scale;
        assert.equal(slot.x + slot.frameSize, Math.round(edge));
        assert.equal(
          slot.y + slot.height,
          Math.round((height! - 821 * scale) / 2 + slot.sourceY * scale),
        );
        assert.ok(edge >= 0 && edge <= width!);
        assert.ok(slot.y + slot.height > 36);
      }
    }
  }
});

test('큰 창에서는 관중 프레임도 배경에 맞춰 커지고 얼굴만 고정 크롭하지 않는다', () => {
  for (const theme of themes) {
    const small = peekingSpectators(theme, 360, 180)[0]!;
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

test('기본 데모와 큰 창에서 3마리와 이전 64·96·128px 크기를 유지한다', () => {
  for (const theme of themes) {
    for (const [width, height, size] of [
      [360, 180, 64],
      [636, 416, 64],
      [640, 420, 64],
      [960, 540, 96],
      [1440, 900, 128],
      [1920, 1080, 128],
    ]) {
      const slots = peekingSpectators(theme, width!, height!);
      assert.equal(slots.length, 3, theme + ' ' + width + '×' + height);
      assert.ok(slots.every((slot) => slot.frameSize === size));
    }
  }
});

test('숲의 가지가 튀어나온 부분은 수직 가림선 대신 원본 계단형 윤곽을 따른다', () => {
  const width = 1440,
    height = 900;
  const slot = peekingSpectators('MUSHROOM_FOREST', width, height).find(
    (slot) => slot.sourceX === 334,
  )!;
  assert.ok(slot);
  const scale = Math.max(width / 1915, height / 821);
  const x = Math.round((width - 1915 * scale) / 2 + 352 * scale) - slot.x;
  const y = Math.round((height - 821 * scale) / 2 + 241 * scale) - slot.y;
  assert.ok(
    slot.clipPath.includes(x + 'px ' + y + 'px'),
    'branch edge must project with the background',
  );
  assert.match(slot.clipPath, /^polygon\(/);
});
