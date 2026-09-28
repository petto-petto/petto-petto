const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const test = require('node:test');

async function setup(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { RoomPetBridge } = await import('../dist/main/room-pet-bridge.js');
  const { seedCollection } = await import('@pet/room');
  const directory = mkdtempSync(join(tmpdir(), 'petto-room-battle-'));
  const db = new SqliteFileDatabase({filePath:join(directory,'test.sqlite'),migrations:APP_MIGRATIONS});
  db.open();
  t.after(() => {db.close(); rmSync(directory, {recursive:true,force:true});});
  const pets = new SqlitePetClient(new PetRepository(db));
  const bridge = new RoomPetBridge(db, pets);
  return {db, pets, bridge, legacy:seedCollection()};
}

test('펫룸 활성화 버튼 경로가 공통 활성 펫과 실제 Rust 전투를 함께 바꾼다', async (t) => {
  const {pets,bridge,legacy} = await setup(t);
  const {RoomState} = await import('../dist/main/room-state.js');
  const {RoomCollectionPort} = await import('../dist/main/collection.js');
  const {systemClock} = await import('@pet/core');
  const {spawnBattleSidecar,OwnedPetBattleGateway} = await import('@pet/battle');
  const {requiredXp,LEVEL_MAX} = await import('@pet/main-overlay/growth');
  const collection = bridge.initialize(legacy);
  const room = new RoomState({load:() => undefined,save:() => {}},systemClock,new RoomCollectionPort(collection),collection,bridge);
  const root = dirname(require.resolve('@pet/battle/package.json'));
  const engine = spawnBattleSidecar(join(root,'rust/target/debug',process.platform === 'win32' ? 'pet-battle-engine.exe' : 'pet-battle-engine'));
  t.after(() => {engine.client.dispose(); engine.sidecar.close();});
  const gateway = new OwnedPetBattleGateway(pets,engine.client,{
    levelXpCosts:Array.from({length:LEVEL_MAX},(_,i) => requiredXp(i+1)),
    intervalLevels:JSON.parse(readFileSync(join(root,'battle-rules.json'),'utf8')).intervalLevels,
  });
  const broadcasts = [];
  for (const selected of room.scene().pets.slice(0,2)) {
    const active = room.setActivePet(selected.ownedPetId,{showRoom(){},broadcast(channel,payload){broadcasts.push([channel,payload]);}});
    const result = await gateway.execute({type:'GET_STATE',nowMs:0});
    assert.equal(result.state.activePet?.petId, selected.ownedPetId);
    assert.equal(result.state.activePet?.level, selected.level);
    assert.equal(result.state.activePet?.sprite, selected.slug);
    assert.equal(pets.getActivePet().ownedPetId, selected.ownedPetId);
    assert.deepEqual(broadcasts.at(-1), ['room:activePetChanged',active]);
  }
});

test('기존 명부의 레벨·별명·활성을 보존하며 재시작해도 중복 생성·XP 덮어쓰기를 하지 않는다', async(t) => {
  const {db,pets,bridge,legacy} = await setup(t);
  legacy.pets[0].nickname = '테스트 펫';
  const first = bridge.initialize(legacy);
  assert.equal(pets.countOwnedPets(),6);
  assert.equal(pets.getActivePet().speciesId,'006');
  const chosen = first.pets.find(p => p.nickname === '테스트 펫');
  pets.updateGrowth(chosen.id,{level:13,totalXp:156,xpIntoLevel:0,evolutionStage:1});
  bridge.select(chosen.id);
  db.close(); db.open();
  const restarted = bridge.initialize(legacy);
  assert.equal(pets.countOwnedPets(),6);
  assert.equal(restarted.activePetId,chosen.id);
  assert.equal(pets.getActivePet().totalXp,156);
  assert.equal(restarted.pets.find(p => p.id === chosen.id).level,13);
  assert.throws(() => bridge.select('missing'));
  assert.equal(pets.getActivePet().ownedPetId,chosen.id);
});

test('이관 실패는 개체와 연결 기록을 함께 취소하며 같은 종 두 개체는 합치지 않는다', async(t) => {
  const {pets,bridge,legacy} = await setup(t);
  const invalid = structuredClone(legacy);
  invalid.pets[1].speciesPetId = 'missing';
  assert.throws(() => bridge.initialize(invalid));
  assert.equal(pets.countOwnedPets(),0);
  legacy.pets[1].speciesPetId = legacy.pets[0].speciesPetId;
  bridge.initialize(legacy);
  assert.equal(pets.countOwnedPets(),6);
  assert.equal(pets.listOwnedPets('003').length,2);
});

test('실제 앱 조립도 공통 명부를 펫룸에 전달한다', () => {
  const main = readFileSync(join(__dirname,'../src/main/main.ts'),'utf8');
  assert.match(main, /new RoomPetBridge\(appDatabase, pets\)/);
  assert.match(main, /roomPets\.initialize\(loadRoomCollection\(roomStore\)\)/);
  assert.match(main, /new RoomState\(roomStore, systemClock, collection, ownedPets, roomPets\)/);
});
