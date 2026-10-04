import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

function input(nowMs: number, overrides: Partial<ArenaInput> = {}): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs,
    hpRatio: 0.6,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet-a:stage-1',
    running: true,
    ...overrides,
  };
}

for (const [label, pause] of [
  ['STOP', { running: false }],
  ['메뉴', { menuOpen: true }],
  ['적 정복', { hpRatio: 0 }],
] as const) {
  test(`${label} 상태에서 펫이 멈춰도 카메라는 남은 500ms 지연 경로를 따라온 뒤 안정된다`, () => {
    const director = new ArenaDirector(() => 0.35);
    const initial = director.frame(input(0));
    let before = initial;
    for (let nowMs = 50; nowMs <= 1000; nowMs += 50) before = director.frame(input(nowMs));
    assert.ok(
      before.world.pet.x - initial.world.pet.x > 10,
      'pet has moved, camera is still delayed',
    );
    let settled = before;
    for (let nowMs = 1050; nowMs <= 3000; nowMs += 50) {
      settled = director.frame(input(nowMs, pause));
      assert.deepEqual(settled.world, before.world, 'only camera moves, never paused combatants');
      assert.equal(settled.petStep, null);
      assert.equal(settled.enemyStep, null);
      assert.equal(settled.attackTurn, null);
    }
    for (const axis of ['x', 'y'] as const) {
      const expected = before.world.pet[axis] - initial.world.pet[axis];
      assert.ok(
        Math.abs(settled.cameraTarget[axis] - expected) < 0.001,
        `${axis}: sample stopped pet in presentation time`,
      );
      assert.ok(
        Math.abs(settled.camera[axis] - expected) < 0.01,
        `${axis}: camera catches up instead of freezing`,
      );
    }
    assert.ok(settled.camera.x - before.camera.x > 10);
    const held = director.frame(input(3050, pause));
    assert.ok(Math.abs(held.camera.x - settled.camera.x) < 0.01, 'no perpetual camera drift');
  });
}

test('모션 줄이기는 전투 정지와 별개로 카메라 애니메이션을 억제한다', () => {
  const director = new ArenaDirector(() => 0.35);
  let before = director.frame(input(0));
  for (let nowMs = 50; nowMs <= 1300; nowMs += 50) before = director.frame(input(nowMs));
  assert.ok(before.camera.x > 0);
  for (let nowMs = 1350; nowMs <= 3000; nowMs += 50) {
    const frame = director.frame(input(nowMs, { reducedMotion: true, running: false }));
    assert.deepEqual(frame.camera, before.camera);
  }
});
