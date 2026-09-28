const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, accessSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fileURLToPath } = require('node:url');
const test = require('node:test');
const { roomFixture } = require('./room-battle-selection.test.cjs');

async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { createBattleRuntime, mountBattle } = await import('../dist/main/battle.js');
  const { OVERLAY_GROWTH_RULES } = await import('../dist/main/growth-rules.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-battle-selection-'));
  const db = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  db.open();
  const pets = new SqlitePetClient(new PetRepository(db));
  const root = join(__dirname, '../../../packages/pet-battle');
  const options = {
    binaryPath: join(root, 'rust/target/debug/pet-battle-engine'),
    petAssetsDir: join(__dirname, '../renderer/assets/pets'),
    rules: {
      ...JSON.parse(readFileSync(join(root, 'battle-rules.json'), 'utf8')),
      levelXpCosts: Array.from({ length: OVERLAY_GROWTH_RULES.maxLevel }, (_, i) =>
        OVERLAY_GROWTH_RULES.requiredXp(i + 1),
      ),
    },
  };
  const engines = [];
  t.after(() => {
    engines.forEach((e) => e.close());
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    pets,
    options,
    mountBattle,
    connect() {
      const engine = createBattleRuntime(pets, options);
      engines.push(engine);
      return engine;
    },
  };
}

test('실제 SQLite의 펫룸 선택 → 실행 중 Rust 전투 → 실제 종 이미지 → 재시작 유지', async (t) => {
  const f = await fixture(t);
  const { deriveBattleScene } = await import('@pet/battle');
  const [mole, wizard, squirrel] = f.pets.createOwnedPets(['003', '006', '001']);
  f.pets.updateGrowth(wizard.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  const room = await roomFixture(f.pets);
  room.state.setActivePet(mole.ownedPetId, room.host);
  const engine = f.connect();
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, mole.ownedPetId);
  room.state.setActivePet(wizard.ownedPetId, room.host);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, wizard.ownedPetId);
  assert.equal(result.state.activePet.level, 25);
  assert.equal(result.state.activePet.evolutionStage, 1);
  assert.match(deriveBattleScene(result.state).petAsset, /star_wizard\/stage2\/pet_006_s2_/);
  for (const sprite of Object.values(result.state.petSprites)) {
    for (const sheet of Object.values(sprite)) accessSync(fileURLToPath(sheet.asset));
  }
  await engine.execute({ type: 'CYCLE_PET_ASSET' });
  room.state.setActivePet(squirrel.ownedPetId, room.host);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.rarity, 'EPIC');
  assert.match(deriveBattleScene(result.state).petAsset, /acorn_squirrel\/stage1\/pet_001_s1_/);
  f.db.close();
  f.db.open();
  result = await f.connect().execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, squirrel.ownedPetId);
  assert.equal(f.pets.getOwnedPet(wizard.ownedPetId).totalXp, 384);
  assert.equal(room.saved(), 0);
});

test('공통 미보유 상태는 데모가 아니며 IPC는 전투창만 허용한다', async (t) => {
  const f = await fixture(t);
  const handlers = new Map();
  const close = f.mountBattle(
    f.pets,
    {
      handle: (name, handler) => handlers.set(name, handler),
      removeHandler: (name) => handlers.delete(name),
    },
    { ...f.options, isBattleSender: (id) => id === 7 },
  );
  t.after(close);
  const handler = handlers.get('battle:command');
  assert.throws(() => handler({ sender: { id: 8 } }, { type: 'GET_STATE', nowMs: 0 }), /전투 창/);
  const result = await handler({ sender: { id: 7 } }, { type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet, null);
  assert.deepEqual(result.state.roster, []);
  await assert.rejects(
    handler({ sender: { id: 7 } }, { type: 'GROWTH_XP_ADDED', petId: 'x', amount: 999, nowMs: 0 }),
    /허용하지/,
  );
  close();
  assert.equal(handlers.size, 0);
});
