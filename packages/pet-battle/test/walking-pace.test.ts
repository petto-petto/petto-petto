import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArenaDirector, type ArenaFrame } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

function cycle(hpRatio: number) {
  const director = new ArenaDirector(() => 0.35);
  const frames = new Map<number, ArenaFrame>();
  for (let nowMs = 0; nowMs <= 40000; nowMs += 10) {
    frames.set(
      nowMs,
      director.frame({
        layout: battleLayout(636, 416),
        nowMs,
        hpRatio,
        enemyHeight: 80,
        theme: 'MUSHROOM_FOREST',
        key: 'pet:1',
        running: true,
      }),
    );
  }
  return frames;
}

test('각 개체는 자기 속도의 발걸음으로 움직이며 멈춘 상대를 강제로 이동시키지 않는다', () => {
  for (const hp of [1, 0.6, 0.25]) {
    const samples = [...cycle(hp).values()];
    for (const actor of ['pet', 'enemy'] as const) {
      const steps = new Set<number>();
      for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1]!;
        const frame = samples[index]!;
        const step = actor === 'pet' ? frame.petStep : frame.enemyStep;
        if (step !== null) steps.add(step);
        if (step === null && frame.attackTurn === null && previous.attackTurn === null) {
          assert.ok(
            Math.hypot(
              frame.world[actor].x - previous.world[actor].x,
              frame.world[actor].y - previous.world[actor].y,
            ) < 0.00001,
            'no silent sliding without a footstep',
          );
        }
      }
      assert.ok(steps.size >= 4, `${actor} has visible planted/lifted stepping poses`);
    }
  }
});

test('보행 속도와 경로가 달라도 공격·내려찍기·피격의 재생 시간은 유지한다', () => {
  for (const hp of [1, 0.6, 0.25]) {
    const phases = new Map<string, number>();
    let started = false;
    let enemyStarted = false;
    let leapAt: number | undefined;
    let landAt: number | undefined;
    let petImpact = 0;
    let enemyImpact = 0;
    let petHit = 0;
    for (const [time, frame] of cycle(hp)) {
      if (frame.attackTurn === 'PET') started = true;
      if (frame.attackTurn === 'ENEMY') enemyStarted = true;
      if (!started) continue;
      if (enemyStarted && frame.attackTurn === null) break;
      phases.set(frame.phase, (phases.get(frame.phase) ?? 0) + 10);
      if (frame.phase === 'JUMP' && leapAt === undefined) leapAt = time;
      if (frame.enemyImpact && landAt === undefined) landAt = time;
      if (frame.petImpact) petImpact += 10;
      if (frame.enemyImpact) enemyImpact += 10;
      if (frame.petHit) petHit += 10;
    }
    assert.ok(started && enemyStarted);
    assert.equal(phases.get('PET_ATTACK'), 550);
    assert.equal(phases.get('PET_RECOVER'), 200);
    assert.equal(phases.get('CROUCH'), 100);
    assert.equal(landAt! - leapAt!, 600);
    assert.equal(petImpact, 140);
    assert.equal(enemyImpact, 130);
    assert.equal(petHit, 280);
  }
});
