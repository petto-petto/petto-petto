import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';
import { combatContactDistance } from '../src/view/footwork.ts';

function input(overrides: Partial<ArenaInput> = {}): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet-a:stage-1',
    running: true,
    ...overrides,
  };
}

function advance(director: ArenaDirector, until: number, overrides: Partial<ArenaInput> = {}) {
  let result = director.frame(input(overrides));
  for (let nowMs = 50; nowMs <= until; nowMs += 50) {
    result = director.frame(input({ ...overrides, nowMs }));
  }
  if (until % 50 !== 0) {
    result = director.frame(input({ ...overrides, nowMs: until }));
  }
  return result;
}

function assertInside(frame: ArenaFrame, options: ArenaInput) {
  for (const [pose, size] of [
    [frame.pet, options.layout.petSize],
    [frame.enemy, options.layout.enemyFrameSize],
  ] as const) {
    const left = pose.x - (size * (pose.scaleX - 1)) / 2;
    const right = left + size * pose.scaleX;
    assert.ok(left >= 4, `left ${left}`);
    assert.ok(right <= options.layout.width - 4, `right ${right}`);
    assert.ok(pose.y - size * pose.scaleY >= 4, `top ${pose.y - size * pose.scaleY}`);
    assert.ok(pose.y <= options.layout.height - 4, `bottom ${pose.y}`);
  }
  assert.ok(frame.world.pet.x < frame.world.enemy.x, 'actors never exchange sides');
  assert.ok(frame.world.enemy.x - frame.world.pet.x >= 27, 'land at the pet, never exchange sides');
  assert.ok(Math.abs(frame.camera.x) < frame.backgroundOverscan);
  assert.ok(Math.abs(frame.camera.y) < frame.backgroundOverscan);
}

test('HP 60% 경계를 기준으로 후퇴·추격 역할만 바꾸며 실제 0%는 멈춘다', () => {
  for (const hpRatio of [1, 0.61, 0.600001, 0.6, 0.26, 0.25, 0.01, 0]) {
    const frame = new ArenaDirector(() => 0.35).frame(input({ hpRatio }));
    assert.equal(frame.retreating, hpRatio > 0.6 ? 'PET' : hpRatio > 0 ? 'ENEMY' : null);
  }
});

test('펫 후퇴와 적 후퇴는 HP 방향을 지키며 추격자가 함께 따라온다', () => {
  for (const hpRatio of [1, 0.6]) {
    const director = new ArenaDirector(() => 0.35);
    const first = director.frame(input({ hpRatio }));
    const later = advance(director, 900, { hpRatio });
    const direction = hpRatio > 0.6 ? -1 : 1;
    assert.ok((later.world.pet.x - first.world.pet.x) * direction > 0);
    assert.ok((later.world.enemy.x - first.world.enemy.x) * direction > 0);
  }
});

test('양 HP 구간 모두 반격·웅크리기·도약·내려찍기·피격·회복을 포함한다', () => {
  for (const hpRatio of [1, 0.6, 0.25, 0.01]) {
    const director = new ArenaDirector(() => 0.35);
    const phases = new Set<string>();
    let attack = false;
    let impact = false;
    let hit = false;
    let airborne = false;
    for (let nowMs = 0; nowMs <= 40000; nowMs += 20) {
      const frame = director.frame(input({ hpRatio, nowMs }));
      phases.add(frame.phase);
      attack ||= frame.petAttack;
      impact ||= frame.enemyImpact;
      hit ||= frame.petHit;
      airborne ||= frame.enemy.y + frame.camera.y < frame.world.enemy.y - 4;
    }
    for (const phase of ['RETREAT', 'PET_ATTACK', 'CROUCH', 'JUMP', 'SLAM', 'RECOVER']) {
      assert.ok(phases.has(phase), phase);
    }
    assert.ok(attack && impact && hit && airborne);
  }
});

test('타격·내려찍기는 실제 몸 너비와 피격 팽창을 포함해 겹치지 않고 앞에 멈춘다', () => {
  for (const enemyHeight of [56, 64, 80]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      const director = new ArenaDirector(() => 0.35);
      for (let nowMs = 0; nowMs <= 8040; nowMs += 16) {
        const frame = director.frame(input({ hpRatio, enemyHeight, nowMs }));
        const petRight = frame.pet.x + 48 + 48 * 1.08;
        const enemyLeft = frame.enemy.x + 64 - (((enemyHeight * 51) / 32) * 1.13) / 2 - 5;
        assert.ok(enemyLeft - petRight >= 5, `body overlap at ${nowMs}: ${enemyLeft - petRight}`);
        if (frame.enemyImpact) assert.ok(enemyLeft - petRight <= 16, 'slam still lands close');
      }
    }
  }
});

test('후퇴·추격은 발 딛기와 짧은 들기를 반복하며 정지 그림으로 미끄러지지 않는다', () => {
  for (const hpRatio of [1, 0.6]) {
    for (const end of [16000]) {
      const director = new ArenaDirector(() => 0.35);
      const lifts = { pet: new Set<number>(), enemy: new Set<number>() };
      const scales = { pet: new Set<number>(), enemy: new Set<number>() };
      for (let nowMs = 0; nowMs < end!; nowMs += 20) {
        const frame = director.frame(input({ hpRatio, nowMs }));
        for (const actor of ['pet', 'enemy'] as const) {
          if ((actor === 'pet' ? frame.petStep : frame.enemyStep) === null) continue;
          const lift = frame.world[actor].y - frame[actor].y - frame.camera.y;
          lifts[actor].add(Math.round(lift));
          scales[actor].add(frame[actor].scaleY);
        }
      }
      for (const actor of ['pet', 'enemy'] as const) {
        assert.ok(lifts[actor].has(0), `${actor} must plant a foot`);
        assert.ok(
          [...lifts[actor]].some((lift) => lift >= 2),
          `${actor} needs visible stepping lift`,
        );
        assert.ok(scales[actor].size >= 3, `${actor} needs distinct step poses`);
      }
    }
  }
});

test('대형 적의 시작 간격은 겹치지 않으며 추격자도 상대 종료를 기다리지 않고 출발한다', () => {
  for (const hpRatio of [1, 0.6]) {
    const director = new ArenaDirector(() => 0.35);
    const actor = hpRatio > 0.6 ? 'enemy' : 'pet';
    const first = director.frame(input({ hpRatio, enemyHeight: 80 }));
    let moved = false;
    for (let nowMs = 20; nowMs <= 900; nowMs += 20) {
      const frame = director.frame(input({ hpRatio, enemyHeight: 80, nowMs }));
      assertInside(frame, input({ hpRatio, enemyHeight: 80, nowMs }));
      moved ||= Math.abs(frame.world[actor].x - first.world[actor].x) > 0.1;
    }
    assert.ok(moved, 'follower starts during the opening retreat');
  }
});

test('모든 창과 HP에서 보행은 HP 방향을 지키며 독립 이동 중에도 화면 안에 남는다', () => {
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    for (const hpRatio of [1, 0.61, 0.6, 0.26, 0.25, 0.01]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => 0.35);
        const options = input({ layout: battleLayout(width!, height!), hpRatio, enemyHeight });
        let previous = director.frame(options);
        for (let nowMs = 10; nowMs <= 16080; nowMs += 10) {
          const frame = director.frame({ ...options, nowMs });
          if (frame.attackTurn === null && previous.attackTurn === null) {
            const direction = hpRatio > 0.6 ? -1 : 1;
            for (const actor of ['pet', 'enemy'] as const) {
              assert.ok(
                (frame.world[actor].x - previous.world[actor].x) * direction >= -0.00001,
                `${actor} must not walk backwards at ${nowMs}, HP ${hpRatio}`,
              );
            }
          }
          assertInside(frame, options);
          previous = frame;
        }
      }
    }
  }
});

test('소·중·대 적은 펫 방향으로 도약해 바로 앞을 내려찍고 공격 중 펫을 밀지 않는다', () => {
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => 0.35);
        const options = input({ layout: battleLayout(width!, height!), hpRatio, enemyHeight });
        let takeoff: ArenaFrame | undefined;
        let landed: ArenaFrame | undefined;
        let previous: ArenaFrame | undefined;
        let airborne = false;
        for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
          const frame = director.frame({ ...options, nowMs });
          if (frame.phase === 'CROUCH' && !takeoff) takeoff = frame;
          if (!takeoff) continue;
          assert.ok(
            Math.hypot(
              frame.world.pet.x - takeoff.world.pet.x,
              frame.world.pet.y - takeoff.world.pet.y,
            ) < 0.00001,
            'pet holds during targeted leap',
          );
          if (previous) assert.ok(frame.world.enemy.x <= previous.world.enemy.x + 0.00001);
          airborne ||= frame.enemy.y + frame.camera.y < frame.world.enemy.y - 2;
          previous = frame;
          if (frame.enemyImpact) {
            landed = frame;
            break;
          }
        }
        assert.ok(takeoff && landed, 'eventually crouch and land');
        assert.ok(airborne);
        assert.ok(takeoff.world.enemy.x - landed.world.enemy.x > 0, 'not an in-place jump');
        assert.equal(landed.world.enemy.y, landed.world.pet.y, 'land on the pet ground lane');
        assert.equal(landed.enemyImpact, true);
      }
    }
  }
});

for (const hpRatio of [1, 0.6, 0.25]) {
  test(`HP ${hpRatio} 카메라는 정확히 500ms 전 펫의 바닥 위치를 추적하고 적과 발구름 높이를 섞지 않는다`, () => {
    const director = new ArenaDirector(() => 0.35);
    const history = new Map<number, ArenaFrame>();
    // A following pet now starts after 600ms. Observe the same lifted stride
    // after that head start, keeping the camera's independent 500ms delay exact.
    const sampledAt = hpRatio > 0.6 ? 250 : 750;
    const observedAt = sampledAt + 500;
    for (let nowMs = 0; nowMs <= observedAt + 150; nowMs += 50) {
      const frame = director.frame(input({ hpRatio, nowMs }));
      history.set(nowMs, frame);
      if (nowMs < 500) assert.deepEqual(frame.cameraTarget, { x: 0, y: 0 });
    }
    const initial = history.get(0)!;
    const delayed = history.get(sampledAt)!;
    const observed = history.get(observedAt)!;
    assert.notEqual(observed.petStep, null, 'observe the target during pet walking');
    assert.ok(Math.abs(delayed.world.pet.x - initial.world.pet.x) > 0.1);
    assert.ok(
      delayed.world.pet.y - delayed.pet.y - delayed.camera.y > 1,
      'the delayed sprite is lifted above the ground point',
    );
    for (const axis of ['x', 'y'] as const) {
      const petDelta = delayed.world.pet[axis] - initial.world.pet[axis];
      const midpointDelta = delayed.world.midpoint[axis] - initial.world.midpoint[axis];
      assert.ok(
        Math.abs(petDelta - midpointDelta) > 0.1,
        `${axis}: independent enemy movement must distinguish the pet from the midpoint`,
      );
      assert.ok(
        Math.abs(observed.cameraTarget[axis] - petDelta) < 0.001,
        `${axis}: target ${observed.cameraTarget[axis]} must follow pet delta ${petDelta}`,
      );
    }
    assert.ok(Math.abs(observed.camera.x) > 0);
    assert.ok(Math.abs(observed.camera.x) < Math.abs(observed.cameraTarget.x));
  });

  test(`HP ${hpRatio} 불규칙 프레임에서도 500ms 전 펫의 바닥 위치를 시간 보간한다`, () => {
    const director = new ArenaDirector(() => 0.35);
    const times = [
      0, 43, 109, 167, 248, 316, 391, 457, 528, 611, 693, 761, 836, 919, 987, 1053, 1124, 1189,
      1267, 1339, 1413, 1481, 1557, 1621, 1719, 1811, 1973, 2131, 2397, 2613, 2849, 3097, 3319,
    ];
    const history = times.map((nowMs) => ({
      nowMs,
      frame: director.frame(input({ hpRatio, nowMs })),
    }));
    const initial = history[0]!.frame;
    let interpolatedTargets = 0;
    for (const { nowMs, frame } of history) {
      if (nowMs < 500) continue;
      const targetAt = nowMs - 500;
      const secondIndex = history.findIndex((sample) => sample.nowMs > targetAt);
      const first = history[secondIndex - 1]!;
      const second = history[secondIndex]!;
      const fraction = (targetAt - first.nowMs) / (second.nowMs - first.nowMs);
      assert.ok(fraction > 0 && fraction < 1, '500ms ago falls between recorded frames');
      if (Math.abs(second.frame.world.pet.x - first.frame.world.pet.x) > 0.1) {
        interpolatedTargets++;
      }
      for (const axis of ['x', 'y'] as const) {
        const expected =
          first.frame.world.pet[axis] +
          (second.frame.world.pet[axis] - first.frame.world.pet[axis]) * fraction -
          initial.world.pet[axis];
        assert.ok(
          Math.abs(frame.cameraTarget[axis] - expected) < 0.001,
          `${axis} at ${nowMs}: target ${frame.cameraTarget[axis]} must interpolate to ${expected}`,
        );
      }
    }
    assert.ok(interpolatedTargets >= 3, 'exercise interpolation across moving ground samples');
  });
}

test('공격·적 도약·내려찍기 중에도 카메라 목표는 500ms 전 펫 위치를 계속 추적한다', () => {
  const followingPhases = new Set<string>();
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => 0.35);
        const options = input({ layout: battleLayout(width!, height!), hpRatio, enemyHeight });
        let previous = director.frame(options);
        const history = [previous];
        for (let nowMs = 20; nowMs <= 16080; nowMs += 20) {
          const frame = director.frame({ ...options, nowMs });
          history.push(frame);
          const delayed = history[Math.max(0, nowMs / 20 - 25)]!;
          for (const axis of ['x', 'y'] as const) {
            assert.ok(
              Math.abs(
                frame.cameraTarget[axis] - (delayed.world.pet[axis] - history[0]!.world.pet[axis]),
              ) < 0.001,
              `${width}x${height} HP ${hpRatio} ${frame.phase} ${axis} at ${nowMs}`,
            );
          }
          if (
            frame.petStep === null &&
            Math.hypot(frame.camera.x - previous.camera.x, frame.camera.y - previous.camera.y) >
              0.001
          ) {
            followingPhases.add(frame.phase);
          }
          assertInside(frame, options);
          previous = frame;
        }
      }
    }
  }
  for (const phase of ['PET_ATTACK', 'PET_RECOVER', 'JUMP', 'SLAM']) {
    assert.ok(followingPhases.has(phase), `${phase}: camera must not freeze when footsteps stop`);
  }
});

test('최소·기본·큰·세로 창의 모든 HP/적 크기에서 확대 모션과 점프 외곽까지 안전하다', () => {
  for (const [width, height] of [
    [356, 176],
    [636, 416],
    [956, 536],
    [356, 636],
  ]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => 0.35);
        const options = input({ layout: battleLayout(width!, height!), hpRatio, enemyHeight });
        for (let nowMs = 0; nowMs < 8840; nowMs += 32) {
          assertInside(director.frame({ ...options, nowMs }), options);
        }
      }
    }
  }
});

test('움직이거나 도약한 상태의 창 축소도 이전 큰 좌표를 화면 밖에 남기지 않는다', () => {
  const director = new ArenaDirector(() => 0.35);
  advance(director, 3340, { layout: battleLayout(956, 536) });
  const small = input({ layout: battleLayout(356, 176), nowMs: 3356 });
  assertInside(director.frame(small), small);
});

test('최소 창에서도 랜덤 깊이 경로와 반복 교전은 겹침·화면 이탈을 만들지 않는다', () => {
  for (const random of [0.05, 0.5, 0.95]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => random);
        const options = input({ layout: battleLayout(356, 176), hpRatio, enemyHeight });
        let petHit = false;
        let enemyHit = false;
        for (let nowMs = 0; nowMs <= 32000; nowMs += 16) {
          const frame = director.frame({ ...options, nowMs });
          assertInside(frame, options);
          assert.ok(frame.world.enemy.x - frame.world.pet.x >= frame.minimumSeparation - 0.00001);
          petHit ||= frame.petImpact;
          enemyHit ||= frame.enemyImpact;
        }
        assert.ok(petHit && enemyHit, 'near the edge both actors still attack');
      }
    }
  }
});

test('공격·도약 중 메뉴에서 적 크기를 바꾸면 새 몸통 간격을 확보하고 이전 타격을 취소한다', () => {
  for (const [oldHeight, enemyHeight] of [
    [56, 80],
    [80, 56],
  ] as const) {
    for (const moment of ['petImpact', 'enemyImpact', 'JUMP'] as const) {
      const director = new ArenaDirector(() => 0.35);
      const options = input({ enemyHeight: oldHeight });
      let at = 0;
      for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
        const frame = director.frame({ ...options, nowMs });
        if (moment === 'JUMP' ? frame.phase === 'JUMP' : frame[moment]) {
          at = nowMs;
          break;
        }
      }
      assert.ok(at > 0, `change size during actual ${moment}`);
      director.frame({ ...options, menuOpen: true, nowMs: at + 16 });
      const changed = director.frame({ ...options, enemyHeight, menuOpen: true, nowMs: at + 32 });
      const contact = combatContactDistance(options.layout, enemyHeight!);
      assert.equal(changed.attackTurn, null);
      assert.equal(changed.petImpact || changed.enemyImpact || changed.petHit, false);
      assert.ok(
        changed.minimumSeparation >= contact,
        'menu size change updates the contact envelope',
      );
      assert.ok(
        changed.world.enemy.x - changed.world.pet.x >= contact,
        'larger enemy must not overlap the frozen pet',
      );
      assertInside(changed, { ...options, enemyHeight: enemyHeight! });
      const held = director.frame({ ...options, enemyHeight, menuOpen: true, nowMs: at + 232 });
      assert.deepEqual(held.world, changed.world, 'unchanged paused geometry stays still');
      const resumed = director.frame({ ...options, enemyHeight, nowMs: at + 248 });
      assert.equal(resumed.attackTurn, null, 'do not resume an obsolete jump or attack envelope');
      for (let nowMs = at + 264; nowMs < at + 6264; nowMs += 16) {
        const frame = director.frame({ ...options, enemyHeight, nowMs });
        assertInside(frame, { ...options, enemyHeight: enemyHeight! });
        assert.ok(
          frame.world.enemy.x - frame.world.pet.x >= contact - 0.00001,
          'resumed movement and attacks use the new size',
        );
      }
    }
  }
});

test('STOP과 메뉴는 개체 좌표·전투 시계를 고정하고 다시 시작하면 이어서 진행한다', () => {
  for (const pause of [{ running: false }, { menuOpen: true }]) {
    const director = new ArenaDirector(() => 0.35);
    const before = advance(director, 150);
    const paused = director.frame(input({ ...pause, nowMs: 200 }));
    const held = director.frame(input({ ...pause, nowMs: 500 }));
    assert.deepEqual(paused.world, before.world);
    assert.deepEqual(held, paused);
    assert.deepEqual(held.camera, before.camera);
    assert.equal(held.pet.scaleX, 1);
    assert.equal(held.enemy.scaleY, 1);
    assert.equal(held.petAttack || held.petHit || held.enemyImpact, false);
    const resumed = director.frame(input({ nowMs: 550 }));
    assert.notDeepEqual(resumed.world, held.world);
  }
});

test('최소창에서 발을 든 순간 STOP·메뉴·모션 감소로 전환해도 화면을 이탈하지 않는다', () => {
  for (const theme of ['MUSHROOM_FOREST', 'CRYSTAL_RUINS', 'STARLIGHT_SHRINE'] as const) {
    for (const enemyHeight of [56, 64, 80]) {
      for (const hpRatio of [1, 0.6, 0.25]) {
        for (const pause of [{ running: false }, { menuOpen: true }, { reducedMotion: true }]) {
          const director = new ArenaDirector(() => 0.35);
          const options = input({ layout: battleLayout(356, 176), theme, enemyHeight, hpRatio });
          let stopAt = 0;
          let before = director.frame(options);
          for (let nowMs = 17; nowMs < 30000; nowMs += 17) {
            before = director.frame({ ...options, nowMs });
            if (
              before.petStep !== null &&
              before.world.pet.y - before.pet.y - before.camera.y > 1
            ) {
              stopAt = nowMs + 17;
              break;
            }
          }
          assert.ok(stopAt > 0, 'find a lifted foot before stopping');
          assert.notEqual(before.petStep, null, 'interrupt an active footstep');
          const paused = director.frame({ ...options, ...pause, nowMs: stopAt });
          assert.equal(paused.petStep, null);
          if ('reducedMotion' in pause) {
            assert.deepEqual(paused.camera, before.camera, `${theme} ${enemyHeight} ${hpRatio}`);
            assert.deepEqual(paused.cameraTarget, before.cameraTarget);
          } else {
            assert.deepEqual(paused.world, before.world);
          }
          assertInside(paused, options);
        }
      }
    }
  }
});

test('0%는 연출 이동을 정지시키지만 다음 양의 HP 시작을 막지 않는다', () => {
  const director = new ArenaDirector(() => 0.35);
  const previous = advance(director, 1760);
  const defeated = director.frame(input({ hpRatio: 0, nowMs: 1810 }));
  assert.deepEqual(defeated.world.pet, previous.world.pet, 'defeat must not teleport the pet');
  assert.deepEqual(
    defeated.world.enemy,
    previous.world.enemy,
    'defeat must not teleport the enemy',
  );
  const held = director.frame(input({ hpRatio: 0, nowMs: 2060 }));
  assert.deepEqual(held.world, defeated.world);
  assert.equal(held.phase, 'IDLE');
  assert.equal(held.retreating, null);
  assert.equal(held.petAttack || held.petHit || held.enemyImpact, false);
  const resumed = director.frame(input({ key: 'pet-a:stage-2', hpRatio: 1, nowMs: 2110 }));
  assert.equal(resumed.retreating, 'PET');
});

test('펫 피격 신호는 공격 시트 시작 250~390ms 구간에서만 켜진다', () => {
  const director = new ArenaDirector(() => 0.35);
  const impacts: number[] = [];
  let start: number | undefined;
  for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
    const frame = director.frame(input({ nowMs }));
    if (frame.petAttack && start === undefined) start = nowMs;
    if (frame.petImpact) {
      assert.equal(frame.petAttack, true);
      impacts.push(nowMs - start!);
    }
    if (start !== undefined && !frame.petAttack) break;
  }
  assert.equal(impacts[0], 250);
  assert.equal(impacts.at(-1), 380);
});

test('보행 중 HP 경계를 넘으면 바로 후퇴 역할을 바꾸되 위치를 순간이동하지 않는다', () => {
  for (const [before, after] of [
    [1, 0.6],
    [0.6, 1],
    [0.6, 0.25],
  ] as const) {
    const director = new ArenaDirector(() => 0.35);
    const previous = advance(director, 100, { hpRatio: before });
    assert.equal(previous.attackTurn, null);
    const frame = director.frame(input({ hpRatio: after, nowMs: 120 }));
    assert.equal(frame.retreating, after! > 0.6 ? 'PET' : 'ENEMY');
    for (const actor of ['pet', 'enemy'] as const) {
      assert.ok(
        Math.hypot(
          frame.world[actor].x - previous.world[actor].x,
          frame.world[actor].y - previous.world[actor].y,
        ) < 3,
      );
    }
  }
});

test('공격 중 HP 역할 변경은 현재 교환이 끝날 때 적용하고 공격을 끊지 않는다', () => {
  for (const phase of ['PET_ATTACK', 'JUMP'] as const) {
    const director = new ArenaDirector(() => 0.35);
    let switchAt = 0;
    for (let nowMs = 0; nowMs < 30000; nowMs += 20) {
      const frame = director.frame(input({ nowMs }));
      if (frame.phase === phase) {
        switchAt = nowMs;
        break;
      }
    }
    assert.ok(switchAt > 0);
    let changed = false;
    for (let nowMs = switchAt + 20; nowMs < switchAt + 5000; nowMs += 20) {
      const frame = director.frame(input({ hpRatio: 0.6, nowMs }));
      if (frame.attackTurn !== null) assert.equal(frame.retreating, 'PET');
      else {
        assert.equal(frame.retreating, 'ENEMY');
        changed = true;
        break;
      }
    }
    assert.ok(changed, 'apply role change once the attack exchange ends');
  }
});

test('펫·배경 교체와 긴 숨김 복귀는 현재 위치에서 이전 공격만 취소한다', () => {
  for (const changed of [
    { key: 'pet-b:stage-1', nowMs: 1810 },
    { theme: 'STARLIGHT_SHRINE' as const, nowMs: 1810 },
    { nowMs: 10000 },
    { nowMs: -1 },
  ]) {
    const director = new ArenaDirector(() => 0.35);
    const before = advance(director, 1760);
    const options = input(changed);
    const after = director.frame(options);
    assert.deepEqual(after.world.pet, before.world.pet);
    assert.deepEqual(after.world.enemy, before.world.enemy);
    assert.deepEqual(after.camera, before.camera);
    assert.equal(after.attackTurn, null);
    assert.equal(after.petImpact || after.enemyImpact, false);
  }
});

test('모션 감소는 이동·카메라·도약을 없애되 타격 상태는 유지한다', () => {
  const director = new ArenaDirector(() => 0.35);
  const initial = director.frame(input({ reducedMotion: true }));
  let impact = false;
  for (let nowMs = 50; nowMs < 8040; nowMs += 50) {
    const frame = director.frame(input({ reducedMotion: true, nowMs }));
    assert.deepEqual(frame.world, initial.world);
    assert.deepEqual(frame.camera, { x: 0, y: 0 });
    assert.equal(frame.enemy.y, frame.world.enemy.y);
    impact ||= frame.enemyImpact;
  }
  assert.ok(impact);
});

test('추격 중 모션 감소로 바꾸면 안전한 근접 배치를 고정하고 양쪽 타격을 계속한다', () => {
  for (const hpRatio of [1, 0.6, 0.25]) {
    const director = new ArenaDirector(() => 0.5);
    const options = input({ hpRatio, enemyHeight: 80 });
    for (let nowMs = 0; nowMs <= 200; nowMs += 20) director.frame({ ...options, nowMs });
    const reduced = director.frame({ ...options, reducedMotion: true, nowMs: 220 });
    let petImpact = false;
    let enemyImpact = false;
    for (let nowMs = 240; nowMs <= 16220; nowMs += 20) {
      const frame = director.frame({ ...options, reducedMotion: true, nowMs });
      assert.deepEqual(frame.world, reduced.world, 'reduced motion keeps both actors still');
      assert.deepEqual(frame.camera, reduced.camera);
      assert.equal(frame.petStep, null);
      assert.equal(frame.enemyStep, null);
      assert.equal(frame.pet.y + frame.camera.y, frame.world.pet.y);
      assert.equal(frame.enemy.y + frame.camera.y, frame.world.enemy.y);
      assertInside(frame, options);
      petImpact ||= frame.petImpact;
      enemyImpact ||= frame.enemyImpact;
    }
    assert.ok(
      petImpact && enemyImpact,
      `normal encounter must keep fighting after reduced motion at HP ${hpRatio}`,
    );
  }
});

test('모션 감소 상태에서 메뉴로 적 크기를 줄여도 새 사거리 안에서 정지 전투를 유지한다', () => {
  for (const hpRatio of [1, 0.6, 0.25]) {
    const director = new ArenaDirector(() => 0.5);
    const options = input({ hpRatio, enemyHeight: 80, reducedMotion: true });
    for (let nowMs = 0; nowMs <= 500; nowMs += 20) director.frame({ ...options, nowMs });
    director.frame({ ...options, menuOpen: true, nowMs: 520 });
    director.frame({ ...options, enemyHeight: 56, menuOpen: true, nowMs: 540 });
    const resumed = director.frame({ ...options, enemyHeight: 56, nowMs: 560 });
    let petImpact = false;
    let enemyImpact = false;
    for (let nowMs = 580; nowMs <= 16560; nowMs += 20) {
      const frame = director.frame({ ...options, enemyHeight: 56, nowMs });
      assert.deepEqual(
        frame.world,
        resumed.world,
        'reduced motion never walks to repair the resized gap',
      );
      assert.deepEqual(frame.camera, resumed.camera);
      assert.equal(frame.petStep, null);
      assert.equal(frame.enemyStep, null);
      assert.equal(frame.pet.y + frame.camera.y, frame.world.pet.y);
      assert.equal(frame.enemy.y + frame.camera.y, frame.world.enemy.y);
      assertInside(frame, { ...options, enemyHeight: 56 });
      petImpact ||= frame.petImpact;
      enemyImpact ||= frame.enemyImpact;
    }
    assert.ok(
      petImpact && enemyImpact,
      `size change must preserve reduced-motion attacks at HP ${hpRatio}`,
    );
  }
});

test('펫이 없으면 시작하지 않으며 입력 layout·HP·펫 식별자를 수정하지 않는다', () => {
  const options = input({ key: null });
  const original = structuredClone(options);
  const director = new ArenaDirector(() => 0.35);
  const initial = director.frame(options);
  const later = director.frame({ ...options, nowMs: 1000 });
  assert.deepEqual(initial, later);
  assert.equal(later.phase, 'IDLE');
  assert.deepEqual(options, original);
});
