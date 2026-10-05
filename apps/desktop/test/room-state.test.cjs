const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

/** 실제 SQLite 위의 `PetClient`와, 성장 저장소 대역(맵)으로 `RoomState`를 세운다. */
async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { RoomCollectionPort } = await import('../dist/main/collection.js');
  const { RoomState } = await import('../dist/main/room-state.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-room-state-'));
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.open();
  const pets = new SqlitePetClient(new PetRepository(database));
  const growth = new Map();
  const broadcasts = [];
  const host = {
    showRoom() {},
    navigate() {},
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  };
  const clock = { now: () => new Date('2026-10-04T12:00:00') };
  const createRoom = () => new RoomState(clock, new RoomCollectionPort(), pets, () => growth);
  return { pets, growth, host, broadcasts, createRoom };
}

test('보유 펫이 없으면 빈 펫룸이고 활성 펫도 없다', async (t) => {
  const { createRoom } = await fixture(t);
  const room = createRoom();
  assert.deepEqual(room.scene().pets, []);
  assert.equal(room.activeView(), null);
});

test('활성 펫이 없으면 첫 마리를 세우고 PetClient 에도 저장한다', async (t) => {
  const { pets, createRoom } = await fixture(t);
  pets.createOwnedPets(['003', '006']);
  // 목록은 개체 id 순이다. 생성 순서가 아니라 그 목록의 첫 마리가 활성이 된다.
  const [first] = pets.listOwnedPets();
  const room = createRoom();
  assert.equal(room.activeView()?.ownedPetId, first.ownedPetId);
  assert.equal(pets.getActivePet()?.ownedPetId, first.ownedPetId);
});

test('활성 펫을 바꿔도 성장 저장소의 레벨·진화 단계가 유지된다', async (t) => {
  const { pets, growth, host, broadcasts, createRoom } = await fixture(t);
  const [mole, wizard] = pets.createOwnedPets(['003', '006']);
  growth.set(wizard.ownedPetId, { level: 40, evolutionStage: 2 });
  const room = createRoom();

  const active = room.setActivePet(wizard.ownedPetId, host);

  // `owned_pets`의 level 칸은 1 그대로다. 명부를 다시 읽을 때 성장을 투영하지 않으면 여기서
  // Lv.1·1단계가 나와, 펫룸이 진화한 펫을 1단계 그림으로 다시 읽는다.
  assert.equal(active?.level, 40);
  assert.equal(active?.stage, 3);
  assert.equal(broadcasts.at(-1)?.payload.level, 40);
  assert.equal(
    room.scene().pets.find((view) => view.ownedPetId === mole.ownedPetId)?.isActive,
    false,
  );
});

test('보유 펫이 바뀌면 열린 창에 새 명부를 알린다 — 합성으로 지워진 펫이 남지 않는다', async (t) => {
  const { pets, host, broadcasts, createRoom } = await fixture(t);
  pets.createOwnedPets(['003', '003']);
  const room = createRoom();
  // 활성 펫은 합성 재료가 될 수 없다. 자동으로 세워진 활성 펫이 아닌 쪽을 재료로 쓴다.
  const activeId = room.activeView()?.ownedPetId;
  const material = pets.listOwnedPets().find((pet) => pet.ownedPetId !== activeId);
  const result = pets.replaceOwnedPets([material.ownedPetId], '004');

  room.reload(host);

  const roster = broadcasts.find((entry) => entry.channel === 'room:rosterChanged');
  assert.deepEqual(
    roster?.payload.map((view) => view.ownedPetId).sort(),
    [activeId, result.ownedPetId].sort(),
  );
});
