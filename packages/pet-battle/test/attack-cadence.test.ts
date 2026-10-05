import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame, type ArenaInput } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

function input(overrides: Partial<ArenaInput> = {}): ArenaInput {
  return {
    layout: battleLayout(636, 416),
    nowMs: 0,
    hpRatio: 1,
    enemyHeight: 80,
    theme: 'MUSHROOM_FOREST',
    key: 'pet:stage-1',
    running: true,
    ...overrides,
  };
}

function beat(frame: ArenaFrame): string | null {
  if (frame.petImpact) return 'PET_IMPACT';
  if (frame.petAttack) return 'PET_ATTACK';
  if (frame.phase === 'PET_RECOVER') return 'PET_RECOVER';
  if (frame.phase === 'CROUCH') return 'ENEMY_CROUCH';
  if (frame.phase === 'JUMP') return 'ENEMY_JUMP';
  if (frame.enemyImpact) return 'ENEMY_IMPACT';
  return null;
}

test('화면 갱신이 늦어져도 근접한 양쪽의 공격·타격·회복 차례를 건너뛰지 않는다', () => {
  for (const cadence of [83, 137, 250, 500, 1000, 1499]) {
    for (const hpRatio of [1, 0.6, 0.25]) {
      for (const enemyHeight of [56, 64, 80]) {
        const director = new ArenaDirector(() => 0.35);
        const seen: string[] = [];
        for (let nowMs = 0; nowMs < 40000; nowMs += cadence) {
          const frame = director.frame(input({ nowMs, hpRatio, enemyHeight }));
          if (frame.attackTurn !== null) {
            assert.equal(frame.inAttackRange, true);
            assert.equal(frame.petStep, null);
            assert.equal(frame.enemyStep, null);
          }
          assert.ok(!(frame.petAttack && (frame.petHit || frame.enemyImpact)));
          const current = beat(frame);
          if (current !== null && seen.at(-1) !== current) seen.push(current);
          if (frame.enemyImpact) break;
        }
        // PET_ATTACK can reappear after its impact; compare first appearance order.
        assert.deepEqual(
          [...new Set(seen)],
          ['PET_ATTACK', 'PET_IMPACT', 'PET_RECOVER', 'ENEMY_CROUCH', 'ENEMY_JUMP', 'ENEMY_IMPACT'],
          `missed close-range attack at ${cadence}ms cadence, HP ${hpRatio}, size ${enemyHeight}`,
        );
      }
    }
  }
});

test('타격 직전 단발성 지연은 타격을 복구하고 이후 정상 프레임에서 한 번만 표시한다', () => {
  for (const [phase, offset, signal] of [
    ['PET_ATTACK', 230, 'petImpact'],
    ['JUMP', 580, 'enemyImpact'],
  ] as const) {
    const director = new ArenaDirector(() => 0.35);
    let start = 0;
    for (let nowMs = 0; nowMs < 40000; nowMs += 10) {
      if (director.frame(input({ nowMs })).phase === phase) {
        start = nowMs;
        break;
      }
    }
    assert.ok(start > 0, 'wait for the actual attack rather than a fixed choreography time');
    const before = start + offset;
    const after = before + 230;
    for (let nowMs = start + 10; nowMs <= before; nowMs += 10) director.frame(input({ nowMs }));
    let frame = director.frame(input({ nowMs: after }));
    assert.equal(frame[signal], true, `do not lose ${signal} after a 230ms stall`);
    let active = true;
    let starts = 1;
    for (let nowMs = after + 10; nowMs < after + 1000; nowMs += 10) {
      frame = director.frame(input({ nowMs }));
      if (frame[signal] && !active) starts++;
      active = frame[signal];
    }
    assert.equal(starts, 1, 'never replay an old impact on every fresh frame');
    assert.equal(active, false, 'recovery still completes');
  }
});

test('누락 공격 복구 중 STOP·메뉴·HP 0·장면 교체는 공격을 취소한다', () => {
  for (const change of [
    { running: false },
    { menuOpen: true },
    { hpRatio: 0 },
    { key: 'another-pet' },
  ]) {
    const director = new ArenaDirector(() => 0.35);
    let recoveredAt = 0;
    for (let nowMs = 0; nowMs <= 40000; nowMs += 1000) {
      if (director.frame(input({ nowMs })).petAttack) {
        recoveredAt = nowMs;
        break;
      }
    }
    assert.ok(recoveredAt > 0, 'an actual recovered attack must be active');
    const stopped = director.frame(input({ nowMs: recoveredAt + 16, ...change }));
    assert.equal(stopped.attackTurn, null);
    assert.equal(
      stopped.petAttack || stopped.petImpact || stopped.enemyImpact || stopped.petHit,
      false,
    );
  }
});

test('느린 갱신에서도 멀리 떨어진 캐릭터는 허공을 공격하지 않는다', () => {
  const director = new ArenaDirector(() => 0.35);
  const layout = { ...battleLayout(956, 536), petLeft: 140, enemyLeft: 660 };
  for (let nowMs = 0; nowMs < 30000; nowMs += 1000) {
    const frame = director.frame(input({ nowMs, layout }));
    if (!frame.inAttackRange) {
      assert.equal(frame.attackTurn, null);
      assert.equal(frame.petAttack || frame.petImpact || frame.enemyImpact || frame.petHit, false);
    }
  }
});

test('지연 복구 후 여러 주기에서도 펫 타격과 적 내려찍기는 하나씩 번갈아 나온다', () => {
  const director = new ArenaDirector(() => 0.35);
  const hits: string[] = [];
  let previous = director.frame(input());
  for (let nowMs = 1000; nowMs <= 60000; nowMs += 1000) {
    const frame = director.frame(input({ nowMs }));
    if (frame.petImpact && !previous.petImpact) hits.push('PET');
    if (frame.enemyImpact && !previous.enemyImpact) hits.push('ENEMY');
    previous = frame;
  }
  assert.ok(hits.length >= 6, 'attack progression cannot get stuck after the first exchange');
  hits.forEach((actor, index) => assert.equal(actor, index % 2 === 0 ? 'PET' : 'ENEMY'));
});

test('공격 시계를 복구해도 카메라는 실제 활성 시간의 500ms 전 펫 지면 위치를 따른다', () => {
  const director = new ArenaDirector(() => 0.35);
  const history: { at: number; frame: ArenaFrame }[] = [];
  let checked = 0;
  for (let nowMs = 0; nowMs <= 12000; nowMs += 20) {
    if (nowMs > 2400 && nowMs < 3400) continue;
    const frame = director.frame(input({ nowMs }));
    history.push({ at: nowMs, frame });
    if (nowMs < 3900 || frame.petStep === null) continue;
    const before = history.findLast((entry) => entry.at <= nowMs - 500)!;
    const after = history.find((entry) => entry.at >= nowMs - 500)!;
    const fraction =
      before.at === after.at ? 0 : (nowMs - 500 - before.at) / (after.at - before.at);
    for (const axis of ['x', 'y'] as const) {
      const from = before.frame.world.pet[axis];
      const to = after.frame.world.pet[axis];
      const expected = from + (to - from) * fraction - history[0]!.frame.world.pet[axis];
      assert.ok(Math.abs(frame.cameraTarget[axis] - expected) < 0.00001);
    }
    checked++;
  }
  assert.ok(checked > 0, 'check resumed footsteps after the delayed attack');
});
