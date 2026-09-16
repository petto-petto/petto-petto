import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoBattleGateway } from '../src/ui/demo-gateway.ts';
import { deriveBattleScene } from '../src/view/scene.ts';

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
