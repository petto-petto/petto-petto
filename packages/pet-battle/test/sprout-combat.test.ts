import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advancePetCombat,
  petCombatAnimation,
  petCombatPose,
  sproutRootPixels,
} from '../src/view/pet-combat-animations.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const origin = { x: 40, y: 260 };
const target = { x: 120, y: 250 };
const profile = () => petCombatAnimation('sprout_treant');

test('새싹나무는 제자리 준비·뿌리 타격·회수·잎 복귀를 1초 안에 완주한다', () => {
  assert.equal(profile().id, 'sprout');
  assert.equal(profile().durationMs, 1000);
  assert.deepEqual(
    [100, 300, 650, 850].map((t) => petCombatPose(profile(), t, origin, target).phase),
    ['ROOT_WINDUP', 'ROOT_STRIKE', 'ROOT_RETRACT', 'LEAF_SETTLE'],
  );
  for (let t = 0; t <= 1000; t += 10) {
    const pose = petCombatPose(profile(), t, origin, target);
    assert.deepEqual(pose.position, origin);
    assert.equal(pose.burrow, 0);
    assert.equal(pose.hand, null);
  }
});

test('느린 프레임도 기존 공통 타격 시점에 한 번만 맞고 복귀한다', () => {
  for (const delta of [16, 200, 1000]) {
    let elapsed = 0,
      hits = 0,
      previous = false;
    const phases = new Set<string>();
    while (elapsed < profile().durationMs) {
      const pose = petCombatPose(profile(), elapsed, origin, target);
      if (pose.impact && !previous) hits++;
      previous = pose.impact;
      phases.add(pose.phase);
      elapsed = advancePetCombat(profile(), elapsed, delta);
    }
    assert.equal(hits, 1);
    for (const phase of ['ROOT_WINDUP', 'ROOT_STRIKE', 'ROOT_RETRACT', 'LEAF_SETTLE'])
      assert.ok(phases.has(phase));
  }
  assert.equal(petCombatPose(profile(), 249, origin, target).impact, false);
  assert.equal(petCombatPose(profile(), 250, origin, target).impact, true);
  assert.equal(petCombatPose(profile(), 390, origin, target).impact, false);
});

test('새싹나무 수동 미리보기는 STOP·메뉴 상태에서 한 번 완주하고 선택 변경으로 취소된다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'sprout:1',
    running: false,
    menuOpen: true,
    petSprite: 'sprout_treant',
    petFrontRatio: 0.75,
  };
  const arena = new ArenaDirector(() => 0.35);
  const initial = arena.frame(options);
  let hits = 0,
    previous = false;
  for (let nowMs = 20; nowMs <= 1600; nowMs += 20) {
    const frame = arena.frame({ ...options, nowMs, manualAttack: 1 });
    assert.deepEqual(frame.world.pet, initial.world.pet);
    if (frame.petImpact && !previous) hits++;
    previous = frame.petImpact;
    assert.equal(frame.enemyImpact, false);
  }
  assert.equal(hits, 1);
  const cancelled = arena.frame({
    ...options,
    nowMs: 1620,
    key: 'other:1',
    petSprite: 'mole_digger',
  });
  assert.equal(cancelled.petAnimation.phase, 'IDLE');
  assert.equal(cancelled.petImpact, false);
});

test('뿌리는 지면을 따라 정수 픽셀로 적까지 닿고 진화는 잎·잔뿌리만 풍성하게 한다', () => {
  const pose = petCombatPose(profile(), 300, origin, target);
  const versions = [0, 1, 2].map((evolution) =>
    sproutRootPixels(pose, origin, target, evolution, 3),
  );
  assert.ok(versions[0]!.some((p) => Math.abs(p.x - target.x) <= 3));
  assert.ok(versions[0]!.length < versions[1]!.length && versions[1]!.length < versions[2]!.length);
  for (const pixels of versions) {
    for (const pixel of pixels) {
      for (const value of [pixel.x, pixel.y, pixel.width, pixel.height]) assert.equal(value % 3, 0);
      assert.ok(['#2c2438', '#8b6a4a', '#a5763f', '#6fb03a'].includes(pixel.color));
    }
  }
  assert.deepEqual(
    sproutRootPixels(petCombatPose(profile(), 1000, origin, target), origin, target, 2, 3),
    [],
  );
  const reduced = petCombatPose(profile(), 300, origin, target, true);
  assert.equal(reduced.impact, true);
  assert.equal(reduced.bodyDip, 0);
  assert.deepEqual(sproutRootPixels(reduced, origin, target, 2, 3), []);
});

test('자동 새싹나무도 제자리 타격하고 STOP·정복·선택 변경으로 잔뿌리를 정리한다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'sprout:1',
    running: true,
    petSprite: 'sprout_treant',
    petFrontRatio: 0.75,
  };
  for (const change of [
    { running: false },
    { hpRatio: 0 },
    { key: 'other:1', petSprite: 'mole_digger' },
    { suspended: true },
  ]) {
    const arena = new ArenaDirector(() => 0.35);
    let at = 0;
    let cycleOrigin: typeof origin | undefined;
    for (let nowMs = 0; nowMs < 20000; nowMs += 20) {
      const frame = arena.frame({ ...options, nowMs });
      if (frame.attackTurn === 'PET') {
        cycleOrigin ??= frame.world.pet;
        assert.deepEqual(frame.world.pet, cycleOrigin);
      }
      if (frame.petAnimation.rootReach > 0) {
        at = nowMs;
        break;
      }
    }
    assert.ok(at);
    const cancelled = arena.frame({ ...options, ...change, nowMs: at + 20 });
    assert.equal(cancelled.petAnimation.rootReach, 0);
    assert.equal(cancelled.petAnimation.leafBurst, 0);
    assert.equal(cancelled.petImpact, false);
  }
});
