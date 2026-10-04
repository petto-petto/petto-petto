import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

function options(hpRatio: number): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet:1',
    running: true,
  };
}

for (const hp of [1, 0.6, 0.25]) {
  test(`HP ${hp}: 추격자는 0.6초 여유를 주고 선행자가 걷는 도중 따라간다`, () => {
    const director = new ArenaDirector(() => 0.35);
    const initial = director.frame(options(hp));
    const leader = hp > 0.6 ? 'pet' : 'enemy';
    const follower = leader === 'pet' ? 'enemy' : 'pet';
    let overlappingSteps = 0;
    let leaderTravel = 0;
    for (let nowMs = 20; nowMs <= 1200; nowMs += 20) {
      const frame = director.frame({ ...options(hp), nowMs });
      if (nowMs <= 600) {
        assert.deepEqual(
          frame.world[follower],
          initial.world[follower],
          'do not immediately chase',
        );
        assert.equal(follower === 'pet' ? frame.petStep : frame.enemyStep, null);
      }
      if (nowMs === 600) leaderTravel = Math.abs(frame.world[leader].x - initial.world[leader].x);
      if (frame.petStep !== null && frame.enemyStep !== null) overlappingSteps++;
    }
    assert.ok(leaderTravel >= 4, 'the gap is time spent retreating, not both actors idling');
    assert.ok(overlappingSteps >= 5, 'follower must not wait for the entire retreat to end');
  });

  test(`HP ${hp}: 첫 후퇴 거리와 두 번째 교전 전 보행 시간을 충분히 확보한다`, () => {
    const director = new ArenaDirector(() => 0.35);
    const input = options(hp);
    let previous = director.frame(input);
    let start = previous;
    let began = 0;
    const cycles: { elapsed: number; pet: number; enemy: number }[] = [];
    for (let nowMs = 20; nowMs <= 25000; nowMs += 20) {
      const frame = director.frame({ ...input, nowMs });
      if (frame.attackTurn !== null && previous.attackTurn === null) {
        cycles.push({
          elapsed: nowMs - began,
          pet: Math.abs(frame.world.pet.x - start.world.pet.x),
          enemy: Math.abs(frame.world.enemy.x - start.world.enemy.x),
        });
        if (cycles.length === 2) break;
      }
      if (frame.attackTurn === null && previous.attackTurn !== null) {
        start = frame;
        began = nowMs;
      }
      previous = frame;
    }
    assert.equal(cycles.length, 2, 'do not stall before the next attack');
    const leader = hp > 0.6 ? 'pet' : 'enemy';
    assert.ok(cycles[0]![leader] >= (hp <= 0.25 ? 60 : 40), 'opening retreat covers more ground');
    assert.ok(cycles[1]!.elapsed >= 1000, 'repeat engagement must not collapse to 0.3 seconds');
    const minimumTravel = hp <= 0.25 ? 8 : 20;
    assert.ok(
      cycles[1]!.pet >= minimumTravel && cycles[1]!.enemy >= minimumTravel,
      'both actors take real steps between attacks',
    );
  });
}

test('추격 반응 대기 중 STOP·메뉴는 시계를 멈추고 재개 시 남은 텀을 보존한다', () => {
  for (const pause of [{ running: false }, { menuOpen: true }]) {
    const director = new ArenaDirector(() => 0.35);
    const input = options(1);
    let frame = director.frame(input);
    for (let nowMs = 20; nowMs <= 300; nowMs += 20) frame = director.frame({ ...input, nowMs });
    const before = frame;
    for (let nowMs = 320; nowMs <= 1300; nowMs += 20) {
      frame = director.frame({ ...input, ...pause, nowMs });
      assert.deepEqual(frame.world, before.world);
    }
    for (let nowMs = 1320; nowMs <= 1600; nowMs += 20) {
      frame = director.frame({ ...input, nowMs });
      assert.deepEqual(frame.world.enemy, before.world.enemy);
    }
    for (let nowMs = 1620; nowMs <= 1800; nowMs += 20) frame = director.frame({ ...input, nowMs });
    assert.notDeepEqual(frame.world.enemy, before.world.enemy, 'chase eventually resumes');
  }
});

test('최소 창 경계와 모션 감소에서는 후퇴 거리를 강요하지 않고 정상 공격한다', () => {
  for (const hpRatio of [1, 0.6, 0.25])
    for (const reducedMotion of [false, true]) {
      const director = new ArenaDirector(() => 0.35);
      const input = { ...options(hpRatio), layout: battleLayout(356, 176), reducedMotion };
      let previous: ArenaFrame | undefined;
      let impacts = 0;
      for (let nowMs = 0; nowMs <= 24000; nowMs += 20) {
        const frame = director.frame({ ...input, nowMs });
        if (frame.petImpact && !previous?.petImpact) impacts++;
        assert.ok(frame.world.pet.x >= 16);
        assert.ok(frame.world.enemy.x <= input.layout.width - input.layout.enemyFrameSize - 16);
        previous = frame;
      }
      assert.ok(impacts >= 3, 'no waiting forever at a boundary');
    }
});
