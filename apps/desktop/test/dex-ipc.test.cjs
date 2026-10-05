const assert = require('node:assert/strict');
const test = require('node:test');

/** 채널 이름 → 핸들러. `ipcMain.handle` 대역이다. */
function fakeIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

const DEX_EVENT = { sender: 'dex' };
const ROOM_EVENT = { sender: 'room' };
const OTHER_EVENT = { sender: 'other' };

async function setup({ owned = [], entries = [] } = {}) {
  const { registerDexIpc } = await import('../dist/main/ipc/dex.js');
  const ipc = fakeIpc();
  const calls = { seen: [], room: [], gacha: 0 };
  const pets = {
    listDexEntries: () => entries,
    markDexSeen: (speciesId) => calls.seen.push(speciesId),
    listOwnedPets: (speciesId) => owned.filter((pet) => pet.speciesId === speciesId),
  };
  registerDexIpc(
    ipc,
    pets,
    (event) => event.sender === 'dex',
    (event) => event.sender === 'room',
    {
      openInRoom: (_event, ownedPetId) => calls.room.push(ownedPetId),
      goGacha: () => {
        calls.gacha += 1;
      },
    },
  );
  const call = (channel, event, ...args) => ipc.handlers.get(channel)(event, ...args);
  return { call, calls };
}

const species = { speciesId: '003', name: '두더지', rarity: 'COMMON', sprite: 'mole_digger' };
const entry = (patch) => ({
  species,
  discoveredAt: null,
  ownedCount: 0,
  highestLevel: 0,
  highestStage: null,
  isNew: false,
  ...patch,
});

test('도감 채널은 도감 창이 아닌 요청을 거부하고 아무것도 바꾸지 않는다', async () => {
  const { call, calls } = await setup({ entries: [entry()] });
  for (const [channel, args] of [
    ['dex:load', []],
    ['dex:markSeen', ['003']],
    ['dex:openInRoom', ['003']],
  ]) {
    assert.equal((await call(channel, OTHER_EVENT, ...args)).ok, false);
  }
  await call('dex:goGacha', OTHER_EVENT);
  assert.deepEqual(calls, { seen: [], room: [], gacha: 0 });
});

test('도감 화면 모델은 에셋 경로·뽑기 확률을 실어 돌려준다', async () => {
  const { call } = await setup({ entries: [entry()] });
  const response = await call('dex:load', DEX_EVENT);
  assert.equal(response.ok, true);
  const slot = response.value.sections[0].slots[0];
  assert.equal(slot.name, '???');
  assert.equal(slot.sprite.card, 'pets/common/mole_digger/stage1/pet_003_s1_card.png');
  assert.equal(slot.hints[0], '✨ 펫 뽑기에서 만날 수 있어요 · COMMON 80%');
});

test('잘못된 종 ID 와 보유 개체가 없는 종의 펫룸 이동은 거부한다', async () => {
  const { call, calls } = await setup();
  assert.equal((await call('dex:markSeen', DEX_EVENT, '')).ok, false);
  assert.equal((await call('dex:markSeen', DEX_EVENT, 3)).ok, false);
  assert.equal((await call('dex:openInRoom', DEX_EVENT, '003')).ok, false);
  assert.deepEqual(calls.room, []);
});

test('펫룸에서 보기는 활성 개체를 우선해 펫룸에 넘긴다', async () => {
  const { call, calls } = await setup({
    owned: [
      { ownedPetId: 'a', speciesId: '003', isActive: false, level: 9 },
      { ownedPetId: 'b', speciesId: '003', isActive: true, level: 1 },
    ],
  });
  assert.equal((await call('dex:openInRoom', DEX_EVENT, '003')).ok, true);
  assert.deepEqual(calls.room, ['b']);
  assert.equal((await call('dex:markSeen', DEX_EVENT, '003')).ok, true);
  assert.deepEqual(calls.seen, ['003']);
});

test('NEW 표식은 펫룸 창에만 답하고 화면 모델과 같은 판정을 쓴다', async () => {
  const fresh = await setup({
    entries: [
      entry({
        discoveredAt: '2026-10-05T00:00:00.000Z',
        ownedCount: 1,
        highestStage: 0,
        isNew: true,
      }),
    ],
  });
  assert.equal(fresh.call('dex:hasNew', ROOM_EVENT), true);
  assert.throws(() => fresh.call('dex:hasNew', OTHER_EVENT));
  const none = await setup({ entries: [entry()] });
  assert.equal(none.call('dex:hasNew', ROOM_EVENT), false);
});
