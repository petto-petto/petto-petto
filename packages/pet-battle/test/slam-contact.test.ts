import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const options = (
  petFrontRatio: number,
  enemyHeight = 80,
  width = 636,
  height = 416,
  hpRatio = 1,
) => ({
  layout: battleLayout(width, height),
  nowMs: 0,
  hpRatio,
  enemyHeight,
  theme: 'MUSHROOM_FOREST' as const,
  key: 'pet:1',
  running: true,
  petFrontRatio,
});

test('적 내려찍기는 프레임 여백이 아닌 펫의 실제 앞끝 4~8px 앞에 착지한다', () => {
  for (const front of [0.625, 0.75, 0.875, 1]) {
    for (const size of [56, 64, 80]) {
      for (const [width, height] of [
        [356, 176],
        [636, 416],
        [956, 536],
        [356, 636],
      ]) {
        for (const hp of [1, 0.6, 0.25]) {
          const input = options(front, size, width, height, hp);
          const arena = new ArenaDirector(() => 0.35);
          let takeoff: ArenaFrame | undefined;
          let landed: ArenaFrame | undefined;
          for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
            const frame = arena.frame({ ...input, nowMs });
            if (frame.phase === 'CROUCH' && !takeoff) takeoff = frame;
            if (frame.enemyImpact) {
              landed = frame;
              break;
            }
          }
          assert.ok(landed?.enemyImpact);
          assert.ok(
            Math.hypot(
              landed.world.pet.x - takeoff!.world.pet.x,
              landed.world.pet.y - takeoff!.world.pet.y,
            ) < 1e-7,
            'never push the waiting pet',
          );
          const petFront = landed.pet.x + 48 + (96 * front - 48) * landed.pet.scaleX;
          const enemyFront =
            landed.enemy.x + 64 - (Math.min(128, (size * 51) / 32) * landed.enemy.scaleX) / 2;
          const gap = enemyFront - petFront;
          assert.ok(
            gap >= 3.99 && gap <= 8,
            `visible contact gap ${gap}, front ${front}, size ${size}`,
          );
        }
      }
    }
  }
});

test('늦게 도착한 펫 픽셀 측정은 진행 중인 도약의 착지점을 바꾸지 않는다', () => {
  const arena = new ArenaDirector(() => 0.35);
  const baseline = new ArenaDirector(() => 0.35);
  let jumping = false;
  let compared = 0;
  for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
    const original = options(0.75);
    const expected = baseline.frame({ ...original, nowMs });
    if (jumping && expected.attackTurn === null) break;
    const frame = arena.frame({ ...original, nowMs, petFrontRatio: jumping ? 0.9 : 0.75 });
    if (jumping) {
      assert.deepEqual(frame.world, expected.world);
      compared++;
    }
    if (expected.phase === 'JUMP') jumping = true;
  }
  assert.ok(compared > 10, 'compare an actual launched jump through its recovery');
});

test('측정값이 없는 경우 기존 접촉 거리로 안전하게 동작한다', () => {
  const { petFrontRatio: _front, ...original }: ReturnType<typeof options> = options(1);
  const arena = new ArenaDirector(() => 0.35);
  for (let nowMs = 0; nowMs <= 8040; nowMs += 10) {
    const frame = arena.frame({ ...original, nowMs });
    assert.ok(Number.isFinite(frame.enemy.x));
    assert.ok(frame.world.pet.x < frame.world.enemy.x);
  }
});
