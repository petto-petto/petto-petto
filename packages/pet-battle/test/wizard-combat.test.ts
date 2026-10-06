import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  petCombatAnimation,
  petCombatPose,
  advancePetCombat,
} from '../src/view/pet-combat-animations.ts';
import {
  wizardBodyProjection,
  wizardCasterFrame,
  wizardFrameSize,
  wizardSpellPixels,
  type WizardLayout,
} from '../src/view/wizard-combat.ts';
import { ArenaDirector, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

const profile = petCombatAnimation('star_wizard');
const origin = { x: 100, y: 340 },
  target = { x: 400, y: 330 };
const layout: WizardLayout = {
  width: 796,
  height: 516,
  size: 96,
  caster: { x: 160, y: 270 },
  casterFoot: origin,
  target,
  targetFoot: { x: 400, y: 400 },
};

test('별빛마법사는 집중·시전·전장 유성우·큰 유성·폭발·착지로 복귀하고 마지막 유성에서만 타격한다', () => {
  assert.equal(profile.id, 'wizard');
  assert.equal(profile.durationMs, 3000);
  assert.deepEqual(
    [100, 650, 1400, 2050, 2250, 2750, 3000].map(
      (t) => petCombatPose(profile, t, origin, target).phase,
    ),
    [
      'WIZARD_CHARGE',
      'WIZARD_CAST',
      'WIZARD_RAIN',
      'WIZARD_FINISH',
      'WIZARD_BURST',
      'WIZARD_RETURN',
      'IDLE',
    ],
  );
  for (let t = 0; t <= 3000; t += 20) {
    const pose = petCombatPose(profile, t, origin, target);
    assert.deepEqual(pose.position, origin);
    assert.equal(pose.spriteProgress, 0);
  }
  assert.equal(petCombatPose(profile, 2199, origin, target).impact, false);
  assert.equal(petCombatPose(profile, 2200, origin, target).impact, true);
  assert.equal(petCombatPose(profile, 2340, origin, target).impact, false);
  assert.equal(petCombatPose(profile, 3000, origin, target).wizard, null);
});

test('늦은 프레임도 모든 시전 단계를 보여주며 유성우가 추가 타격을 만들지 않는다', () => {
  for (const delta of [16, 250, 1000]) {
    let sawMainMeteor = false;
    let time = 0,
      hits = 0,
      previous = false;
    const phases = new Set<string>();
    while (time < profile.durationMs) {
      const pose = petCombatPose(profile, time, origin, target);
      phases.add(pose.phase);
      if (pose.phase === 'WIZARD_FINISH')
        sawMainMeteor ||= wizardSpellPixels(pose, 2, layout).front.some(
          (p) => p.width >= 30 && p.y >= 0 && p.y < layout.height,
        );
      if (pose.impact && !previous) hits++;
      previous = pose.impact;
      time = advancePetCombat(profile, time, delta);
    }
    assert.equal(hits, 1);
    assert.equal(
      sawMainMeteor,
      true,
      `${delta}ms must show the main meteor on screen before contact`,
    );
    for (const phase of [
      'WIZARD_CHARGE',
      'WIZARD_CAST',
      'WIZARD_RAIN',
      'WIZARD_FINISH',
      'WIZARD_BURST',
      'WIZARD_RETURN',
    ])
      assert.ok(phases.has(phase), `${delta}ms skips ${phase}`);
  }
});

test('32·48px 진화 프레임을 정확히 합성하고 중심 얼굴은 그대로 두며 마지막 형태의 여러 발을 펼친다', () => {
  for (const stage of [0, 1, 2]) {
    const size = wizardFrameSize(stage);
    const source = new Uint8ClampedArray(size * size * 4);
    for (let p = 0; p < size * size; p++)
      source.set([p % 256, Math.floor(p / size), 120, 255], p * 4);
    const copy = new Uint8ClampedArray(source);
    assert.deepEqual(wizardCasterFrame(source, stage, 0), source);
    const cast = wizardCasterFrame(source, stage, 1);
    assert.equal(cast.length, size * size * 4);
    assert.notDeepEqual(cast, source);
    assert.deepEqual(source, copy);
    for (let y = 8; y < 22; y++)
      for (let x = 10; x <= 20; x++)
        assert.deepEqual(
          cast.subarray((y * size + x) * 4, (y * size + x + 1) * 4),
          source.subarray((y * size + x) * 4, (y * size + x + 1) * 4),
        );
    if (stage === 2)
      assert.deepEqual(cast.subarray(0, 42 * size * 4), source.subarray(0, 42 * size * 4));
  }
  assert.throws(() => wizardCasterFrame(new Uint8ClampedArray(32 * 32 * 4), 2, 1), /48/);
});

test('시전 기울임·부유가 카메라 좌표를 옮기지 않고 최소 창의 가장자리에서도 펫을 보존한다', () => {
  for (const stage of [0, 1, 2])
    for (const x of [12, 60, 206])
      for (const foot of [104, 200])
        for (let time = 0; time <= 3000; time += 40) {
          const pose = petCombatPose(profile, time, origin, target);
          const body = wizardBodyProjection(pose, stage, 96, { x, foot, width: 316, height: 220 });
          assert.equal(Math.abs(body.x % (96 / wizardFrameSize(stage))), 0);
          assert.equal(Math.abs(body.y % (96 / wizardFrameSize(stage))), 0);
          const a = (body.tilt * Math.PI) / 180;
          for (const [cx, cy] of [
            [-48, -96],
            [48, -96],
            [-48, 0],
            [48, 0],
          ]) {
            const px =
              x + 48 + body.x + cx! * body.scaleX * Math.cos(a) - cy! * body.scaleY * Math.sin(a);
            const py =
              foot + body.y + cx! * body.scaleX * Math.sin(a) + cy! * body.scaleY * Math.cos(a);
            assert.ok(px >= 4 && px <= 312 && py >= 4 && py <= 216, `${stage}/${time} clipped`);
          }
          assert.deepEqual(pose.position, origin);
        }
  assert.ok(wizardBodyProjection(petCombatPose(profile, 1000, origin, target), 2, 96).y < -20);
});

test('세 단계 모두 유성우가 화면 전역을 채우고 진화할수록 밀도가 높아지며 개수는 제한된다', () => {
  const pose = petCombatPose(profile, 1450, origin, target);
  const fields = [0, 1, 2].map((stage) => wizardSpellPixels(pose, stage, layout));
  assert.ok(fields[0]!.meteorCount > 0 && fields[0]!.meteorCount < fields[2]!.meteorCount);
  assert.ok(fields[0]!.front.length < fields[2]!.front.length);
  for (const field of fields) {
    assert.ok(field.meteorCount <= 24);
    for (let column = 0; column < 4; column++)
      assert.ok(
        field.front.some(
          (p) => p.x >= (layout.width * column) / 4 && p.x < (layout.width * (column + 1)) / 4,
        ),
        `meteor rain misses column ${column}`,
      );
    assert.ok(field.back.some((p) => p.y < layout.height * 0.25));
    assert.ok(field.back.some((p) => p.y > layout.height * 0.75));
    assert.ok(field.dim > 0);
    for (const p of [...field.back, ...field.front])
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y) && p.width > 0 && p.height > 0);
  }
  assert.ok(
    wizardSpellPixels(petCombatPose(profile, 2100, origin, target), 2, layout).front.some(
      (p) => p.width >= 30,
    ),
  );
  assert.ok(
    wizardSpellPixels(petCombatPose(profile, 2500, origin, target), 2, layout).front.some(
      (p) => p.x > layout.width * 0.6,
    ),
  );
});

test('모션 감소는 유성우·지팡이 합성과 부유를 생략하고 타격 한 번만 유지한다', () => {
  for (const t of [300, 1000, 2100, 2240, 2800, 3000]) {
    const reduced = petCombatPose(profile, t, origin, target, true);
    assert.deepEqual(wizardSpellPixels(reduced, 2, layout), {
      back: [],
      front: [],
      dim: 0,
      meteorCount: 0,
    });
    assert.deepEqual(wizardBodyProjection(reduced, 2, 96), {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      tilt: 0,
      shadowScale: 1,
      shadowOpacity: 1,
    });
  }
  assert.equal(petCombatPose(profile, 2240, origin, target, true).impact, true);
});

test('STOP·숨김·선택 변경·정복은 어느 시전 단계에서도 두 화면 효과층과 타격을 해제한다', () => {
  const options: ArenaInput = {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'wizard:1',
    running: true,
    petSprite: 'star_wizard',
  };
  for (const phase of ['WIZARD_CHARGE', 'WIZARD_RAIN', 'WIZARD_FINISH', 'WIZARD_BURST'])
    for (const change of [
      { running: false },
      { suspended: true },
      { hpRatio: 0 },
      { key: 'hamster:1', petSprite: 'cheek_hamster' },
    ]) {
      const arena = new ArenaDirector(() => 0.35);
      let at = -1;
      for (let t = 0; t < 24000; t += 20)
        if (arena.frame({ ...options, nowMs: t }).petAnimation.phase === phase) {
          at = t;
          break;
        }
      assert.ok(at >= 0);
      const frame = arena.frame({ ...options, ...change, nowMs: at + 20 });
      assert.equal(frame.petAnimation.wizard, null);
      assert.equal(frame.petImpact, false);
      assert.deepEqual(wizardSpellPixels(frame.petAnimation, 2, layout), {
        back: [],
        front: [],
        dim: 0,
        meteorCount: 0,
      });
    }
});
