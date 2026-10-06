import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  petCombatAnimation,
  petCombatPose,
  advancePetCombat,
} from '../src/view/pet-combat-animations.ts';
import {
  squirrelCasterFrame,
  squirrelShadowFrame,
  squirrelFrameSize,
  squirrelBodyProjection,
  squirrelForestPixels,
  type SquirrelLayout,
} from '../src/view/squirrel-combat.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const profile = petCombatAnimation('acorn_squirrel');
const origin = { x: 100, y: 340 },
  target = { x: 400, y: 330 };
const layout: SquirrelLayout = {
  width: 796,
  height: 516,
  size: 96,
  caster: { x: 160, y: 270 },
  casterFoot: origin,
  target,
  targetFoot: { x: 400, y: 400 },
};
const empty = { back: [], front: [], clones: [], dim: 0, bladeCount: 0 };

test('도토리다람쥐는 수인·도약·분신 표창·꼬리 봉인·폭발·복귀하며 봉인에서 한 번만 타격한다', () => {
  assert.equal(profile.id, 'squirrel');
  assert.equal(profile.durationMs, 3200);
  assert.deepEqual(
    [100, 600, 1300, 2100, 2450, 2900, 3200].map(
      (t) => petCombatPose(profile, t, origin, target).phase,
    ),
    [
      'SQUIRREL_SIGN',
      'SQUIRREL_DOMAIN',
      'SQUIRREL_CLONES',
      'SQUIRREL_SEAL',
      'SQUIRREL_BURST',
      'SQUIRREL_RETURN',
      'IDLE',
    ],
  );
  for (let time = 0; time <= 3200; time += 20) {
    const pose = petCombatPose(profile, time, origin, target);
    assert.deepEqual(pose.position, origin);
    assert.equal(pose.spriteProgress, 0);
  }
  assert.equal(petCombatPose(profile, 2299, origin, target).impact, false);
  assert.equal(petCombatPose(profile, 2300, origin, target).impact, true);
  assert.equal(petCombatPose(profile, 2440, origin, target).impact, false);
  assert.equal(petCombatPose(profile, 3200, origin, target).squirrel, null);
});

test('지연된 화면도 준비와 도약·표창·봉인을 생략하지 않으며 다중 표창이 타격을 늘리지 않는다', () => {
  for (const delta of [16, 250, 1000]) {
    let time = 0,
      hits = 0,
      previous = false,
      seal = false;
    const phases = new Set<string>();
    while (time < profile.durationMs) {
      const pose = petCombatPose(profile, time, origin, target);
      phases.add(pose.phase);
      if (pose.phase === 'SQUIRREL_SEAL')
        seal ||= squirrelForestPixels(pose, 2, layout).front.length > 0;
      if (pose.impact && !previous) hits++;
      previous = pose.impact;
      time = advancePetCombat(profile, time, delta);
    }
    assert.equal(hits, 1);
    assert.equal(seal, true);
    for (const phase of [
      'SQUIRREL_SIGN',
      'SQUIRREL_DOMAIN',
      'SQUIRREL_CLONES',
      'SQUIRREL_SEAL',
      'SQUIRREL_BURST',
      'SQUIRREL_RETURN',
    ])
      assert.ok(phases.has(phase), `${delta}ms skips ${phase}`);
  }
});

test('32·48px 원본의 얼굴은 보존하고 큰 꼬리를 넓은 캔버스 안에서 회전하며 분신은 별도 색으로 합성한다', () => {
  for (const stage of [0, 1, 2]) {
    const size = squirrelFrameSize(stage),
      width = size * 1.5;
    const source = new Uint8ClampedArray(size * size * 4);
    for (let p = 0; p < size * size; p++)
      source.set([p % 256, Math.floor(p / size), 120, 255], p * 4);
    const copy = new Uint8ClampedArray(source),
      idle = squirrelCasterFrame(source, stage, 0),
      sweep = squirrelCasterFrame(source, stage, 1);
    assert.equal(sweep.length, width * size * 4);
    assert.notDeepEqual(sweep, idle);
    assert.deepEqual(source, copy);
    const from = stage === 2 ? 18 : 10,
      to = stage === 2 ? 28 : 18;
    for (let y = 8; y < 22; y++)
      for (let x = from; x <= to; x++)
        assert.deepEqual(
          sweep.subarray((y * width + x) * 4, (y * width + x + 1) * 4),
          source.subarray((y * size + x) * 4, (y * size + x + 1) * 4),
        );
    const shadow = squirrelShadowFrame(sweep);
    assert.notDeepEqual(shadow, sweep);
    for (let p = 3; p < sweep.length; p += 4) assert.equal(shadow[p], sweep[p]);
    assert.deepEqual(squirrelCasterFrame(source, stage, NaN), idle);
  }
  assert.throws(() => squirrelCasterFrame(new Uint8ClampedArray(32 * 32 * 4), 2, 1), /48/);
});

test('도약과 꼬리 회전은 화면 가장자리에서도 본체를 보존하고 카메라·월드 좌표를 변경하지 않는다', () => {
  for (const stage of [0, 1, 2])
    for (const x of [12, 60, 206])
      for (const foot of [104, 200])
        for (let time = 0; time <= 3200; time += 40) {
          const pose = petCombatPose(profile, time, origin, target),
            body = squirrelBodyProjection(pose, stage, 96, { x, foot, width: 316, height: 220 });
          assert.equal(Math.abs(body.x % (96 / squirrelFrameSize(stage))), 0);
          assert.equal(Math.abs(body.y % (96 / squirrelFrameSize(stage))), 0);
          const a = (body.tilt * Math.PI) / 180,
            right = 48 + 48 * (pose.squirrel?.tailSweep ?? 0);
          for (const [cx, cy] of [
            [-48, -96],
            [right, -96],
            [-48, 0],
            [right, 0],
          ]) {
            const px =
                x + 48 + body.x + cx! * body.scaleX * Math.cos(a) - cy! * body.scaleY * Math.sin(a),
              py =
                foot + body.y + cx! * body.scaleX * Math.sin(a) + cy! * body.scaleY * Math.cos(a);
            assert.ok(px >= 4 && px <= 312 && py >= 4 && py <= 216, `${stage}/${time} clipped`);
          }
          assert.deepEqual(pose.position, origin);
        }
  assert.ok(squirrelBodyProjection(petCombatPose(profile, 700, origin, target), 2, 96).y < -20);
});

test('모든 진화 단계에서 화면 전체 숲과 낙엽을 만들고 2·3·4개의 분신과 최대 24개 표창을 표시한다', () => {
  const fields = [0, 1, 2].map((stage) =>
    squirrelForestPixels(petCombatPose(profile, 1300, origin, target), stage, layout),
  );
  assert.ok(fields[0]!.front.length < fields[2]!.front.length);
  for (const [stage, field] of fields.entries()) {
    assert.equal(field.clones.length, 2 + stage);
    assert.ok(field.bladeCount > 0 && field.bladeCount <= 24);
    assert.ok(field.dim > 0);
    for (let column = 0; column < 4; column++)
      assert.ok(
        field.back.some(
          (p) => p.x >= (layout.width * column) / 4 && p.x < (layout.width * (column + 1)) / 4,
        ),
        `forest misses ${column}`,
      );
    assert.ok(field.back.some((p) => p.y < layout.height * 0.25));
    assert.ok(field.back.some((p) => p.y > layout.height * 0.75));
    for (const p of [...field.back, ...field.front])
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y) && p.width > 0 && p.height > 0);
  }
  const seal = squirrelForestPixels(petCombatPose(profile, 2100, origin, target), 2, layout);
  assert.equal(seal.bladeCount, 0);
  assert.ok(seal.front.some((p) => Math.abs(p.x - target.x) < 10));
});

test('모션 감소는 숲·분신·도약을 생략하며 단일 타격을 유지한다', () => {
  for (const time of [300, 700, 1300, 2100, 2350, 2900, 3200]) {
    const pose = petCombatPose(profile, time, origin, target, true);
    assert.deepEqual(squirrelForestPixels(pose, 2, layout), empty);
    assert.deepEqual(squirrelBodyProjection(pose, 2, 96), {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      tilt: 0,
      shadowScale: 1,
      shadowOpacity: 1,
    });
  }
  assert.equal(petCombatPose(profile, 2350, origin, target, true).impact, true);
});

test('STOP·숨김·선택 변경·정복은 모든 공격 단계에서 숲과 분신·추가 타격을 정리한다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'squirrel:1',
    running: true,
    petSprite: 'acorn_squirrel',
  };
  for (const phase of [
    'SQUIRREL_SIGN',
    'SQUIRREL_DOMAIN',
    'SQUIRREL_CLONES',
    'SQUIRREL_SEAL',
    'SQUIRREL_BURST',
  ])
    for (const change of [
      { running: false },
      { suspended: true },
      { hpRatio: 0 },
      { key: 'wizard:1', petSprite: 'star_wizard' },
    ]) {
      const arena = new ArenaDirector(() => 0.35);
      let at = -1;
      for (let time = 0; time < 24000; time += 20)
        if (arena.frame({ ...options, nowMs: time }).petAnimation.phase === phase) {
          at = time;
          break;
        }
      assert.ok(at >= 0);
      const frame = arena.frame({ ...options, ...change, nowMs: at + 20 });
      assert.equal(frame.petAnimation.squirrel, null);
      assert.equal(frame.petImpact, false);
      assert.deepEqual(squirrelForestPixels(frame.petAnimation, 2, layout), empty);
    }
});
