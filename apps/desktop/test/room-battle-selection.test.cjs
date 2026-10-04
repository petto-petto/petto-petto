const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function loadHostModule(filename, imports) {
  const source = readFileSync(join(__dirname, '../src/main', filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, {
    exports: module.exports,
    console,
    require: (id) => {
      if (id in imports) return imports[id];
      throw new Error(`unexpected import ${id}`);
    },
  });
  return module.exports;
}

async function roomFixture(snapshot) {
  const roomDomain = await import('@pet/room');
  const core = await import('@pet/core');
  const { metaHandlers } = await import('@pet/meta');
  const handlers = new Map();
  const imports = {
    '@pet/room': roomDomain,
    '@pet/core': core,
    electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } },
  };
  const { RoomState, mountRoom } = loadHostModule('room.ts', imports);
  const { RoomCollectionPort } = loadHostModule('collection.ts', imports);
  const ownedPets = roomDomain.fromSnapshot(snapshot);
  const collection = new RoomCollectionPort(ownedPets);
  const events = [];
  const snapshots = [];
  let now = new Date('2026-09-28T12:00:00');
  const state = new RoomState(
    {
      load() {
        return snapshot;
      },
      save(value) {
        snapshots.push(value);
      },
    },
    { now: () => now },
    collection,
    ownedPets,
  );
  const host = { showRoom() {}, broadcast: (...args) => events.push(args) };
  mountRoom(state, host);
  const legacyHandlers = metaHandlers({ collection }, {});
  return {
    state,
    collection,
    events,
    handlers,
    snapshots,
    saved: () => snapshots.length,
    setNow: (value) => {
      now = value;
    },
    overlay: () => legacyHandlers['pet:overlay'](),
    host,
  };
}

test('펫룸은 기존 JSON 선택을 저장하고 legacy 조회와 트로피를 유지한다', async () => {
  const f = await roomFixture();
  assert.equal(f.state.scene().pets.length, 6);
  assert.equal(f.state.activeView().ownedPetId, 'seed-006');
  const selected = f.state.setActivePet('seed-001', f.host);
  assert.equal(f.state.activeView().ownedPetId, 'seed-001');
  assert.equal(f.overlay().petId, '003');
  assert.equal(f.snapshots[0].activePetId, 'seed-001');
  assert.equal(f.saved(), 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0][0], 'room:activePetChanged');
  assert.equal(f.events[0][1], selected);
  assert.equal(f.collection.grantTrophy('a', false), 'storage');
  assert.equal(f.collection.grantTrophy('b', true), 'room');
  assert.equal(f.collection.grantTrophy('c', true), 'storage');

  const restarted = await roomFixture(f.snapshots[0]);
  assert.equal(restarted.state.activeView().ownedPetId, 'seed-001');
  assert.equal(restarted.overlay().petId, '003');
});

test('room IPC rejects invalid identities without writes and repeated selection still broadcasts', async () => {
  const f = await roomFixture();
  const select = f.handlers.get('room:setActivePet');
  for (const invalid of [null, undefined, '', 1]) {
    assert.throws(() => select({}, invalid), /펫 식별자가 올바르지 않습니다/);
  }
  assert.throws(() => select({}, 'unknown-owned-pet'));
  assert.equal(f.events.length, 0);
  assert.equal(f.saved(), 0);
  assert.equal(f.state.activeView().ownedPetId, 'seed-006');
  select({}, 'seed-001');
  select({}, 'seed-001');
  assert.equal(f.events.length, 2);
  assert.equal(f.saved(), 2);
  assert.equal(f.overlay().petId, '003');
});

test('room background refresh does not write pet selection', async () => {
  const f = await roomFixture();
  f.state.refreshBackground(f.host);
  assert.equal(f.events.length, 0);
  f.setNow(new Date('2026-09-28T19:00:00'));
  f.state.refreshBackground(f.host);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0][0], 'room:backgroundChanged');
  assert.equal(f.saved(), 0);
  assert.equal(f.state.activeView().ownedPetId, 'seed-006');
});

test('앱은 조회 Adapter를 전투에만 주입하고 기존 펫룸 저장 경로를 변경하지 않는다', () => {
  const main = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8');
  assert.match(main, /new RoomCollectionPort\(ownedPets\)/);
  assert.match(main, /new RoomState\(roomStore, systemClock, collection, ownedPets\)/);
  assert.match(main, /mountBattle\(new PetClientRoomAdapter\(pets\), ipcMain/);
  for (const file of ['room.ts', 'collection.ts']) {
    assert.doesNotMatch(
      readFileSync(join(__dirname, '../src/main', file), 'utf8'),
      /RoomPetClient|selectActivePet|@pet\/client/,
    );
  }
});

module.exports = { roomFixture };
