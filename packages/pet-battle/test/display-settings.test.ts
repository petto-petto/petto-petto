import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DisplaySettingsBattleGateway } from '../src/app/display-settings.ts';
import { DemoBattleGateway } from '../src/testing/demo-gateway.ts';
import { ElectronBattleEngine } from '../src/app/battle-engine.ts';
import { OwnedPetBattleGateway } from '../src/app/owned-pet-gateway.ts';
import { deriveBattleScene } from '../src/view/scene.ts';
import { ArenaDirector } from '../src/view/arena.ts';
import { battleLayout } from '../src/view/layout.ts';

test('설정과 전투 투명도는 저장 상태를 공유하고 저장 실패에서 복구한다', async () => {
  const stored = { animationsEnabled: false, opacity: 42 };
  let fail = false;
  const port = {
    read: () => ({ ...stored }),
    setOpacity(percent: number) {
      if (fail) throw new Error('save failed');
      stored.opacity = percent;
    },
  };
  const gateway = new DisplaySettingsBattleGateway(new DemoBattleGateway(), port);
  const first = await gateway.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(first.state.preview.displayOpacity, 0.42);
  assert.equal(first.state.preview.animationsEnabled, false);
  assert.equal(first.state.activePet?.battleMode, 'FIGHTING');
  stored.opacity = 0;
  stored.animationsEnabled = true;
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: 0 })).state.preview.displayOpacity,
    0,
  );
  await gateway.execute({ type: 'SET_DISPLAY_OPACITY', percent: 75 });
  assert.equal(stored.opacity, 75);
  fail = true;
  await assert.rejects(
    gateway.execute({ type: 'SET_DISPLAY_OPACITY', percent: 20 }),
    /save failed/,
  );
  assert.equal(
    (await gateway.execute({ type: 'GET_STATE', nowMs: 0 })).state.preview.displayOpacity,
    0.75,
  );
  await assert.rejects(gateway.execute({ type: 'SET_DISPLAY_OPACITY', percent: 101 }));
  const reopened = new DisplaySettingsBattleGateway(new DemoBattleGateway(), port);
  const result = await reopened.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.preview.displayOpacity, 0.75);
  assert.equal(result.state.preview.animationsEnabled, true);
});

test('간소화에서도 저장 XP에서 진행을 동기화하고 기본 공격 시트를 표시한다', async () => {
  const pet = {
    ownedPetId: 'pet',
    speciesId: '003',
    name: '두더지',
    nickname: null,
    rarity: 'COMMON' as const,
    sprite: 'mole_digger',
    level: 1,
    totalXp: 0,
    xpIntoLevel: 0,
    evolutionStage: 0 as const,
    isActive: true,
  };
  const settings = { animationsEnabled: false, opacity: 100 };
  const gateway = new DisplaySettingsBattleGateway(
    new OwnedPetBattleGateway(
      { getActivePet: () => pet, listOwnedPets: () => [pet] },
      new ElectronBattleEngine(),
      { levelXpCosts: [10], intervalLevels: { COMMON: 2, RARE: 2, EPIC: 3 } },
    ),
    {
      read: () => settings,
      setOpacity: (opacity) => {
        settings.opacity = opacity;
      },
    },
  );
  await gateway.execute({ type: 'GET_STATE', nowMs: 0 });
  pet.totalXp = 20;
  const result = await gateway.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet?.stage, 2);
  assert.equal(result.state.activePet?.battleMode, 'FIGHTING');
  assert.equal(
    deriveBattleScene(
      { ...result.state, overlay: null, preview: { ...result.state.preview, petAction: 'ATTACK' } },
      true,
    ).petSprite.animated,
    true,
  );
  settings.animationsEnabled = true;
  const enabled = await gateway.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(enabled.state.activePet?.stage, 2);
  assert.equal(enabled.state.preview.animationsEnabled, true);
});

test('간소화는 모든 펫 종류에서 제자리 공격을 유지하며 카메라와 종별 큰 모션을 끈다', () => {
  for (const petSprite of [
    'mole_digger',
    'sprout_treant',
    'midnight_zebra',
    'cheek_hamster',
    'star_wizard',
    'acorn_squirrel',
  ]) {
    const arena = new ArenaDirector(() => 0.5);
    const input = {
      simple: true,
      petSprite,
      layout: battleLayout(640, 420),
      nowMs: 0,
      hpRatio: 1,
      enemyHeight: 56,
      theme: 'MUSHROOM_FOREST' as const,
      key: petSprite,
      running: true,
    };
    const initial = arena.frame(input);
    let attacks = 0;
    let counterattacks = 0;
    for (let nowMs = 20; nowMs <= 8000; nowMs += 20) {
      const frame = arena.frame({ ...input, nowMs });
      assert.deepEqual(frame.world.pet, initial.world.pet);
      assert.deepEqual(frame.world.enemy, initial.world.enemy);
      assert.deepEqual(frame.camera, initial.camera);
      assert.equal(frame.petAnimation.id, 'default');
      attacks += Number(frame.petAttack);
      counterattacks += Number(frame.attackTurn === 'ENEMY');
    }
    assert.ok(attacks > 0);
    assert.ok(counterattacks > 0);
  }
});
