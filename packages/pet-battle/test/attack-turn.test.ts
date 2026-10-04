import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';
import { combatContactDistance } from '../src/view/footwork.ts';

function options(overrides: Partial<ArenaInput> = {}): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet:stage-1',
    running: true,
    ...overrides,
  };
}

test('사거리 안에서 한 캐릭터만 공격하며 공격·피격·보행 신호는 차례를 공유한다', () => {
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    for (const enemyHeight of [56, 64, 80]) {
      for (const hpRatio of [1, 0.6, 0.25]) {
        const director = new ArenaDirector(() => 0.35);
        const input = options({ layout: battleLayout(width!, height!), enemyHeight, hpRatio });
        const turns = new Set<string>();
        let petImpact = false;
        let enemyImpact = false;
        for (let nowMs = 0; nowMs <= 16080; nowMs += 10) {
          const frame = director.frame({ ...input, nowMs });
          assert.ok(
            frame.attackTurn === null || frame.attackTurn === 'PET' || frame.attackTurn === 'ENEMY',
          );
          if (frame.attackTurn !== null) {
            turns.add(frame.attackTurn);
            assert.equal(frame.inAttackRange, true);
            const gap =
              frame.world.enemy.x -
              frame.world.pet.x -
              combatContactDistance(input.layout, enemyHeight);
            assert.ok(gap <= 24.00001, `out-of-range attack: ${gap}`);
            assert.ok(Math.abs(frame.world.enemy.y - frame.world.pet.y) <= 8);
            assert.equal(frame.petStep, null);
            assert.equal(frame.enemyStep, null);
          }
          if (frame.petAttack || frame.petImpact) {
            assert.equal(frame.attackTurn, 'PET');
            assert.equal(frame.petHit || frame.enemyImpact, false);
          }
          if (frame.enemyImpact || frame.petHit) {
            assert.equal(frame.attackTurn, 'ENEMY');
            assert.equal(frame.petAttack || frame.petImpact, false);
          }
          petImpact ||= frame.petImpact;
          enemyImpact ||= frame.enemyImpact;
        }
        assert.deepEqual([...turns], ['PET', 'ENEMY']);
        assert.ok(petImpact && enemyImpact, 'both actors still take their own attack turn');
      }
    }
  }
});

test('멀리 떨어져 있으면 실제 사거리에 도달하기 전까지 허공 공격을 만들지 않는다', () => {
  for (const reducedMotion of [false, true]) {
    const director = new ArenaDirector(() => 0.35);
    const layout = { ...battleLayout(956, 536), petLeft: 140, enemyLeft: 660 };
    let approached = false;
    for (let nowMs = 0; nowMs < 40000; nowMs += 25) {
      const frame = director.frame(options({ layout, reducedMotion, nowMs }));
      if (!frame.inAttackRange) {
        assert.equal(
          frame.petAttack || frame.petImpact || frame.enemyImpact || frame.petHit,
          false,
        );
        assert.equal(frame.attackTurn, null);
      }
      if (frame.attackTurn !== null) approached = true;
    }
    if (!reducedMotion) assert.ok(approached, 'distant actors pursue until they can fight');
  }
});

test('펫 복귀와 적 피격 반응이 끝날 때까지 적은 공격 준비를 시작하지 않는다', () => {
  const director = new ArenaDirector(() => 0.35);
  let recoveredFrames = 0;
  let sawEnemy = false;
  for (let nowMs = 0; nowMs < 40000; nowMs += 10) {
    const frame = director.frame(options({ nowMs }));
    if (frame.phase === 'PET_RECOVER') {
      recoveredFrames++;
      assert.equal(frame.attackTurn, 'PET');
      assert.equal(frame.petAttack, false);
      assert.equal(frame.enemy.scaleX, 1, 'enemy crouch must wait for pet recovery');
      assert.equal(frame.enemy.scaleY, 1);
    }
    if (frame.attackTurn === 'ENEMY') {
      assert.equal(frame.phase, 'CROUCH');
      sawEnemy = true;
      break;
    }
  }
  assert.equal(recoveredFrames, 20);
  assert.ok(sawEnemy);
});

test('STOP·메뉴·HP 0·펫 교체는 공격 차례와 공격 신호를 즉시 해제한다', () => {
  for (const phase of ['PET_ATTACK', 'JUMP', 'SLAM']) {
    for (const change of [
      { running: false },
      { menuOpen: true },
      { hpRatio: 0 },
      { key: 'pet-b:stage-1' },
    ]) {
      const director = new ArenaDirector(() => 0.35);
      let at = 0;
      for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
        const frame = director.frame(options({ nowMs }));
        if (frame.phase === phase) {
          at = nowMs;
          break;
        }
      }
      assert.ok(at > 0, 'cancel from an actual active attack');
      const stopped = director.frame(options({ nowMs: at + 10, ...change }));
      assert.equal(stopped.attackTurn, null);
      assert.equal(
        stopped.petAttack || stopped.petImpact || stopped.enemyImpact || stopped.petHit,
        false,
      );
    }
  }
});
