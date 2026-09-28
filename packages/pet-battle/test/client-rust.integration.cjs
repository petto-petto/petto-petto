const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

// Contract fixture only: no owner implementation, SQLite, or user data is accessed.
const rules = {
  levelXpCosts: Array.from({ length: 50 }, (_, i) => 10 + Math.floor((i + 1) / 2)),
  intervalLevels: { COMMON: 12, RARE: 10, EPIC: 8 },
};
const initialPet = {
  ownedPetId: 'owned-001',
  speciesId: '003',
  name: '두더지',
  nickname: '토리',
  rarity: 'COMMON',
  sprite: 'mole_digger',
  level: 12,
  totalXp: 155,
  xpIntoLevel: 15,
  evolutionStage: 0,
  isActive: true,
};

test('PetClient 저장값 → 실제 Rust HP·정복·다음 적, 중복 알림·재연결·활성 해제', async (t) => {
  const { PetBattleIntegration, spawnBattleSidecar } = await import('../dist/index.js');
  let active = { ...initialPet };
  const client = new Proxy(
    {
      getActivePet: () => active,
      listOwnedPets: () => (active ? [active] : []),
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        throw new Error(`전투에서 허용하지 않은 공통 API: ${String(key)}`);
      },
    },
  );
  const connect = () => {
    const engine = spawnBattleSidecar(
      path.resolve(__dirname, '../rust/target/debug/pet-battle-engine'),
    );
    t.after(() => engine.sidecar.close());
    return new PetBattleIntegration(client, engine.client, rules);
  };
  const battle = connect();
  let result = await battle.syncActivePet();
  assert.equal(result.state.activePet.petId, 'owned-001');
  assert.equal(result.state.activePet.displayName, '토리');
  assert.equal(result.state.activePet.stage, 1);
  assert.ok(Math.abs(result.state.enemyHpRatio - 1 / 156) < 0.00001);

  active = { ...active, level: 13, totalXp: 156, xpIntoLevel: 0 };
  const notification = { ownedPetId: active.ownedPetId, amount: 99999, nowMs: 0 };
  result = await battle.applyGrowthXp(notification);
  assert.equal(result.state.activePet.stage, 2);
  assert.equal(result.state.enemyHpRatio, 0);
  assert.equal(result.events.filter((e) => e.type === 'ENEMY_DEFEATED').length, 1);
  result = await battle.applyGrowthXp(notification);
  assert.equal(result.events.filter((e) => e.type === 'ENEMY_DEFEATED').length, 0);
  assert.equal(result.state.activePet.stage, 2);

  await battle.execute({ type: 'OVERLAY_CLICK', nowMs: 0 });
  result = await battle.execute({ type: 'OVERLAY_CLICK', nowMs: 0 });
  assert.equal(result.state.enemyColor, 'ORANGE');
  assert.equal(result.state.background, 'MUSHROOM_FOREST');

  active = { ...active, level: 37, totalXp: 684, xpIntoLevel: 0 };
  const reconnected = connect();
  result = await reconnected.syncActivePet();
  assert.equal(result.state.activePet.stage, 4);
  assert.equal(result.state.enemyColor, 'GREEN');
  assert.equal(result.state.background, 'CRYSTAL_RUINS');
  assert.equal(
    result.events.some((e) => e.type === 'ENEMY_DEFEATED'),
    false,
  );

  active = null;
  result = await reconnected.syncActivePet();
  assert.equal(result.state.activePet, null);
  assert.deepEqual(result.state.roster, []);
});
