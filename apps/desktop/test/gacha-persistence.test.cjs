const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const { createPersistentGacha } = await import('@pet/gacha');
  const directory = mkdtempSync(join(tmpdir(), 'petto-gacha-'));
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.open();
  const client = new SqlitePetClient(new PetRepository(database));
  const currency = new SqliteTokenClient(
    new TokenRepository(database),
    new CurrencyRepository(database),
  );
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const gacha = createPersistentGacha(
    client,
    currency,
    (work) => database.transaction(work),
    () => 0,
  );
  return { database, client, currency, gacha };
}

test('뽑기 후보와 확률표 목록은 PetClient의 최신 카탈로그를 사용한다', async (t) => {
  const { database, gacha } = await fixture(t);
  database
    .prepare("UPDATE pet_species SET name = ? WHERE species_id = '003'")
    .run('DB에서 읽은 두더지');
  const snapshot = gacha.load();
  assert.equal(snapshot.pets.common[0].name, 'DB에서 읽은 두더지');
  assert.equal(snapshot.pets.common.length, 2);
  assert.equal(snapshot.ownedCount, 0);
  assert.equal(gacha.draw(1).results[0].pet.name, 'DB에서 읽은 두더지');
});

test('1회와 10회 뽑기는 11개의 개체로 저장되고 DB 재연결 후에도 남는다', async (t) => {
  const { database, client, gacha } = await fixture(t);
  const single = gacha.draw(1);
  const ten = gacha.draw(10);
  assert.equal(single.results.length, 1);
  assert.equal(ten.results.length, 10);
  assert.equal(ten.results[9].grade, 'rare');
  assert.equal(ten.ownedCount, 11);
  assert.equal(ten.totalDrawCount, 11);
  assert.equal(new Set([...single.ownedPetIds, ...ten.ownedPetIds]).size, 11);
  database.close();
  database.open();
  assert.equal(client.countOwnedPets(), 11);
  for (const id of ten.ownedPetIds) assert.equal(client.getOwnedPet(id).level, 1);
  assert.equal(gacha.load().ownedCount, 11);
});

test('저장 실패 시 뽑기 상태도 전진하지 않으며 재시도하면 한 번만 반영된다', async (t) => {
  const { database, client, gacha } = await fixture(t);
  database.exec(`CREATE TRIGGER fail_draw BEFORE INSERT ON owned_pets
    WHEN NEW.species_id = '002' BEGIN SELECT RAISE(ABORT, 'save failed'); END`);
  assert.throws(() => gacha.draw(10), /save failed/);
  assert.equal(client.countOwnedPets(), 0);
  assert.equal(gacha.load().pityCounter, 0);
  assert.equal(gacha.load().totalDrawCount, 0);
  database.exec('DROP TRIGGER fail_draw');
  assert.equal(gacha.draw(10).totalDrawCount, 10);
  assert.equal(client.countOwnedPets(), 10);
});

test('잘못된 횟수·빈 후보·조회 실패는 저장 없이 오류를 반환한다', async (t) => {
  const { database, client, gacha } = await fixture(t);
  for (const count of [0, 2, 11, '10', null]) assert.throws(() => gacha.draw(count));
  database.exec("DELETE FROM pet_species WHERE rarity = 'EPIC'");
  assert.throws(() => gacha.load());
  assert.throws(() => gacha.draw(1));
  assert.equal(client.countOwnedPets(), 0);
  database.close();
  assert.throws(() => gacha.load());
});

async function uiHarness(t, { failLoad = false, failDraw = false } = {}) {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const { client, database, gacha } = await fixture(t);
  const { registerGachaIpc } = await import('../dist/main/ipc/gacha.js');
  const handlers = new Map();
  const allowed = {};
  registerGachaIpc(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    gacha,
    (event) => event === allowed,
  );
  let bridge;
  let loadFails = failLoad;
  let drawFails = failDraw;
  let draws = 0;
  const invoke = async (channel, ...args) => {
    if (channel === 'gacha:load' && loadFails) {
      loadFails = false;
      return { ok: false, message: '목록 조회 실패' };
    }
    if (channel === 'gacha:draw') {
      draws++;
      if (drawFails) {
        drawFails = false;
        return { ok: false, message: '저장 실패' };
      }
    }
    return handlers.get(channel)(allowed, ...args);
  };
  vm.runInNewContext(readFileSync(join(__dirname, '../src/preload/gacha.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, value) => {
          bridge = value;
        },
      },
      ipcRenderer: { invoke },
    }),
  });
  class Element {
    textContent = '';
    children = [];
    listeners = {};
    attributes = {};
    style = { setProperty() {} };
    dataset = {};
    className = '';
    hidden = false;
    disabled = false;
    classList = {
      contains: (value) => this.className.split(' ').includes(value),
      add: (value) => {
        this.className += ` ${value}`;
      },
    };
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    focus() {}
  }
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = {
    querySelector: element,
    getElementById: element,
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener() {},
  };
  const source = readFileSync(
    join(__dirname, '../../../packages/pet-gacha/dist/ui/app.js'),
    'utf8',
  ).replace(/import\s+\{([^}]+)\}\s+from\s+["']\.\.\/index\.js["'];/, 'const {$1} = gachaModule;');
  vm.runInNewContext(source, {
    Error,
    gachaModule: await import('@pet/gacha'),
    document,
    URL,
    URLSearchParams,
    Intl,
    window: {
      gacha: bridge,
      crypto: { randomUUID: () => 'ui-gacha-request' },
      addEventListener() {},
      matchMedia: () => ({ matches: true }),
      location: { search: '', href: 'file:///game/packages/pet-gacha/ui/index.html' },
      setTimeout: () => 1,
      clearTimeout() {},
      close() {},
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { client, database, element, settle, handlers, allowed, draws: () => draws };
}

test('뽑기 화면은 preload와 main을 거쳐 저장하고 연속 클릭을 한 요청으로 막는다', async (t) => {
  const { client, element, settle, draws } = await uiHarness(t);
  assert.equal(element('draw-one').disabled, true);
  await settle();
  assert.equal(element('owned-count').textContent, '0');
  assert.equal(element('odds-list').children.length, 3);
  element('draw-ten').listeners.click();
  element('draw-ten').listeners.click();
  assert.equal(element('draw-ten').disabled, true);
  await settle();
  assert.equal(draws(), 1);
  assert.equal(client.countOwnedPets(), 10);
  assert.equal(element('owned-count').textContent, '10');
  assert.equal(element('token-balance').textContent, '9,000,000');
  element('skip-button').listeners.click();
  assert.equal(element('result-grid').children.length, 10);
  element('close-results').listeners.click();
  assert.equal(element('draw-one').disabled, false);
});

test('뽑기 화면의 조회·저장 실패는 재시도할 수 있고 실패 시 토큰을 차감하지 않는다', async (t) => {
  const { client, element, settle } = await uiHarness(t, { failLoad: true, failDraw: true });
  await settle();
  assert.equal(element('draw-one').disabled, false);
  assert.equal(element('odds-button').disabled, true);
  assert.equal(element('stage-heading').textContent, '목록 조회 실패');
  element('draw-one').listeners.click();
  await settle();
  assert.equal(element('stage-heading').textContent, '저장 실패');
  assert.equal(client.countOwnedPets(), 0);
  assert.equal(element('token-balance').textContent, '10,000,000');
  assert.equal(element('pity-counter').textContent, '0 / 100');
  assert.equal(element('draw-one').disabled, false);
  element('draw-one').listeners.click();
  await settle();
  assert.equal(client.countOwnedPets(), 1);
  assert.equal(element('owned-count').textContent, '1');
  assert.equal(element('pity-counter').textContent, '1 / 100');
});

test('뽑기 bridge는 다른 창과 허용하지 않은 횟수의 저장을 차단한다', async (t) => {
  const { client, handlers, allowed } = await uiHarness(t);
  assert.equal(handlers.get('gacha:draw')({}, 1).ok, false);
  assert.equal(handlers.get('gacha:load')({}).ok, false);
  assert.equal(handlers.get('gacha:draw')(allowed, 2).ok, false);
  assert.equal(client.countOwnedPets(), 0);
});

test('Electron 런타임의 기본 난수 생성기로 실제 뽑기 결과를 저장할 수 있다', async (t) => {
  const { client, currency, database } = await fixture(t);
  const { createPersistentGacha } = await import('@pet/gacha');
  const saved = createPersistentGacha(client, currency, (work) => database.transaction(work)).draw(
    1,
  );
  assert.equal(saved.ownedPetIds.length, 1);
  assert.equal(client.getOwnedPet(saved.ownedPetIds[0]).speciesId, saved.results[0].pet.id);
});
