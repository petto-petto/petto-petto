import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advancePetCombat,
  petCombatAnimation,
  petCombatPose,
  zebraHoofFrame,
  zebraForwardProjection,
  zebraShockwavePixels,
} from '../src/view/pet-combat-animations.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const origin = { x: 40, y: 260 };
const target = { x: 220, y: 260 };
const profile = () => petCombatAnimation('midnight_zebra');

test('얼룩말은 정면 제자리에서 왼발을 두 번 구른 뒤 초승달 파동과 함께 복귀한다', () => {
  assert.equal(profile().id, 'zebra');
  assert.equal(profile().durationMs, 1300);
  assert.equal(
    petCombatPose(profile(), 100, origin, target).spriteProgress,
    petCombatPose(profile(), 200, origin, target).spriteProgress,
    'the attack strip stays on one frame so torso animation cannot shake',
  );
  assert.deepEqual(
    [50, 300, 530, 900, 1100, 1250].map(
      (time) => petCombatPose(profile(), time, origin, target).phase,
    ),
    [
      'ZEBRA_WINDUP',
      'ZEBRA_STOMP',
      'ZEBRA_APPROACH',
      'ZEBRA_WAVE',
      'ZEBRA_RECOVER',
      'ZEBRA_SETTLE',
    ],
  );
  for (let time = 0; time <= profile().durationMs; time += 10) {
    const pose = petCombatPose(profile(), time, origin, target);
    assert.deepEqual(pose.position, origin, 'front-facing sprite never runs sideways');
    assert.equal(pose.burrow, 0);
    assert.equal(pose.hand, null);
    assert.equal(pose.bodyDip, 0, 'only the left leg moves; the torso stays planted');
  }
  const firstStomp = [50, 130, 180].map(
    (time) => petCombatPose(profile(), time, origin, target).hoofLift,
  );
  const secondStomp = [310, 390, 440].map(
    (time) => petCombatPose(profile(), time, origin, target).hoofLift,
  );
  assert.ok(firstStomp[1]! > firstStomp[0]! && firstStomp[1]! > firstStomp[2]!);
  assert.ok(secondStomp[1]! > secondStomp[0]! && secondStomp[1]! > secondStomp[2]!);
  for (let time = 190; time <= 260; time += 5)
    assert.equal(
      petCombatPose(profile(), time, origin, target).hoofLift,
      0,
      'first landing has a planted pause',
    );
  for (let time = 450; time <= profile().durationMs; time += 5)
    assert.equal(
      petCombatPose(profile(), time, origin, target).hoofLift,
      0,
      'no extra hoof tremor after the second stomp',
    );
});

test('두 발구름 뒤 정면으로 한 번 다가왔다 복귀한 다음 파동을 보내며 모션 감소에서는 확대하지 않는다', () => {
  for (let time = 0; time <= 450; time += 10)
    assert.equal(petCombatPose(profile(), time, origin, target).frontApproach, 0);
  const peak = petCombatPose(profile(), 530, origin, target);
  const projection = zebraForwardProjection(peak, 96);
  assert.ok(projection.scale > 1 && projection.scale <= 1.12);
  assert.equal(projection.offsetY, 6);
  assert.deepEqual(
    peak.position,
    origin,
    'depth projection never moves the combat or camera anchor',
  );
  assert.equal(peak.hoofLift, 0);
  assert.equal(peak.shockwaveProgress, 0);
  assert.equal(peak.impact, false);
  const returned = petCombatPose(profile(), 660, origin, target);
  assert.deepEqual(zebraForwardProjection(returned, 96), { scale: 1, offsetY: 0 });
  assert.equal(returned.impact, true);
  assert.ok(petCombatPose(profile(), 700, origin, target).shockwaveProgress > 0);
  for (const time of [450, 530, 650, 700, 1300]) {
    const reduced = petCombatPose(profile(), time, origin, target, true);
    assert.deepEqual(zebraForwardProjection(reduced, 96), { scale: 1, offsetY: 0 });
  }
  assert.deepEqual(
    zebraForwardProjection(petCombatPose(petCombatAnimation(), 530, origin, target), 96),
    { scale: 1, offsetY: 0 },
  );
});

test('얼룩말 왼쪽 다리만 픽셀 단위로 들고 몸통 픽셀은 그대로 유지한다', () => {
  const stages: Array<[number, number, number]> = [
    [0, 20, 23],
    [1, 20, 25],
    [2, 24, 29],
  ];
  for (const [evolution, hoofX, hoofY] of stages) {
    const source = new Uint8ClampedArray(32 * 32 * 4);
    const paint = (x: number, y: number, red: number) => {
      const at = (y * 32 + x) * 4;
      source.set([red, 180, 220, 255], at);
    };
    paint(5, 5, 1);
    paint(hoofX - 1, hoofY - 1, 2);
    paint(hoofX, hoofY, 3);
    paint(hoofX, hoofY + 1, 4);
    const leg = zebraHoofFrame(source, evolution, 1);
    assert.deepEqual([...leg.subarray((5 * 32 + 5) * 4, (5 * 32 + 5) * 4 + 4)], [1, 180, 220, 255]);
    assert.equal(
      leg[(hoofY * 32 + hoofX) * 4 + 3],
      0,
      'the planted hoof has left its original pixels',
    );
    assert.deepEqual(
      [...leg.subarray(((hoofY - 2) * 32 + hoofX) * 4, ((hoofY - 2) * 32 + hoofX) * 4 + 4)],
      [3, 180, 220, 255],
    );
    assert.equal(source[(hoofY * 32 + hoofX) * 4 + 3], 255, 'the source image is not mutated');
    const bounds =
      evolution === 0 ? [18, 21, 21, 24] : evolution === 1 ? [18, 21, 23, 26] : [23, 26, 27, 30];
    const opaque = new Uint8ClampedArray(32 * 32 * 4);
    for (let pixel = 0; pixel < 32 * 32; pixel++)
      opaque.set([pixel % 256, Math.floor(pixel / 32), 220, 255], pixel * 4);
    for (const amount of [0, 0.5, 1]) {
      const frame = zebraHoofFrame(opaque, evolution, amount);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          if (x >= bounds[0]! && x <= bounds[1]! && y >= bounds[2]! && y <= bounds[3]!) continue;
          const pixel = (y * 32 + x) * 4;
          assert.deepEqual(
            frame.subarray(pixel, pixel + 4),
            opaque.subarray(pixel, pixel + 4),
            `stage ${evolution + 1}: body pixel ${x},${y} must never be overwritten by the lifted leg`,
          );
        }
    }
  }
});

test('정면 접근 뒤 한 번만 타격하고 느린 프레임에서도 두 발구름과 접근 동작이 구분된다', () => {
  assert.equal(petCombatPose(profile(), 659, origin, target).impact, false);
  assert.equal(petCombatPose(profile(), 660, origin, target).impact, true);
  assert.equal(petCombatPose(profile(), 799, origin, target).impact, true);
  assert.equal(petCombatPose(profile(), 800, origin, target).impact, false);
  for (const delta of [16, 200, 1000]) {
    let elapsed = 0;
    let hits = 0;
    let previousImpact = false;
    let lifted = false;
    const landings: number[] = [];
    const phases = new Set<string>();
    while (elapsed < profile().durationMs) {
      const pose = petCombatPose(profile(), elapsed, origin, target);
      phases.add(pose.phase);
      if (pose.impact && !previousImpact) hits++;
      previousImpact = pose.impact;
      const nowLifted = Math.round(pose.hoofLift * 2) > 0;
      if (lifted && !nowLifted) landings.push(elapsed);
      lifted = nowLifted;
      elapsed = advancePetCombat(profile(), elapsed, delta);
    }
    assert.equal(hits, 1);
    assert.equal(landings.length, 2, `${delta}ms must show exactly two landings`);
    assert.ok(
      landings[1]! - landings[0]! >= 240,
      'the two stomps must not read as a rapid flutter',
    );
    for (const phase of [
      'ZEBRA_WINDUP',
      'ZEBRA_STOMP',
      'ZEBRA_APPROACH',
      'ZEBRA_WAVE',
      'ZEBRA_RECOVER',
      'ZEBRA_SETTLE',
    ])
      assert.ok(phases.has(phase), `${delta}ms skips ${phase}`);
  }
});

test('초승달 줄무늬 파동은 적 방향으로 뻗고 진화별 광채만 늘어나며 픽셀 격자를 지킨다', () => {
  const pose = petCombatPose(profile(), 950, origin, target);
  const stages = [0, 1, 2].map((evolution) =>
    zebraShockwavePixels(pose, origin, target, evolution, 3),
  );
  assert.ok(stages[0]!.length > 0);
  assert.ok(stages[0]!.length < stages[1]!.length);
  assert.ok(stages[1]!.length < stages[2]!.length);
  const trailX = [...new Set(stages[0]!.map((pixel) => pixel.x))].sort((a, b) => a - b);
  assert.ok(
    trailX.some((x, index) => index > 0 && x - trailX[index - 1]! > 3),
    'the shockwave trail has visible gaps instead of reading as a solid beam',
  );
  for (const pixels of stages) {
    assert.ok(pixels.some((pixel) => Math.abs(pixel.x - target.x) <= 3));
    assert.ok(pixels.some((pixel) => pixel.color === '#ffd84d'));
    for (const pixel of pixels) {
      for (const value of [pixel.x, pixel.y, pixel.width, pixel.height]) assert.equal(value % 3, 0);
      assert.ok(['#2c2438', '#4a5b8c', '#b9c6e8', '#e8eef7', '#ffd84d'].includes(pixel.color));
    }
  }
  assert.deepEqual(
    zebraShockwavePixels(petCombatPose(profile(), 1400, origin, target), origin, target, 2, 3),
    [],
  );
  const reduced = petCombatPose(profile(), 700, origin, target, true);
  assert.equal(reduced.impact, true);
  assert.deepEqual(zebraShockwavePixels(reduced, origin, target, 2, 3), []);
});

test('초승달은 적을 관통해 더 멀리 뻗으며 가까운 적에게도 긴 사거리를 유지한다', () => {
  const pose = petCombatPose(profile(), 950, origin, target);
  for (const stage of [0, 1, 2]) {
    const pixels = zebraShockwavePixels(pose, origin, target, stage, 3);
    const right = Math.max(...pixels.map((p) => p.x + p.width));
    assert.ok(
      right >= origin.x + (target.x - origin.x) * 1.8,
      'wave continues well beyond the enemy',
    );
    const nearby = { x: origin.x + 12, y: target.y };
    const closePixels = zebraShockwavePixels(pose, origin, nearby, stage, 3);
    assert.ok(
      Math.max(...closePixels.map((p) => p.x + p.width)) >= nearby.x + 60,
      'a nearby enemy must not shorten the wave to a tiny flash',
    );
    assert.deepEqual(pose.position, origin);
  }
});

test('긴 파동은 작은 창의 오른쪽 안에서 마무리되어 초승달과 파편이 잘리지 않는다', () => {
  const pose = petCombatPose(profile(), 950, origin, target);
  for (const stage of [0, 1, 2]) {
    const pixels = zebraShockwavePixels(
      pose,
      { x: 180, y: 200 },
      { x: 260, y: 200 },
      stage,
      3,
      316,
    );
    const right = Math.max(...pixels.map((p) => p.x + p.width));
    assert.ok(right > 280 && right <= 316, `${stage}: extended crescent exceeds the window`);
  }
});

test('자동 공격 중 STOP·선택 변경·정복은 충격파와 접촉 신호를 지운다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'zebra:1',
    running: true,
    petSprite: 'midnight_zebra',
    petFrontRatio: 0.75,
  };
  for (const effect of ['frontApproach', 'shockwaveProgress'] as const)
    for (const change of [
      { running: false },
      { hpRatio: 0 },
      { key: 'other:1', petSprite: 'mole_digger' },
      { suspended: true },
    ]) {
      const arena = new ArenaDirector(() => 0.35);
      let at = -1;
      for (let nowMs = 0; nowMs < 20000; nowMs += 20) {
        const frame = arena.frame({ ...options, nowMs });
        if (frame.petAnimation[effect] > 0) {
          at = nowMs;
          break;
        }
      }
      assert.ok(at >= 0);
      const cancelled = arena.frame({ ...options, ...change, nowMs: at + 20 });
      assert.equal(cancelled.petAnimation.shockwaveProgress, 0);
      assert.equal(cancelled.petAnimation.frontApproach, 0);
      assert.equal(cancelled.petImpact, false);
    }
});
