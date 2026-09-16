import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battleLayout, menuPositions, projectPetOffset } from '../src/view/layout.ts';

test('작은 창에서도 전투 펫은 기존 128px를 유지하고 위치만 재배치한다', () => {
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [276, 176],
    [356, 636],
  ]) {
    const layout = battleLayout(width!, height!);
    assert.equal(layout.petSize, 128);
    assert.equal(layout.scale, 1);
    assert.ok(layout.petLeft >= 8);
    assert.ok(layout.enemyLeft + layout.petSize + 12 < width!);
    assert.ok(layout.floor - layout.petSize >= 36);
    assert.ok(layout.floor <= height! - 8);
    assert.ok(layout.enemyLeft - layout.petLeft >= 102);
    assert.ok(8 + layout.spectatorSize * 3 + 8 <= layout.petLeft);
    assert.ok(layout.petSize % 32 === 0, '도트 기준 크기 단위 유지');
  }
  const small = battleLayout(356, 176);
  const large = battleLayout(636, 416);
  assert.equal(small.petSize, large.petSize);
  assert.ok(small.enemyLeft - small.petLeft < large.enemyLeft - large.petLeft);
});

test('돌진은 현재 캐릭터 간격에 맞게 환산되고 멈춤 위치는 바뀌지 않는다', () => {
  for (const width of [276, 356, 636, 956]) {
    const layout = battleLayout(width, 416);
    const offset = projectPetOffset(layout, { x: 34, y: 0 });
    assert.equal(offset.x, layout.attackDistance);
    assert.ok(layout.petLeft + offset.x + layout.petSize < width - 8);
    assert.deepEqual(projectPetOffset(layout, { x: 0, y: 0 }), { x: 0, y: 0 });
    assert.equal(layout.enemyLeft - (layout.petLeft + offset.x), layout.petSize * (102 / 128));
  }
});

test('작은 창에서도 모든 조작 버튼이 겹치거나 잘리지 않는다', () => {
  for (const [width, height] of [
    [276, 176],
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    const layout = battleLayout(width!, height!);
    for (const target of ['PET', 'ENEMY'] as const) {
      const buttons = menuPositions(layout, target);
      assert.equal(buttons.length, target === 'PET' ? 6 : 7);
      buttons.forEach((button, index) => {
        assert.ok(button.x >= 4 && button.x + 32 <= width! - 4);
        assert.ok(button.y >= 36 && button.y + 32 <= height! - 24);
        for (const other of buttons.slice(index + 1)) {
          assert.ok(Math.abs(button.x - other.x) >= 32 || Math.abs(button.y - other.y) >= 32);
        }
      });
    }
  }
});
