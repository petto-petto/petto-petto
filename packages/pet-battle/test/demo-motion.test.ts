import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoBattleGateway } from '../src/ui/demo-gateway.ts';
import { deriveBattleScene } from '../src/view/scene.ts';
import { sampleCombatMotion } from '../src/view/motion.ts';

test('오버레이 진입 직후 공격을 시작하고 반복 타격과 검 이펙트를 만든다', async () => {
  const gateway = new DemoBattleGateway();
  const first = (await gateway.execute({ type: 'GET_STATE', nowMs: 1000 })).state;
  assert.equal(first.motion?.beat, 'ANTICIPATION');
  assert.equal(deriveBattleScene(first).petSprite.animated, true);
  for (const nowMs of [1520, 3920, 6320]) {
    const { state } = await gateway.execute({ type: 'GET_STATE', nowMs });
    assert.equal(state.motion?.beat, 'IMPACT');
    assert.ok(state.motion.slashOpacity > 0);
    assert.ok(state.motion.impactFlashOpacity > 0);
    assert.equal(state.enemyHpRatio, 1, '모션만으로 XP나 HP를 임의로 변경하지 않는다');
  }
});

test('STOP은 이동·검 이펙트를 멈추고 START는 새 공격 주기를 시작한다', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const gateway = new DemoBattleGateway();
  await gateway.execute({ type: 'GET_STATE', nowMs: now });
  now = 1520;
  await gateway.execute({ type: 'GET_STATE', nowMs: now });
  const stopped = (await gateway.execute({ type: 'SET_BATTLE_RUNNING', running: false })).state;
  assert.equal(stopped.motion?.beat, 'IDLE');
  assert.equal(stopped.motion.slashOpacity, 0);
  assert.deepEqual(stopped.motion.petOffset, { x: 0, y: 0 });
  now = 9000;
  const later = (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state;
  assert.deepEqual(later.motion, stopped.motion);
  await gateway.execute({ type: 'SET_BATTLE_RUNNING', running: true });
  const restarted = (await gateway.execute({ type: 'GET_STATE', nowMs: now + 520 })).state;
  assert.equal(restarted.motion?.beat, 'IMPACT');
});

test('중지 중 수동 공격은 한번 재생하며 재클릭한 공격이 이전 타이머에 끊기지 않는다', async (t) => {
  t.mock.method(Date, 'now', () => 1000);
  const gateway = new DemoBattleGateway();
  await gateway.execute({ type: 'SET_BATTLE_RUNNING', running: false });
  await gateway.execute({ type: 'PREVIEW_PET', action: 'ATTACK', nowMs: 1000 });
  const impact = (await gateway.execute({ type: 'GET_STATE', nowMs: 1440 })).state;
  assert.equal(impact.motion?.beat, 'IMPACT');
  await gateway.execute({ type: 'PREVIEW_PET', action: 'ATTACK', nowMs: 1500 });
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: 2000 })).state.preview.petAction,
    'ATTACK',
  );
  const end = (await gateway.execute({ type: 'GET_STATE', nowMs: 2460 })).state;
  assert.equal(end.preview.petAction, null);
  assert.equal(end.motion?.beat, 'IDLE');
  assert.equal(deriveBattleScene(end).petSprite.animated, false);
});

test('효과 버튼과 모션 감소 상태에서도 타격 시점의 검 이펙트를 유지한다', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const gateway = new DemoBattleGateway();
  await gateway.execute({ type: 'SET_BATTLE_RUNNING', running: false });
  await gateway.execute({ type: 'CYCLE_ATTACK_EFFECT' });
  await gateway.execute({ type: 'TOGGLE_REDUCED_MOTION' });
  now += 440;
  const { state } = await gateway.execute({ type: 'GET_STATE', nowMs: now });
  assert.equal(state.motion?.beat, 'IMPACT');
  assert.ok(state.motion.slashOpacity > 0);
  assert.deepEqual(state.motion.petOffset, { x: 0, y: 0 });
});

test('공격 각 구간은 Rust 연출과 같은 순서와 이동 한계를 유지한다', () => {
  for (const [phase, beat] of [
    [0, 'IDLE'],
    [0.43, 'ANTICIPATION'],
    [0.52, 'DASH'],
    [0.635, 'IMPACT'],
    [0.7, 'RECOVERY'],
    [0.81, 'IDLE'],
  ] as const) {
    assert.equal(sampleCombatMotion(phase, 0, false).beat, beat);
  }
  for (let frame = 0; frame < 240; frame += 1) {
    const motion = sampleCombatMotion(frame / 120, frame, false);
    assert.ok(motion.petOffset.x >= -8 && motion.petOffset.x <= 34);
    assert.ok(motion.slashOpacity >= 0 && motion.slashOpacity <= 1);
    const reduced = sampleCombatMotion(frame / 120, frame, true);
    assert.deepEqual(reduced.petOffset, { x: 0, y: 0 });
  }
});

test('시각화 타이머 교체 후에도 적 미리보기와 기존 조작을 유지한다', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const gateway = new DemoBattleGateway();
  await gateway.execute({ type: 'TOGGLE_BATTLE' });
  await gateway.execute({ type: 'TOGGLE_MENU', menu: 'PET' });
  assert.equal(
    (await gateway.execute({ type: 'TOGGLE_MENU', menu: 'PET' })).state.preview.menu,
    'CLOSED',
  );
  await gateway.execute({ type: 'CYCLE_PET_ASSET' });
  await gateway.execute({ type: 'CYCLE_ENEMY_SIZE' });
  await gateway.execute({ type: 'CYCLE_ENEMY_COLOR' });
  await gateway.execute({ type: 'SET_DISPLAY_OPACITY', percent: 45 });
  await gateway.execute({ type: 'CYCLE_ATTACK_EFFECT' });
  const controls = (await gateway.execute({ type: 'CYCLE_ATTACK_EFFECT' })).state;
  assert.equal(controls.preview.petAssetRarity, 'RARE');
  assert.equal(controls.preview.enemySize, 'SMALL');
  assert.equal(controls.preview.enemyColor, 'ORANGE');
  assert.equal(controls.preview.attackEffectRarity, 'RARE');
  assert.equal(controls.preview.displayOpacity, 0.45);
  await gateway.execute({ type: 'SET_BATTLE_RUNNING', running: false });
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state.preview.petAction,
    null,
  );
  for (const hp of [0.6, 0.25, 1]) {
    const state = (await gateway.execute({ type: 'CYCLE_ENEMY_HP' })).state;
    assert.equal(state.preview.enemyHpRatio, hp);
    assert.equal(state.preview.enemyPhase, 'HIT');
    now += 420;
    assert.equal(
      (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state.preview.enemyPhase,
      'VISIBLE',
    );
  }
  for (const [action, duration, phase] of [
    ['DEFEAT', 1100, 'HIDDEN'],
    ['SPAWN', 720, 'VISIBLE'],
  ] as const) {
    await gateway.execute({ type: 'PREVIEW_ENEMY', action, nowMs: now });
    now += duration;
    assert.equal(
      (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state.preview.enemyPhase,
      phase,
    );
  }
  await gateway.execute({ type: 'PREVIEW_ENEMY', action: 'RESET', nowMs: now });
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state.preview.enemyHpRatio,
    null,
  );
  await gateway.execute({ type: 'PREVIEW_PET', action: 'GROWTH', nowMs: now });
  now += 780;
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: now })).state.preview.petAction,
    null,
  );
});
