const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, accessSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fileURLToPath } = require('node:url');
const test = require('node:test');

async function fixture(t, species = ['003', '006']) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { SqliteGrowthReadClient } =
    await import('../dist/main/clients/sqlite-growth-read-client.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { PetGrowthRepository } =
    await import('../dist/main/persistence/repositories/pet-growth-repository.js');
  const { RoomState } = await import('../dist/main/room-state.js');
  const { RoomCollectionPort } = await import('../dist/main/collection.js');
  const { createBattleRuntime, mountBattle } = await import('@pet/battle/node');
  const { PetClientRoomAdapter, RoomSelectionAdapter } = await import('@pet/room');
  const { OVERLAY_GROWTH_RULES } = await import('../dist/main/growth-rules.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-battle-selection-'));
  const db = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  db.open();
  const pets = new SqlitePetClient(new PetRepository(db));
  const owned = pets.createOwnedPets(species);
  if (owned[0]) pets.setActivePet(owned[0].ownedPetId);
  const growthRepository = new PetGrowthRepository(db);
  const host = { showRoom() {}, navigate() {}, broadcast() {} };
  const createRoom = () =>
    new RoomState(
      { now: () => new Date('2026-10-05T12:00:00') },
      new RoomCollectionPort(),
      pets,
      () => growthRepository.growth(),
    );
  let room = createRoom();
  room.applyGrowth(growthRepository.adoptRoster(room.growthSeeds()), host);
  const options = {
    selection: new RoomSelectionAdapter(() => room.scene().pets),
    growth: new SqliteGrowthReadClient(growthRepository),
    petAssetsDir: join(__dirname, '../renderer/assets/pets'),
    levelXpCosts: Array.from({ length: OVERLAY_GROWTH_RULES.maxLevel }, (_, i) =>
      OVERLAY_GROWTH_RULES.requiredXp(i + 1),
    ),
  };
  const engines = [];
  t.after(() => {
    engines.forEach((engine) => engine.close());
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    pets,
    owned,
    growthRepository,
    options,
    host,
    mountBattle,
    get room() {
      return room;
    },
    connect() {
      const engine = createBattleRuntime(new PetClientRoomAdapter(pets), options);
      engines.push(engine);
      return engine;
    },
    saveGrowth(id, values) {
      const profiles = growthRepository.loadAll();
      Object.assign(profiles[id].pet, values);
      growthRepository.saveAll(profiles);
      room.applyGrowth(growthRepository.growth(), host);
    },
    restart() {
      db.close();
      db.open();
      room = createRoom();
    },
  };
}

test('공통 명부가 비어 있으면 펫룸과 전투 모두 비어 있고 데모 개체를 만들지 않는다', async (t) => {
  const f = await fixture(t, []);
  const result = await f.connect().execute({ type: 'GET_STATE', nowMs: 0 });
  assert.deepEqual(f.room.scene().pets, []);
  assert.equal(result.state.activePet, null);
  assert.deepEqual(result.state.roster, []);
  assert.deepEqual(f.pets.listOwnedPets(), []);
});

test('같은 종의 두 개체도 룸의 공통 활성 선택과 개체별 성장만 전투에 연결한다', async (t) => {
  const f = await fixture(t, ['003', '003']);
  const [first, second] = f.owned;
  f.saveGrowth(second.ownedPetId, { totalXp: 1, xpIntoLevel: 1 });
  const engine = f.connect();
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, first.ownedPetId);
  assert.equal(result.state.activePet.syncedTotalXp, 0);
  f.room.setActivePet(second.ownedPetId, f.host);
  const before = f.pets.listOwnedPets();
  result = await engine.execute({ type: 'GET_STATE', nowMs: 1 });
  assert.equal(f.pets.getActivePet().ownedPetId, second.ownedPetId);
  assert.equal(result.state.activePet.petId, second.ownedPetId);
  assert.equal(result.state.activePet.syncedTotalXp, 1);
  assert.equal(result.state.growthStatus, 'LINKED');
  assert.ok(result.state.enemyHpRatio < 1);
  assert.deepEqual(f.pets.listOwnedPets(), before, '전투 조회는 소유자 데이터에 쓰지 않는다');
});

test('열린 전투는 저장 XP와 진화 변경을 반영하고 중복 조회로 XP를 가산하지 않는다', async (t) => {
  const f = await fixture(t);
  const id = f.owned[0].ownedPetId;
  const engine = f.connect();
  await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  f.saveGrowth(id, { totalXp: 1, xpIntoLevel: 1 });
  let result = await engine.execute({ type: 'GET_STATE', nowMs: 1 });
  assert.equal(result.state.activePet.level, 1);
  assert.equal(result.state.activePet.syncedTotalXp, 1);
  assert.ok(result.state.enemyHpRatio < 1);
  assert.equal(result.events.filter((event) => event.type === 'XP_APPLIED').length, 1);
  result = await engine.execute({ type: 'GET_STATE', nowMs: 2 });
  assert.deepEqual(result.events, []);
  f.saveGrowth(id, { level: 25, totalXp: 384, xpIntoLevel: 0, evolutionStage: 1 });
  result = await engine.execute({ type: 'GET_STATE', nowMs: 3 });
  assert.equal(result.state.activePet.evolutionStage, 1);
  const { deriveBattleScene } = await import('@pet/battle');
  assert.match(deriveBattleScene(result.state).petAsset, /mole_digger\/stage2\/pet_003_s2_/);
  for (const sprite of Object.values(result.state.petSprites)) {
    for (const sheet of Object.values(sprite)) accessSync(fileURLToPath(sheet.asset));
  }
  assert.equal(f.pets.getOwnedPet(id).totalXp, 384);
});

test('집계 사용량은 성장 엔진에 한 번 저장되고 전투 HP·다음 적에 반영된다', async (t) => {
  const f = await fixture(t);
  const id = f.owned[0].ownedPetId;
  const { GrowthController } =
    await import('../../../packages/pet-overlay/src/growth/controller.js');
  const engine = f.connect();
  const initial = await engine.execute({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(initial.state.enemyHpRatio, 1);
  const profiles = f.growthRepository.loadAll();
  const profile = profiles[id];
  const growth = new GrowthController(profile.pet, {
    tokenBank: profile.tokenBank,
    lastBaseXp: profile.lastBaseXp,
  });
  const notification = { tokens: 105_000, timestamp: 0, eventId: 'usage:codex:0->105000' };
  assert.equal(growth.applyNow(notification).gained, 21);
  assert.equal(growth.applyNow(notification).gained, 0);
  f.growthRepository.saveAll({ ...profiles, [id]: { ...profile, ...growth.snapshot() } });
  f.room.applyGrowth(f.growthRepository.growth(), f.host);
  const result = await engine.execute({ type: 'GET_STATE', nowMs: 1 });
  assert.equal(result.state.activePet.syncedTotalXp, 21);
  assert.equal(result.state.activePet.stage, 2);
  assert.equal(result.state.overlay?.nextStage, 2);
  assert.ok(result.events.some((event) => event.type === 'ENEMY_DEFEATED'));
  assert.equal(f.pets.getOwnedPet(id).totalXp, 21);
});

test('DB 재연결은 룸 선택·성장·진행도를 복원하고 과거 정복을 재생하지 않는다', async (t) => {
  const f = await fixture(t);
  const wizard = f.owned[1];
  f.saveGrowth(wizard.ownedPetId, { level: 25, totalXp: 384, xpIntoLevel: 0, evolutionStage: 1 });
  f.room.setActivePet(wizard.ownedPetId, f.host);
  const before = await f.connect().execute({ type: 'GET_STATE', nowMs: 0 });
  f.restart();
  const after = await f.connect().execute({ type: 'GET_STATE', nowMs: 1 });
  assert.equal(after.state.activePet.petId, wizard.ownedPetId);
  assert.equal(after.state.activePet.syncedTotalXp, 384);
  assert.equal(after.state.activePet.evolutionStage, 1);
  assert.equal(after.state.activePet.stage, before.state.activePet.stage);
  assert.equal(after.state.enemyHpRatio, before.state.enemyHpRatio);
  assert.ok(!after.events.some((event) => ['XP_APPLIED', 'ENEMY_DEFEATED'].includes(event.type)));
});

test('전투 IPC는 다른 창과 성장 쓰기 명령을 거절하고 저장 데이터를 보존한다', async (t) => {
  const f = await fixture(t);
  const handlers = new Map();
  const close = f.mountBattle(
    new (await import('@pet/room')).PetClientRoomAdapter(f.pets),
    {
      handle: (name, handler) => handlers.set(name, handler),
      removeHandler: (name) => handlers.delete(name),
    },
    { ...f.options, isBattleSender: (id) => id === 7 },
  );
  t.after(close);
  const before = f.pets.listOwnedPets();
  const growthBefore = f.growthRepository.loadAll();
  const handler = handlers.get('battle:command');
  assert.throws(() => handler({ sender: { id: 8 } }, { type: 'GET_STATE', nowMs: 0 }), /전투 창/);
  await assert.rejects(
    handler(
      { sender: { id: 7 } },
      {
        type: 'GROWTH_XP_ADDED',
        petId: f.owned[0].ownedPetId,
        amount: 999,
        nowMs: 0,
      },
    ),
    /허용하지/,
  );
  const result = await handler({ sender: { id: 7 } }, { type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.activePet.petId, f.owned[0].ownedPetId);
  assert.deepEqual(f.pets.listOwnedPets(), before);
  assert.deepEqual(f.growthRepository.loadAll(), growthBefore);
  close();
  assert.equal(handlers.size, 0);
});
