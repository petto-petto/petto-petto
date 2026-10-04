const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, accessSync } = require('node:fs');
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
  const { createBattleRuntime, mountBattle } = await import('@pet/battle/node');
  const { PetClientRoomAdapter } = await import('@pet/room');
  const { OVERLAY_GROWTH_RULES } = await import('../dist/main/growth-rules.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-battle-selection-'));
  const db = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  db.open();
  const pets = new SqlitePetClient(new PetRepository(db));
  const roomPets = new PetClientRoomAdapter(pets);
  const options = {
    petAssetsDir: join(__dirname, '../renderer/assets/pets'),
    levelXpCosts: Array.from({ length: OVERLAY_GROWTH_RULES.maxLevel }, (_, i) =>
      OVERLAY_GROWTH_RULES.requiredXp(i + 1),
    ),
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
    roomPets,
    options,
    mountBattle,
    connect(selection) {
      const engine = createBattleRuntime(roomPets, { ...options, selection });
      engines.push(engine);
      return engine;
    },
  };
}

test('공통 SQLite 소유자 선택 → 읽기 Adapter → Rust 전투 이미지와 재시작 유지', async (t) => {
  const f = await fixture(t);
  const { deriveBattleScene } = await import('@pet/battle');
  const [mole, wizard, squirrel] = f.pets.createOwnedPets(['003', '006', '001']);
  f.pets.updateGrowth(wizard.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  f.pets.setActivePet(mole.ownedPetId);
  const engine = f.connect();
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, mole.ownedPetId);
  f.pets.setActivePet(wizard.ownedPetId);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, wizard.ownedPetId);
  assert.equal(result.state.activePet.level, 25);
  assert.equal(result.state.activePet.evolutionStage, 1);
  assert.match(deriveBattleScene(result.state).petAsset, /star_wizard\/stage2\/pet_006_s2_/);
  for (const sprite of Object.values(result.state.petSprites)) {
    for (const sheet of Object.values(sprite)) accessSync(fileURLToPath(sheet.asset));
  }
  await engine.execute({ type: 'CYCLE_PET_ASSET' });
  f.pets.setActivePet(squirrel.ownedPetId);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.rarity, 'EPIC');
  assert.match(deriveBattleScene(result.state).petAsset, /acorn_squirrel\/stage1\/pet_001_s1_/);
  f.db.close();
  f.db.open();
  result = await f.connect().execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, squirrel.ownedPetId);
  assert.equal(f.pets.getOwnedPet(wizard.ownedPetId).totalXp, 384);
});

test('읽기 Adapter는 같은 종의 선택·저장 XP를 실제 Rust에 전달하고 소유 데이터에 쓰지 않는다', async (t) => {
  const f = await fixture(t);
  const [first, second] = f.pets.createOwnedPets(['003', '003']);
  f.pets.setActivePet(second.ownedPetId);
  const engine = f.connect();
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, second.ownedPetId);
  assert.equal(result.state.enemyHpRatio, 1);

  f.pets.updateGrowth(second.ownedPetId, {
    level: 1,
    totalXp: 1,
    xpIntoLevel: 1,
    evolutionStage: 0,
  });
  const saved = f.pets.listOwnedPets();
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.syncedTotalXp, 1);
  assert.ok(result.state.enemyHpRatio < 1);
  assert.equal(result.events.filter((event) => event.type === 'XP_APPLIED').length, 1);
  assert.deepEqual(f.pets.listOwnedPets(), saved);

  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.deepEqual(result.events, []);
  f.pets.setActivePet(first.ownedPetId);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, first.ownedPetId);
  assert.equal(result.state.activePet.syncedTotalXp, 0);
  assert.equal(result.state.enemyHpRatio, 1);
  assert.equal(f.pets.getOwnedPet(second.ownedPetId).totalXp, 1);
});

test('[selection 미주입] 레거시 펫룸 JSON 선택은 공통 활성 개체·명부·XP와 실행 중 전투를 바꾸지 않는다', async (t) => {
  const f = await fixture(t);
  const [, wizard] = f.pets.createOwnedPets(['003', '006']);
  f.pets.updateGrowth(wizard.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  f.pets.setActivePet(wizard.ownedPetId);
  const ownerBefore = f.pets.listOwnedPets();
  const activeBefore = f.pets.getActivePet();
  const engine = f.connect();
  const battleBefore = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  const room = await roomFixture();

  room.state.setActivePet('seed-001', room.host);

  assert.equal(room.state.activeView().ownedPetId, 'seed-001');
  assert.equal(room.snapshots[0].activePetId, 'seed-001');
  assert.equal(room.saved(), 1, 'only the legacy JSON selection is saved');
  assert.deepEqual(f.pets.getActivePet(), activeBefore);
  assert.deepEqual(f.pets.listOwnedPets(), ownerBefore);
  assert.deepEqual(f.roomPets.getActivePet(), activeBefore);
  const battleAfter = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(battleAfter.state.activePet.petId, wizard.ownedPetId);
  assert.equal(battleAfter.state.activePet.syncedTotalXp, 384);
  assert.deepEqual(battleAfter.state.roster, battleBefore.state.roster);
  assert.equal(battleAfter.state.enemyHpRatio, battleBefore.state.enemyHpRatio);
  assert.deepEqual(battleAfter.events, []);
  assert.deepEqual(f.pets.listOwnedPets(), ownerBefore);
});

test('[selection 미주입] 공통 명부가 비어 있으면 레거시 JSON 펫을 선택해도 전투는 빈 상태를 유지한다', async (t) => {
  const f = await fixture(t);
  const room = await roomFixture();
  const engine = f.connect();
  const before = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(before.state.activePet, null);
  assert.deepEqual(before.state.roster, []);

  room.state.setActivePet('seed-001', room.host);

  assert.equal(room.state.activeView().ownedPetId, 'seed-001');
  assert.equal(room.snapshots[0].activePetId, 'seed-001');
  assert.equal(room.saved(), 1);
  assert.equal(f.pets.getActivePet(), null);
  assert.deepEqual(f.pets.listOwnedPets(), []);
  const after = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(after.state.activePet, null);
  assert.deepEqual(after.state.roster, []);
  assert.deepEqual(after.events, []);
  assert.equal(f.pets.countOwnedPets(), 0);
});

test('공통 미보유 상태는 데모가 아니며 IPC는 전투창만 허용한다', async (t) => {
  const f = await fixture(t);
  const handlers = new Map();
  const close = f.mountBattle(
    f.roomPets,
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

test('JSON 룸 선택 Client는 열린 Rust 전투와 재연결에 실제 선택 외형을 전달하고 공통 저장을 바꾸지 않는다', async (t) => {
  const f = await fixture(t);
  const { RoomSelectionAdapter } = await import('@pet/room');
  const { deriveBattleScene } = await import('@pet/battle');
  const [sharedWizard] = f.pets.createOwnedPets(['006']);
  f.pets.updateGrowth(sharedWizard.ownedPetId, {
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: 1,
  });
  f.pets.setActivePet(sharedWizard.ownedPetId);
  const ownerBefore = f.pets.listOwnedPets();
  const room = await roomFixture();
  const selection = new RoomSelectionAdapter(() => room.state.scene().pets);
  const engine = f.connect(selection);
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, 'seed-006');
  assert.equal(result.state.growthStatus, 'UNLINKED');
  assert.equal(room.saved(), 0, 'reading battle must not persist room selection');

  room.handlers.get('room:setActivePet')({}, 'seed-001');
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, 'seed-001');
  assert.equal(result.state.activePet.displayName, '두더지');
  assert.equal(result.state.activePet.level, 3);
  assert.equal(result.state.activePet.evolutionStage, 0);
  assert.equal(result.state.growthStatus, 'UNLINKED');
  assert.match(deriveBattleScene(result.state).petAsset, /mole_digger\/stage1\/pet_003_s1_/);

  room.handlers.get('room:setActivePet')({}, 'seed-006');
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, 'seed-006');
  assert.equal(result.state.activePet.level, 25);
  assert.equal(result.state.activePet.evolutionStage, 2);
  assert.equal(result.state.growthStatus, 'UNLINKED');
  assert.match(deriveBattleScene(result.state).petAsset, /star_wizard\/stage3\/pet_006_s3_/);
  for (const sprite of Object.values(result.state.petSprites)) {
    for (const sheet of Object.values(sprite)) accessSync(fileURLToPath(sheet.asset));
  }
  const beforeMotion = {
    stage: result.state.activePet.stage,
    hp: result.state.enemyHpRatio,
  };
  for (const command of [
    { type: 'SET_BATTLE_RUNNING', running: true },
    { type: 'PREVIEW_PET', action: 'ATTACK', nowMs: 0 },
    { type: 'GET_STATE', nowMs: 0 },
  ]) {
    result = await engine.execute(command);
    assert.equal(result.state.activePet.stage, beforeMotion.stage);
    assert.equal(result.state.enemyHpRatio, beforeMotion.hp);
    assert.equal(
      result.events.some((event) => ['XP_APPLIED', 'ENEMY_DEFEATED'].includes(event.type)),
      false,
    );
  }
  assert.deepEqual(f.pets.listOwnedPets(), ownerBefore);
  assert.equal(f.pets.getActivePet().ownedPetId, sharedWizard.ownedPetId);
  assert.equal(room.saved(), 2, 'only two explicit room selections persist JSON');
  const restartedRoom = await roomFixture(room.snapshots.at(-1));
  const restarted = await f
    .connect(new RoomSelectionAdapter(() => restartedRoom.state.scene().pets))
    .execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(restarted.state.activePet.petId, 'seed-006');
  assert.equal(restarted.state.growthStatus, 'UNLINKED');
  assert.deepEqual(f.pets.listOwnedPets(), ownerBefore);
});

test('공통 보유 명부가 비어도 JSON 룸 선택 펫은 실제 Rust 외형으로 표시한다', async (t) => {
  const f = await fixture(t);
  const { RoomSelectionAdapter } = await import('@pet/room');
  const { deriveBattleScene } = await import('@pet/battle');
  const room = await roomFixture();
  const engine = f.connect(new RoomSelectionAdapter(() => room.state.scene().pets));
  const before = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(before.state.activePet.petId, 'seed-006');
  assert.equal(before.state.growthStatus, 'UNLINKED');
  assert.equal(before.state.roster.length, 6);

  room.handlers.get('room:setActivePet')({}, 'seed-001');
  const after = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(after.state.activePet.petId, 'seed-001');
  assert.equal(after.state.growthStatus, 'UNLINKED');
  assert.match(deriveBattleScene(after.state).petAsset, /mole_digger\/stage1\/pet_003_s1_/);
  assert.equal(f.pets.getActivePet(), null);
  assert.deepEqual(f.pets.listOwnedPets(), []);
  assert.equal(room.saved(), 1);
});

test('정확히 같은 룸 개체만 공통 저장 XP를 연결하고 같은 종의 다른 활성 개체는 선택하지 않는다', async (t) => {
  const f = await fixture(t);
  const { RoomSelectionAdapter } = await import('@pet/room');
  const [first, second] = f.pets.createOwnedPets(['003', '003']);
  f.pets.setActivePet(first.ownedPetId);
  const room = await roomFixture({
    version: 1,
    pets: [first, second].map((pet) => ({
      id: pet.ownedPetId,
      speciesPetId: pet.speciesId,
      level: 25,
    })),
    activePetId: first.ownedPetId,
  });
  const engine = f.connect(new RoomSelectionAdapter(() => room.state.scene().pets));
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, first.ownedPetId);
  assert.equal(result.state.growthStatus, 'LINKED');
  room.handlers.get('room:setActivePet')({}, second.ownedPetId);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, second.ownedPetId);
  assert.equal(result.state.activePet.level, 1, 'linked growth comes from the full common record');
  assert.equal(result.state.activePet.evolutionStage, 0);
  assert.equal(result.state.enemyHpRatio, 1);
  assert.equal(f.pets.getActivePet().ownedPetId, first.ownedPetId);

  f.pets.updateGrowth(second.ownedPetId, {
    level: 1,
    totalXp: 1,
    xpIntoLevel: 1,
    evolutionStage: 0,
  });
  const saved = f.pets.listOwnedPets();
  result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, second.ownedPetId);
  assert.equal(result.state.activePet.syncedTotalXp, 1);
  assert.equal(result.state.growthStatus, 'LINKED');
  assert.ok(result.state.enemyHpRatio < 1);
  assert.equal(result.events.filter((event) => event.type === 'XP_APPLIED').length, 1);
  assert.deepEqual(f.pets.listOwnedPets(), saved);
  assert.equal(room.saved(), 1);
});
