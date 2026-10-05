import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

function input(nowMs: number, overrides: Partial<ArenaInput> = {}): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet-a:1:idle-stage1',
    running: true,
    ...overrides,
  };
}

function moved(overrides: Partial<ArenaInput> = {}) {
  const director = new ArenaDirector(() => 0.35);
  let frame = director.frame(input(0, overrides));
  for (let at = 20; at <= 1000; at += 20) frame = director.frame(input(at, overrides));
  return { director, frame };
}

function assertContained(frame: ArenaFrame, options: ArenaInput) {
  for (const [pose, size] of [
    [frame.pet, 96],
    [frame.enemy, 128],
  ] as const) {
    assert.ok(pose.x - (size * (pose.scaleX - 1)) / 2 >= 4);
    assert.ok(pose.x + size + (size * (pose.scaleX - 1)) / 2 <= options.layout.width - 4);
    assert.ok(pose.y - size * pose.scaleY >= 4);
    assert.ok(pose.y <= options.layout.height - 4);
  }
  assert.ok(frame.world.enemy.x - frame.world.pet.x >= frame.minimumSeparation - 0.00001);
}

test('가로 확대는 현재 좌우 위치·카메라·추적 목표를 중앙으로 초기화하지 않는다', () => {
  for (const hpRatio of [1, 0.6, 0.25]) {
    const { director, frame: before } = moved({ hpRatio });
    const after = director.frame(input(1000, { hpRatio, layout: battleLayout(956, 416) }));
    assert.deepEqual(after.world, before.world);
    assert.deepEqual(after.camera, before.camera);
    assert.deepEqual(after.cameraTarget, before.cameraTarget);
    assert.equal(after.pet.x, before.pet.x);
    assert.equal(after.enemy.x, before.enemy.x);
  }
});

test('펫 ID·진화 에셋·스테이지 변경과 잠깐의 선택 해제도 기존 좌표를 유지한다', () => {
  for (const key of ['pet-b:1:idle-stage1', 'pet-a:1:idle-stage2', 'pet-a:2:idle-stage1', null]) {
    const { director, frame: before } = moved();
    const changed = director.frame(input(1000, { key, running: false }));
    assert.deepEqual(changed.world, before.world);
    assert.deepEqual(changed.camera, before.camera);
    assert.equal(changed.attackTurn, null);
    const selected = director.frame(input(1000, { key: 'pet-c:1:idle-stage1', running: false }));
    assert.deepEqual(selected.world, before.world);
    assert.deepEqual(selected.camera, before.camera);
  }
});

test('세로 확대는 좌우 위치와 바닥에서의 깊이를 유지하며 카메라 기록도 함께 옮긴다', () => {
  const { director, frame: before } = moved();
  const oldLayout = battleLayout(636, 416);
  const newLayout = battleLayout(636, 536);
  const after = director.frame(input(1000, { layout: newLayout, running: false }));
  for (const actor of ['pet', 'enemy'] as const) {
    assert.equal(after.world[actor].x, before.world[actor].x);
    assert.ok(
      Math.abs(newLayout.floor - after.world[actor].y - (oldLayout.floor - before.world[actor].y)) <
        0.001,
    );
  }
  assert.deepEqual(after.camera, before.camera);
  assert.ok(Math.abs(after.cameraTarget.y - before.cameraTarget.y) < 0.001);
});

test('연속 가로 resize도 추격 반응·발걸음 시계와 타격 차례를 재시작하지 않는다', () => {
  for (const hpRatio of [1, 0.6, 0.25]) {
    const resized = new ArenaDirector(() => 0.35);
    const unchanged = new ArenaDirector(() => 0.35);
    let impacts = 0;
    let enemyImpact = false;
    // Compare the same encounter. A later encounter may legitimately choose a
    // new retreat budget from the new width; the current stride must not restart.
    for (let nowMs = 0; nowMs <= 40000; nowMs += 20) {
      const width = nowMs % 40 === 0 ? 636 : 646;
      const frame = resized.frame(input(nowMs, { hpRatio, layout: battleLayout(width, 416) }));
      const reference = unchanged.frame(input(nowMs, { hpRatio }));
      assert.deepEqual(frame.world, reference.world);
      assert.equal(frame.phase, reference.phase);
      assert.equal(frame.petStep, reference.petStep);
      assert.equal(frame.enemyStep, reference.enemyStep);
      assert.equal(frame.petImpact, reference.petImpact);
      assert.equal(frame.enemyImpact, reference.enemyImpact);
      if (frame.petImpact) impacts++;
      if (frame.enemyImpact) {
        enemyImpact = true;
        break;
      }
    }
    assert.ok(impacts > 0, 'resizing must not continually postpone attacks');
    assert.ok(enemyImpact, 'the same encounter must reach the enemy turn');
  }
});

test('도약 중 확대는 공격 차례·현재 위치를 유지하고 같은 상대에게 착지한다', () => {
  const director = new ArenaDirector(() => 0.35);
  let before = director.frame(input(0));
  let at = 0;
  for (at = 20; at <= 20000; at += 20) {
    before = director.frame(input(at));
    if (before.phase === 'JUMP' && before.world.enemy.y - before.enemy.y - before.camera.y > 15)
      break;
  }
  assert.ok(at < 20000);
  const after = director.frame(input(at, { layout: battleLayout(956, 416) }));
  assert.deepEqual(after.world, before.world);
  assert.deepEqual(after.enemy, before.enemy);
  assert.equal(after.phase, before.phase);
  assert.equal(after.attackTurn, 'ENEMY');
  let impact = false;
  for (let nowMs = at + 20; nowMs < at + 1600; nowMs += 20) {
    const next = director.frame(input(nowMs, { layout: battleLayout(956, 416) }));
    impact ||= next.enemyImpact;
    assertContained(next, input(nowMs, { layout: battleLayout(956, 416) }));
  }
  assert.ok(impact);
});

test('축소는 필요한 경계 보정만 하고 지연 카메라가 이전 큰 좌표로 되돌리지 않는다', () => {
  const { director, frame: before } = moved({ layout: battleLayout(956, 536) });
  const options = input(1000, { layout: battleLayout(356, 176), running: false });
  const small = director.frame(options);
  assertContained(small, options);
  assert.ok(
    Math.abs(
      small.world.enemy.x - small.world.pet.x - (before.world.enemy.x - before.world.pet.x),
    ) < 0.001,
  );
  assert.ok(small.world.enemy.x > 200, 'clamp at the right edge, not the new center');
  for (let nowMs = 1020; nowMs <= 2200; nowMs += 20) {
    const frame = director.frame({ ...options, nowMs });
    assert.deepEqual(frame.world, small.world);
    assertContained(frame, options);
    assert.ok(
      Math.abs(frame.pet.x - small.pet.x) < 32,
      'only the bounded delayed camera may catch up',
    );
  }
});

test('최초 빈 상태 후 선택은 화면 안에서 시작하고 교체 후에도 전투가 계속된다', () => {
  const director = new ArenaDirector(() => 0.35);
  director.frame(input(0, { key: null }));
  let impacts = 0;
  for (let nowMs = 20; nowMs <= 12000; nowMs += 20) {
    const options = input(nowMs, { key: nowMs < 3000 ? 'pet-a' : 'pet-b' });
    const frame = director.frame(options);
    assertContained(frame, options);
    if (nowMs === 3000) assert.equal(frame.petImpact || frame.enemyImpact, false);
    if (nowMs > 3000 && frame.petImpact) impacts++;
  }
  assert.ok(impacts > 0);
});
