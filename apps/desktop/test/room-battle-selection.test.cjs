const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

async function roomFixture(client) {
  const roomDomain = await import('@pet/room');
  const core = await import('@pet/core');
  const source = readFileSync(join(__dirname, '../src/main/room.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, {
    exports: module.exports,
    console,
    require: (id) => {
      if (id === '@pet/room') return roomDomain;
      if (id === '@pet/core') return core;
      if (id === 'electron') return { ipcMain: { handle() {} } };
      throw new Error(`unexpected import ${id}`);
    },
  });
  const events = [];
  let saves = 0;
  const state = new module.exports.RoomState(
    {
      load() {},
      save() {
        saves++;
      },
    },
    { now: () => new Date('2026-09-28T12:00:00') },
    { update() {} },
    roomDomain.seedCollection(),
    client,
  );
  return {
    state,
    events,
    saved: () => saves,
    host: { showRoom() {}, broadcast: (...args) => events.push(args) },
  };
}

function clientFixture() {
  const pets = ['003', '006', '006'].map((speciesId, i) => ({
    ownedPetId: `owned-${i}`,
    speciesId,
    name: i ? '별빛마법사' : '두더지',
    nickname: i === 2 ? '둘째' : null,
    rarity: i ? 'EPIC' : 'COMMON',
    sprite: i ? 'star_wizard' : 'mole_digger',
    level: 25,
    totalXp: 384,
    xpIntoLevel: 0,
    evolutionStage: i ? 1 : 0,
    isActive: i === 0,
  }));
  return {
    listOwnedPets: () => pets.map((p) => ({ ...p })),
    getActivePet: () => pets.find((p) => p.isActive) ?? null,
    setActivePet(id) {
      const selected = pets.find((p) => p.ownedPetId === id);
      if (!selected) throw new Error('unknown owned pet');
      pets.forEach((p) => {
        p.isActive = p === selected;
      });
      return { ...selected };
    },
  };
}

test('펫룸은 공통 개체 ID·저장된 진화 단계를 표시하고 선택을 PetClient에 저장한다', async () => {
  const client = clientFixture();
  const f = await roomFixture(client);
  assert.deepEqual(
    Array.from(f.state.scene().pets, (p) => p.ownedPetId),
    ['owned-0', 'owned-1', 'owned-2'],
  );
  const active = f.state.setActivePet('owned-2', f.host);
  assert.equal(active.ownedPetId, client.getActivePet().ownedPetId);
  assert.equal(active.name, '둘째');
  assert.equal(active.stage, 2);
  assert.equal(f.events.length, 1);
  assert.equal(f.saved(), 0);
  assert.equal(client.getActivePet().totalXp, 384);
  assert.equal(f.state.scene().pets.filter((p) => p.isActive).length, 1);
  assert.throws(() => f.state.setActivePet('seed-006', f.host), /unknown owned pet/);
  assert.equal(f.events.length, 1);
  assert.equal((await roomFixture(client)).state.activeView().ownedPetId, 'owned-2');
});

test('공통 명부가 비면 시드로 대체하지 않고 조회 오류도 숨기지 않는다', async () => {
  const client = { ...clientFixture(), listOwnedPets: () => [], getActivePet: () => null };
  const f = await roomFixture(client);
  assert.equal(f.state.scene().pets.length, 0);
  client.listOwnedPets = () => {
    throw new Error('read failed');
  };
  assert.throws(() => f.state.scene(), /read failed/);
});

test('전체 앱은 공통 클라이언트를 전투에 주입하고 preload로 명령을 전달한다', () => {
  const main = readFileSync(join(__dirname, '../src/main/main.ts'), 'utf8');
  const preload = readFileSync(join(__dirname, '../src/preload/preload.cjs'), 'utf8');
  assert.match(main, /mountBattle\(pets/);
  assert.match(main, /new RoomState\(roomStore, systemClock, collection, ownedPets, pets\)/);
  assert.match(preload, /exposeInMainWorld\('petBattle'/);
});

module.exports = { roomFixture };
