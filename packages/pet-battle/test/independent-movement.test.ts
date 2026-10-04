import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const options = (hpRatio: number, width = 956): ArenaInput => ({
  layout: battleLayout(width, 536),
  nowMs: 0,
  hpRatio,
  enemyHeight: 80,
  theme: 'MUSHROOM_FOREST',
  key: 'pet:stage-1',
  running: true,
});

function samples(hpRatio: number, width = 956) {
  const director = new ArenaDirector(() => 0.35);
  const frames: ArenaFrame[] = [];
  for (let nowMs = 0; nowMs <= 40000; nowMs += 20) {
    frames.push(director.frame({ ...options(hpRatio, width), nowMs }));
  }
  return frames;
}

test('HP 방향대로 각자 움직이며 상대의 보행 종료를 기다리지 않는다', () => {
  for (const hp of [1, 0.600001, 0.6, 0.250001, 0.25, 0.01]) {
    const frames = samples(hp);
    const direction = hp > 0.6 ? -1 : 1;
    let overlap = 0;
    let unequal = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1]!;
      const frame = frames[index]!;
      if (frame.attackTurn !== null || previous.attackTurn !== null) continue;
      const petDx = frame.world.pet.x - previous.world.pet.x;
      const enemyDx = frame.world.enemy.x - previous.world.enemy.x;
      assert.ok(petDx * direction >= -0.00001, `pet walks backwards at HP ${hp}`);
      assert.ok(enemyDx * direction >= -0.00001, `enemy walks backwards at HP ${hp}`);
      if (frame.petStep !== null && frame.enemyStep !== null) {
        overlap++;
        if (Math.abs(petDx - enemyDx) > 0.01) unequal++;
      }
    }
    assert.ok(overlap >= 5, `both should walk without waiting at HP ${hp}`);
    assert.ok(unequal >= 5, `actors must have independent speeds at HP ${hp}`);
    assert.ok(
      frames.some((frame) => frame.petImpact),
      'pursuit must eventually produce pet hits',
    );
    assert.ok(
      frames.some((frame) => frame.enemyImpact),
      'pursuit must eventually produce slams',
    );
  }
});

test('적 보행 속도는 HP 높음 > 중간 > 낮음이며 빈사 후퇴 거리는 더 길다', () => {
  const movement = [1, 0.6, 0.25].map((hp) => {
    const frames = samples(hp, 1596);
    let distance = 0;
    let duration = 0;
    let retreatDistance = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1]!;
      const frame = frames[index]!;
      if (frame.attackTurn !== null) break;
      const dx = Math.abs(frame.world.enemy.x - previous.world.enemy.x);
      retreatDistance += dx;
      if (frame.enemyStep !== null && dx > 0.00001) {
        distance += dx;
        duration += 20;
      }
    }
    assert.ok(duration > 0, `enemy must walk at HP ${hp}`);
    return { speed: (distance / duration) * 1000, retreatDistance };
  });
  assert.ok(movement[0]!.speed > movement[1]!.speed * 1.2, 'healthy enemy follows faster');
  assert.ok(movement[1]!.speed > movement[2]!.speed * 1.5, 'wounded enemy is markedly slower');
  assert.ok(
    movement[2]!.retreatDistance > movement[1]!.retreatDistance * 1.2,
    'critically wounded enemy withdraws farther before stopping for a fight',
  );
});

test('지면 경로는 일정한 직선이나 고정 대각선으로만 움직이지 않는다', () => {
  for (const hp of [1, 0.6, 0.25]) {
    const frames = samples(hp);
    for (const actor of ['pet', 'enemy'] as const) {
      const slopes = new Set<number>();
      let depth = 0;
      for (let index = 1; index < frames.length; index++) {
        const previous = frames[index - 1]!;
        const frame = frames[index]!;
        if (frame.attackTurn !== null || previous.attackTurn !== null) continue;
        const dx = frame.world[actor].x - previous.world[actor].x;
        const dy = frame.world[actor].y - previous.world[actor].y;
        if (Math.abs(dx) > 0.01) {
          slopes.add(Math.round((dy / dx) * 10));
          depth += Math.abs(dy);
        }
      }
      assert.ok(depth > 2, `${actor} needs ground-depth movement at HP ${hp}`);
      assert.ok(slopes.size >= 3, `${actor} needs varying route curvature at HP ${hp}`);
    }
  }
});

test('공격 후 다음 보행을 시작할 때 처음 자리로 순간 복귀하지 않는다', () => {
  for (const hp of [1, 0.6, 0.25]) {
    const frames = samples(hp);
    let exchanges = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1]!;
      const frame = frames[index]!;
      if (previous.attackTurn === null || frame.attackTurn !== null) continue;
      exchanges++;
      for (const actor of ['pet', 'enemy'] as const) {
        assert.ok(
          Math.hypot(
            frame.world[actor].x - previous.world[actor].x,
            frame.world[actor].y - previous.world[actor].y,
          ) < 3,
          `${actor} teleported after the attack at HP ${hp}`,
        );
      }
    }
    assert.ok(exchanges >= 2, 'several attack exchanges resume in place');
  }
});

test('랜덤 경로는 seed로 재현 가능하며 HP 방향과 무관하게 개체별 깊이를 바꾼다', () => {
  const random = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const hp of [1, 0.6, 0.25]) {
    const first = new ArenaDirector(random(7));
    const replay = new ArenaDirector(random(7));
    const alternative = new ArenaDirector(random(99));
    const changed = { pet: false, enemy: false };
    let previous: ArenaFrame | undefined;
    for (let nowMs = 0; nowMs <= 16000; nowMs += 20) {
      const frame = first.frame({ ...options(hp), nowMs });
      assert.deepEqual(frame, replay.frame({ ...options(hp), nowMs }));
      const other = alternative.frame({ ...options(hp), nowMs });
      for (const actor of ['pet', 'enemy'] as const) {
        changed[actor] ||= Math.abs(frame.world[actor].y - other.world[actor].y) > 0.5;
        if (previous && frame.attackTurn === null && previous.attackTurn === null) {
          assert.ok(
            (frame.world[actor].x - previous.world[actor].x) * (hp > 0.6 ? -1 : 1) >= -0.00001,
          );
        }
      }
      previous = frame;
    }
    assert.ok(changed.pet && changed.enemy, `both actors get a varied route at HP ${hp}`);
  }
});
