import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  petCombatAnimation,
  petCombatPose,
  advancePetCombat,
} from '../src/view/pet-combat-animations.ts';
import {
  hamsterCheekFrame,
  hamsterFace,
  hamsterFoodPixels,
  hamsterBodyProjection,
  hamsterMouthPosition,
} from '../src/view/hamster-combat.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const origin = { x: 40, y: 260 };
const target = { x: 220, y: 260 };
const profile = petCombatAnimation('cheek_hamster');

test('볼주머니햄은 볼을 충전하고 한 번 도약·발사·반동·착지한 뒤 복귀한다', () => {
  assert.equal(profile.id, 'hamster');
  assert.equal(profile.durationMs, 1200);
  assert.deepEqual(
    [0, 300, 600, 800, 1000, 1200].map((t) => petCombatPose(profile, t, origin, target).phase),
    ['HAMSTER_PUFF', 'HAMSTER_HOLD', 'HAMSTER_FIRE', 'HAMSTER_BURST', 'HAMSTER_RECOVER', 'IDLE'],
  );
  for (let t = 0; t <= 1200; t += 10) {
    const pose = petCombatPose(profile, t, origin, target);
    assert.deepEqual(pose.position, origin);
    assert.equal(pose.spriteProgress, 0);
    assert.equal(pose.frontApproach, 0);
    assert.equal(pose.hoofLift, 0);
  }
  assert.ok(petCombatPose(profile, 140, origin, target).cheekPuff < 1);
  for (const t of [280, 340, 419]) {
    const pose = petCombatPose(profile, t, origin, target);
    assert.equal(pose.cheekPuff, 1, 'hold the full cheek silhouette instead of jittering');
    assert.equal(pose.mouthOpen, true);
    assert.equal(pose.foodFlight, 0);
  }
  assert.equal(petCombatPose(profile, 500, origin, target).cheekPuff, 0);
  assert.equal(petCombatPose(profile, 1200, origin, target).mouthOpen, false);
  assert.ok(petCombatPose(profile, 160, origin, target).bodyDip > 0);
  assert.equal(petCombatPose(profile, 340, origin, target).chargeHop, 1);
  assert.equal(petCombatPose(profile, 490, origin, target).shotRecoil, 1);
  assert.equal(petCombatPose(profile, 820, origin, target).bodyDip, 1);
});

test('준비 압축·공중 반동·착지는 정수 위치를 사용하고 화면 끝에서도 잘리지 않으며 탄환은 반동을 따라가지 않는다', () => {
  const peak = hamsterBodyProjection(petCombatPose(profile, 340, origin, target), 96);
  assert.equal(peak.y, -24);
  assert.ok(peak.shadowScale < 1 && peak.shadowOpacity < 1);
  const fire = hamsterBodyProjection(petCombatPose(profile, 490, origin, target), 96);
  assert.equal(fire.x, -12);
  assert.equal(fire.tilt, -7);
  const land = hamsterBodyProjection(petCombatPose(profile, 820, origin, target), 96);
  assert.equal(land.y, 0);
  assert.ok(land.scaleY < 0.9 && land.scaleX > 1.1);
  const placement = { x: 60, foot: 200, width: 316, height: 220 };
  const atLaunch = hamsterMouthPosition(
    petCombatPose(profile, 420, origin, target),
    2,
    96,
    0,
    placement,
  );
  const atRecoil = hamsterMouthPosition(
    petCombatPose(profile, 490, origin, target),
    2,
    96,
    0,
    placement,
  );
  assert.deepEqual(
    atLaunch,
    atRecoil,
    'the food seed keeps one launch anchor while the body recoils',
  );
  for (const x of [12, 60, 206])
    for (const foot of [104, 200])
      for (let time = 0; time <= 1200; time += 20) {
        const body = hamsterBodyProjection(petCombatPose(profile, time, origin, target), 96, {
          ...placement,
          x,
          foot,
        });
        assert.equal(Math.abs(body.x % 3), 0);
        assert.equal(Math.abs(body.y % 3), 0);
        for (const [cx, cy] of [
          [-48, -96],
          [48, -96],
          [-48, 0],
          [48, 0],
        ]) {
          const angle = (body.tilt * Math.PI) / 180;
          const sx =
            x +
            48 +
            body.x +
            cx! * body.scaleX * Math.cos(angle) -
            cy! * body.scaleY * Math.sin(angle);
          const sy =
            foot +
            body.y +
            cx! * body.scaleX * Math.sin(angle) +
            cy! * body.scaleY * Math.cos(angle);
          assert.ok(
            sx >= 4 && sx <= placement.width - 4 && sy >= 4 && sy <= placement.height - 4,
            `projected body stays in viewport at ${x},${foot},${time}`,
          );
        }
      }
  const reduced = hamsterBodyProjection(petCombatPose(profile, 490, origin, target, true), 96);
  assert.deepEqual(reduced, {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    tilt: 0,
    shadowScale: 1,
    shadowOpacity: 1,
  });
});

test('느린 화면 갱신에서도 먹이탄 발사·명중은 한 번이며 모션 감소는 장식만 생략한다', () => {
  for (const delta of [16, 200, 1000]) {
    let elapsed = 0,
      hits = 0,
      shots = 0;
    let previousHit = false,
      previousShot = false;
    const phases = new Set<string>();
    while (elapsed < profile.durationMs) {
      const pose = petCombatPose(profile, elapsed, origin, target);
      phases.add(pose.phase);
      const shot = pose.phase === 'HAMSTER_FIRE';
      if (shot && !previousShot) shots++;
      if (pose.impact && !previousHit) hits++;
      previousHit = pose.impact;
      previousShot = shot;
      elapsed = advancePetCombat(profile, elapsed, delta);
    }
    assert.equal(shots, 1);
    assert.equal(hits, 1);
    for (const phase of [
      'HAMSTER_PUFF',
      'HAMSTER_HOLD',
      'HAMSTER_FIRE',
      'HAMSTER_BURST',
      'HAMSTER_RECOVER',
    ])
      assert.ok(phases.has(phase));
  }
  assert.equal(petCombatPose(profile, 719, origin, target).impact, false);
  assert.equal(petCombatPose(profile, 720, origin, target).impact, true);
  assert.equal(petCombatPose(profile, 860, origin, target).impact, false);
  const reduced = petCombatPose(profile, 760, origin, target, true);
  assert.equal(reduced.impact, true);
  assert.equal(reduced.cheekPuff, 0);
  assert.equal(reduced.mouthOpen, false);
  assert.deepEqual(hamsterFoodPixels(reduced, origin, target, 2, 3), []);
});

test('진화별 볼·입 합성은 모든 몸통·발·눈·귀 픽셀과 원본 이미지를 보존한다', () => {
  const source = new Uint8ClampedArray(32 * 32 * 4);
  for (let pixel = 0; pixel < 32 * 32; pixel++)
    source.set([pixel % 256, Math.floor(pixel / 32), 220, 255], pixel * 4);
  const before = new Uint8ClampedArray(source);
  for (const evolution of [0, 1, 2]) {
    const face = hamsterFace(evolution);
    assert.deepEqual(hamsterCheekFrame(source, evolution, 0, false), source);
    for (const puff of [0, 0.5, 1])
      for (const mouth of [false, true]) {
        const frame = hamsterCheekFrame(source, evolution, puff, mouth);
        const lastFaceRow = Math.max(face.bottom, face.mouth.y + 1);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const eyeColumn = x > face.leftInner && x < face.rightInner;
            const mouthPixel = Math.abs(x - face.mouth.x) <= 1 && Math.abs(y - face.mouth.y) <= 1;
            if (y >= face.top && y <= lastFaceRow && (!eyeColumn || mouthPixel)) continue;
            const at = (y * 32 + x) * 4;
            assert.deepEqual(
              frame.subarray(at, at + 4),
              source.subarray(at, at + 4),
              `stage ${evolution + 1}: fixed body/eye pixel ${x},${y}`,
            );
          }
      }
  }
  assert.deepEqual(source, before);
  assert.throws(() => hamsterCheekFrame(new Uint8ClampedArray(4), 0, 1, false), /32/);
});

test('먹이탄은 입에서 적으로 이동하고 진화는 잔상·명중 파편만 풍성하게 만든다', () => {
  const start = { x: 80, y: 180 },
    end = { x: 260, y: 220 };
  const flight = petCombatPose(profile, 600, origin, target);
  const stages = [0, 1, 2].map((stage) => hamsterFoodPixels(flight, start, end, stage, 3));
  assert.ok(stages[0]!.length < stages[1]!.length && stages[1]!.length < stages[2]!.length);
  const early = hamsterFoodPixels(petCombatPose(profile, 430, origin, target), start, end, 0, 3);
  assert.ok(Math.max(...stages[0]!.map((p) => p.x)) > Math.max(...early.map((p) => p.x)));
  for (const pixels of stages)
    for (const p of pixels) {
      for (const value of [p.x, p.y, p.width, p.height]) assert.equal(value % 3, 0);
      assert.ok(['#2c2438', '#fff0d2', '#ffd166', '#35d6b0', '#a5763f'].includes(p.color));
    }
  assert.ok(
    hamsterFoodPixels(petCombatPose(profile, 760, origin, target), start, end, 2, 3).some(
      (p) => Math.abs(p.x - end.x) < 9,
    ),
  );
  assert.deepEqual(
    hamsterFoodPixels(petCombatPose(profile, 1200, origin, target), start, end, 2, 3),
    [],
  );
  assert.deepEqual(
    hamsterFoodPixels(
      petCombatPose(petCombatAnimation('midnight_zebra'), 600, origin, target),
      start,
      end,
      2,
      3,
    ),
    [],
  );
});

test('볼 부풀리기·먹이탄·명중 중 STOP·선택 변경·정복·숨김은 모션과 타격을 취소한다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'hamster:1',
    running: true,
    petSprite: 'cheek_hamster',
    petFrontRatio: 0.75,
  };
  for (const phase of ['HAMSTER_HOLD', 'HAMSTER_FIRE', 'HAMSTER_BURST'])
    for (const change of [
      { running: false },
      { key: 'zebra:1', petSprite: 'midnight_zebra' },
      { hpRatio: 0 },
      { suspended: true },
    ]) {
      const arena = new ArenaDirector(() => 0.35);
      let at = -1;
      for (let nowMs = 0; nowMs < 20000; nowMs += 20)
        if (arena.frame({ ...options, nowMs }).petAnimation.phase === phase) {
          at = nowMs;
          break;
        }
      assert.ok(at >= 0);
      const cancelled = arena.frame({ ...options, ...change, nowMs: at + 20 });
      assert.equal(cancelled.petAnimation.cheekPuff, 0);
      assert.equal(cancelled.petAnimation.mouthOpen, false);
      assert.equal(cancelled.petAnimation.foodFlight, 0);
      assert.equal(cancelled.petAnimation.foodBurst, 0);
      assert.equal(cancelled.petAnimation.chargeHop, 0);
      assert.equal(cancelled.petAnimation.shotRecoil, 0);
      assert.equal(cancelled.petImpact, false);
    }
});
