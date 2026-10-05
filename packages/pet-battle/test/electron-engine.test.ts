import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ElectronBattleEngine } from '../src/app/battle-engine.ts';
import type { BattleCommand, Rarity } from '../src/contracts.ts';
import { progression } from '../src/domain/growth.ts';

const costs = Array.from({ length: 50 }, (_, i) => 10 + Math.floor((i + 1) / 2));
function sync(
  totalXp: number | null,
  nowMs = 1000,
  rarity: Rarity = 'COMMON',
): Extract<BattleCommand, { type: 'SYNC_OWNED_PETS' }> {
  return {
    type: 'SYNC_OWNED_PETS',
    nowMs,
    activePetId: 'one',
    spectatorPetIds: [],
    levelXpCosts: costs,
    intervalLevels: { COMMON: 12, RARE: 10, EPIC: 8 },
    pets: [
      {
        petId: 'one',
        displayName: '토리',
        rarity,
        level: 50,
        sprite: 'acorn_squirrel',
        evolutionStage: 2,
        totalXp,
      },
    ],
  };
}

for (const rarity of ['COMMON', 'RARE', 'EPIC'] as const) {
  test(`${rarity}: saved XP restores and one new conquest preserves STOP and opacity`, async () => {
    const engine = new ElectronBattleEngine();
    assert.equal((await engine.execute(sync(320, 0, rarity))).state.activePet?.stage, 10);
    const fresh = new ElectronBattleEngine();
    await fresh.execute(sync(81, 0, rarity));
    await fresh.execute({ type: 'SET_BATTLE_RUNNING', running: false });
    await fresh.execute({ type: 'SET_DISPLAY_OPACITY', percent: 35 });
    const defeat = await fresh.execute(sync(82, 1000, rarity));
    assert.deepEqual(defeat.events, [
      { type: 'ENEMY_DEFEATED', petId: 'one', defeatedStage: 3, nextStage: 4, skippedStages: 0 },
    ]);
    assert.equal(defeat.state.enemyHpRatio, 0);
    assert.equal(defeat.state.enemyColor, 'RED');
    assert.deepEqual((await fresh.execute(sync(82, 1100, rarity))).events, []);
    assert.equal(
      (await fresh.execute({ type: 'GET_STATE', nowMs: 2479 })).state.overlay?.phase,
      'DEFEAT_MOTION',
    );
    const spawn = await fresh.execute({ type: 'GET_STATE', nowMs: 2480 });
    assert.equal(spawn.state.overlay?.phase, 'SPAWNING');
    assert.equal(spawn.state.enemyColor, 'ORANGE');
    const finished = await fresh.execute({ type: 'GET_STATE', nowMs: 3200 });
    assert.equal(finished.state.overlay, null);
    assert.equal(finished.state.preview.displayOpacity, 0.35);
    assert.equal(finished.state.activePet?.battleMode, 'PAUSED');
    assert.equal(finished.state.motion?.beat, 'IDLE');
    const maxLevel = costs.slice(0, 49).reduce((a, b) => a + b, 0);
    assert.equal(
      (await new ElectronBattleEngine().execute(sync(maxLevel, 0, rarity))).state.activePet?.stage,
      22,
    );
  });
}

test('new XP updates conquest destination without restarting time; click skips death', async () => {
  const e = new ElectronBattleEngine();
  await e.execute(sync(20, 0));
  await e.execute(sync(21, 1000));
  const later = await e.execute(sync(82, 1400));
  assert.equal(later.state.overlay?.defeatedStage, 1);
  assert.equal(later.state.overlay?.nextStage, 4);
  assert.equal(
    (await e.execute({ type: 'GET_STATE', nowMs: 2480 })).state.overlay?.phase,
    'SPAWNING',
  );
  await e.execute(sync(189, 2600));
  assert.equal((await e.execute({ type: 'GET_STATE', nowMs: 3200 })).state.overlay, null);
  await e.execute(sync(300, 4000));
  const skipped = await e.execute({ type: 'OVERLAY_CLICK', nowMs: 4100 });
  assert.deepEqual(skipped.events, [{ type: 'OVERLAY_ADVANCED', result: 'DEFEAT_MOTION_SKIPPED' }]);
  assert.equal((await e.execute({ type: 'GET_STATE', nowMs: 4820 })).state.overlay, null);
});

test('unlinked/linked changes reset stale conquest without fabricated growth; snapshots are detached', async () => {
  const e = new ElectronBattleEngine();
  await e.execute(sync(20));
  await e.execute(sync(21));
  const unlinked = await e.execute(sync(null));
  assert.equal(unlinked.state.activePet?.stage, 1);
  assert.equal(unlinked.state.enemyHpRatio, 1);
  assert.equal(unlinked.state.overlay, null);
  assert.deepEqual((await e.execute(sync(320))).events, []);
  unlinked.state.roster.length = 0;
  assert.equal((await e.execute({ type: 'GET_STATE', nowMs: 1000 })).state.roster.length, 1);
  const empty = sync(null);
  empty.pets = [];
  empty.activePetId = null;
  assert.equal((await e.execute(empty)).state.activePet, null);
});

test('previews expire at their original deadlines and never modify progression', async () => {
  const e = new ElectronBattleEngine();
  await e.execute(sync(81, 0));
  await e.execute({ type: 'PREVIEW_ENEMY', action: 'DEFEAT', nowMs: 1000 });
  const hidden = await e.execute({ type: 'GET_STATE', nowMs: 2100 });
  assert.equal(hidden.state.preview.enemyPhase, 'HIDDEN');
  assert.equal(hidden.state.activePet?.stage, 3);
  assert.equal(hidden.state.overlay, null);
  await e.execute({ type: 'PREVIEW_PET', action: 'ATTACK', nowMs: 3000 });
  assert.equal(
    (await e.execute({ type: 'GET_STATE', nowMs: 3959 })).state.preview.petAction,
    'ATTACK',
  );
  assert.equal((await e.execute({ type: 'GET_STATE', nowMs: 3960 })).state.preview.petAction, null);
});

test('invalid growth snapshots reject without replacing the roster', async () => {
  const e = new ElectronBattleEngine();
  await e.execute(sync(20));
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(e.execute(sync(value)), /XP/);
  }
  const bad = sync(100);
  bad.levelXpCosts = [];
  await assert.rejects(e.execute(bad), /curve/);
  assert.equal(
    (await e.execute({ type: 'GET_STATE', nowMs: 1000 })).state.activePet?.intervalXp,
    20,
  );
});

test('every enemy boundary and truncated/extended curves match original growth contracts', async () => {
  for (const rarity of ['COMMON', 'RARE', 'EPIC'] as const) {
    let xp = 0;
    let levelIndex = 0;
    for (let stage = 1; stage <= 21; stage++) {
      const levels = [2, 2, 3][(stage - 1) % 3]!;
      const target = costs.slice(levelIndex, levelIndex + levels).reduce((a, b) => a + b, 0);
      for (const within of [0, target - 1]) {
        const result = await new ElectronBattleEngine().execute(sync(xp + within, 0, rarity));
        assert.equal(result.state.activePet?.stage, stage);
        assert.equal(result.state.activePet?.intervalXp, within);
        assert.ok(Math.abs(result.state.enemyHpRatio - (1 - within / target)) < 1e-6);
        assert.equal(
          result.state.enemyColor,
          ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'RAINBOW'][
            Math.floor((stage - 1) / 3)
          ],
        );
        assert.deepEqual(result.events, []);
      }
      xp += target;
      levelIndex += levels;
    }
    assert.equal(xp, 1090);
    assert.equal(levelIndex, 49);
  }
  for (const [xp, stage, within, target] of [
    [1090, 22, 0, 70],
    [1125, 22, 35, 70],
    [1160, 23, 0, 70],
    [1230, 24, 0, 105],
    [1334, 24, 104, 105],
    [1335, 25, 0, 70],
  ] as const) {
    assert.deepEqual(progression(xp, costs), { stage, intervalXp: within, target });
  }
  for (const [xp, stage, within, target] of [
    [0, 1, 0, 5],
    [5, 2, 0, 12],
    [17, 3, 0, 21],
    [37, 3, 20, 21],
    [38, 4, 0, 14],
    [87, 7, 0, 14],
  ] as const) {
    assert.deepEqual(progression(xp, [2, 3, 5, 7]), { stage, intervalXp: within, target });
  }
  for (const curve of [[1], costs, Array.from({ length: 100 }, () => 1_000_000)]) {
    const p = progression(Number.MAX_SAFE_INTEGER, curve);
    assert.ok(p.stage > 1 && p.stage <= 0xffff_ffff);
    assert.ok(p.intervalXp >= 0 && p.intervalXp < p.target);
  }
});

test('same-species individuals keep separate pause/XP; selection and reconnect do not replay history', async () => {
  const e = new ElectronBattleEngine();
  const one = sync(20);
  one.pets.push({ ...one.pets[0]!, petId: 'two', totalXp: 320 });
  one.spectatorPetIds = ['one', 'missing', 'two'];
  assert.deepEqual((await e.execute(one)).state.spectatorPetIds, ['two']);
  await e.execute({ type: 'SET_BATTLE_RUNNING', running: false });
  const two = structuredClone(one);
  two.activePetId = 'two';
  const switched = await e.execute(two);
  assert.equal(switched.state.activePet?.stage, 10);
  assert.equal(switched.state.activePet?.battleMode, 'FIGHTING');
  assert.deepEqual(switched.events, []);
  assert.equal((await e.execute(one)).state.activePet?.battleMode, 'PAUSED');
  const delta = structuredClone(one);
  delta.pets[0]!.totalXp = 20;
  assert.deepEqual((await e.execute(delta)).events, []);
  delta.pets[0]!.totalXp = 19;
  assert.deepEqual((await e.execute(delta)).events, []);
  delta.pets[0]!.totalXp = 20;
  assert.equal((await e.execute(delta)).events[0]?.type, 'XP_APPLIED');
});

test('all preview controls stay independent from committed XP and support reset/reduced motion', async () => {
  const e = new ElectronBattleEngine();
  await e.execute(sync(44, 1000));
  assert.equal((await e.execute({ type: 'CYCLE_ENEMY_SIZE' })).state.preview.enemySize, 'SMALL');
  assert.equal((await e.execute({ type: 'CYCLE_ENEMY_COLOR' })).state.enemyColor, 'ORANGE');
  for (const hp of [0.6, 0.25, 1])
    assert.equal((await e.execute({ type: 'CYCLE_ENEMY_HP' })).state.preview.enemyHpRatio, hp);
  assert.equal((await e.execute({ type: 'CYCLE_PET_ASSET' })).state.preview.petAssetRarity, 'RARE');
  assert.equal(
    (await e.execute({ type: 'CYCLE_ATTACK_EFFECT' })).state.preview.attackEffectRarity,
    'COMMON',
  );
  assert.equal((await e.execute({ type: 'TOGGLE_MENU', menu: 'PET' })).state.preview.menu, 'PET');
  assert.equal(
    (await e.execute({ type: 'TOGGLE_MENU', menu: 'PET' })).state.preview.menu,
    'CLOSED',
  );
  assert.equal(
    (await e.execute({ type: 'TOGGLE_REDUCED_MOTION' })).state.preview.reducedMotion,
    true,
  );
  const reset = await e.execute({ type: 'PREVIEW_ENEMY', action: 'RESET', nowMs: 2000 });
  assert.equal(reset.state.preview.enemyHpRatio, null);
  assert.equal(reset.state.preview.enemySize, null);
  assert.equal(reset.state.enemyColor, 'RED');
  assert.equal(reset.state.activePet?.intervalXp, 0);
  assert.equal(reset.state.activePet?.stage, 3);
});
