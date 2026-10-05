const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-feature-economy-'));
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.open();
  const currency = new SqliteTokenClient(
    new TokenRepository(database),
    new CurrencyRepository(database),
  );
  const pets = new SqlitePetClient(new PetRepository(database));
  return { database, currency, pets, transaction: (work) => database.transaction(work) };
}

test('TokenClient는 신규 지급을 한 번만 기록하고 잔액보다 많이 소비하지 않는다', async (t) => {
  const { currency } = await fixture(t);
  assert.equal(currency.grantOnce('test:funds', 10_000_000, '테스트 지급'), true);
  assert.equal(currency.grantOnce('test:funds', 10_000_000, '테스트 지급'), false);
  assert.equal(currency.spend(10_000_001, '뽑기'), false);
  assert.equal(currency.balance(), 10_000_000);
  assert.equal(currency.spend(100_000, '뽑기'), true);
  assert.equal(currency.balance(), 9_900_000);
  assert.throws(() => currency.spend(-1, '뽑기'));
});

test('earnedSince는 기준 시각부터 지급된 양만 더하고 소비는 세지 않는다', async (t) => {
  const { database } = await fixture(t);
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  let now = '2026-10-04T14:59:59.999Z';
  const tokens = new SqliteTokenClient(
    new TokenRepository(database),
    new CurrencyRepository(database),
    () => now,
  );

  tokens.grantOnce('reward:before', 500, '기준 시각 직전');
  now = '2026-10-04T15:00:00.000Z';
  tokens.grantOnce('reward:boundary', 300, '기준 시각 정각');
  now = '2026-10-05T03:00:00.000Z';
  tokens.grantOnce('reward:after', 200, '기준 시각 이후');
  assert.equal(tokens.spend(100, '펫 뽑기'), true);

  assert.equal(tokens.earnedSince('2026-10-04T15:00:00.000Z'), 500, '정각 포함, 소비 제외');
  assert.equal(tokens.earnedSince('2026-10-06T00:00:00.000Z'), 0, '지급이 없으면 0');
  assert.equal(tokens.balance(), 900);
  assert.throws(() => tokens.earnedSince(' '), '기준 시각이 비면 전체 합으로 오해된다');
});

test('새 저장소는 자동 재화 없이 시작하고 재시작해도 0을 유지한다', async (t) => {
  const { database, currency } = await fixture(t);
  const tokenModule = await import('../dist/main/clients/sqlite-token-client.js');
  assert.equal('grantTestingWelcome' in tokenModule, false);
  assert.equal(currency.balance(), 0);
  database.close();
  database.open();
  assert.equal(currency.balance(), 0);
});

test('관리자 명령은 지정 금액을 기존 잔액에 더하고 잘못된 금액은 거부한다', async (t) => {
  const { currency, database } = await fixture(t);
  const { parseGrantAmount, grantAdminTokens } = await import('../dist/main/admin/grant-tokens.js');
  assert.equal(parseGrantAmount(['1000000']), 1_000_000);
  for (const args of [[], ['0'], ['-1'], ['1.5'], ['1e6'], ['abc'], ['1', '2']]) {
    assert.throws(() => parseGrantAmount(args));
  }
  currency.grantOnce('prior:reward', 90, '기존 보상');
  assert.deepEqual(grantAdminTokens(currency, 1_000_000, 'admin:test-1'), {
    previousBalance: 90,
    currentBalance: 1_000_090,
  });
  assert.throws(() => grantAdminTokens(currency, 1_000_000, 'admin:test-1'));
  assert.equal(currency.balance(), 1_000_090);
  database.close();
  database.open();
  assert.equal(currency.balance(), 1_000_090);
  assert.deepEqual(grantAdminTokens(currency, 50, 'admin:test-2'), {
    previousBalance: 1_000_090,
    currentBalance: 1_000_140,
  });
  assert.throws(() => grantAdminTokens(currency, Number.MAX_SAFE_INTEGER, 'admin:overflow'));
  assert.equal(currency.balance(), 1_000_140);
});

test('뽑기는 재화 차감과 펫 생성을 함께 확정하고 펫 저장 실패 시 함께 취소한다', async (t) => {
  const { database, currency, pets, transaction } = await fixture(t);
  const { createPersistentGacha } = await import('@pet/gacha');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const gacha = createPersistentGacha(pets, currency, transaction, () => 0);
  const result = gacha.draw(1);
  assert.equal(result.balance, 9_900_000);
  assert.equal(pets.countOwnedPets(), 1);
  database.exec(`CREATE TRIGGER fail_feature_pet BEFORE INSERT ON owned_pets
    BEGIN SELECT RAISE(ABORT, 'pet save failed'); END`);
  assert.throws(() => gacha.draw(1), /pet save failed/);
  assert.equal(currency.balance(), 9_900_000);
  assert.equal(pets.countOwnedPets(), 1);
  assert.equal(gacha.load().totalDrawCount, 1);
});

test('합성은 실제 개체 10개와 비용을 함께 바꾸고 결과 실패 시 모두 되돌린다', async (t) => {
  const { database, currency, pets, transaction } = await fixture(t);
  const { createPersistentCombine } = await import('@pet/combine');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const materials = pets.createOwnedPets(Array(20).fill('003'));
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  const first = combine.combine(
    'common',
    materials.slice(0, 10).map((pet) => pet.ownedPetId),
  );
  assert.equal(first.result.rarity, 'RARE');
  assert.equal(first.balance, 9_970_000);
  assert.equal(pets.countOwnedPets(), 11);
  database.exec(`CREATE TRIGGER fail_feature_result BEFORE INSERT ON owned_pets
    WHEN NEW.species_id IN ('002', '005') BEGIN SELECT RAISE(ABORT, 'result failed'); END`);
  assert.throws(
    () =>
      combine.combine(
        'common',
        materials.slice(10).map((pet) => pet.ownedPetId),
      ),
    /result failed/,
  );
  assert.equal(currency.balance(), 9_970_000);
  assert.equal(pets.countOwnedPets(), 11);
});

test('부족한 재화와 잘못된 합성 재료는 어떤 원장도 바꾸지 않는다', async (t) => {
  const { currency, pets, transaction } = await fixture(t);
  const { createPersistentGacha, GachaActionError } = await import('@pet/gacha');
  const { createPersistentCombine, CombineActionError } = await import('@pet/combine');
  const gacha = createPersistentGacha(pets, currency, transaction, () => 0);
  assert.throws(() => gacha.draw(1), GachaActionError);
  assert.equal(gacha.load().totalDrawCount, 0);
  assert.equal(pets.countOwnedPets(), 0);
  currency.grantOnce('small', 30_000, '테스트');
  const materials = pets.createOwnedPets(Array(10).fill('003'));
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  assert.throws(
    () => combine.combine('common', Array(10).fill(materials[0].ownedPetId)),
    CombineActionError,
  );
  assert.equal(currency.balance(), 30_000);
  pets.setActivePet(materials[0].ownedPetId);
  assert.throws(
    () =>
      combine.combine(
        'common',
        materials.map((pet) => pet.ownedPetId),
      ),
    CombineActionError,
  );
  assert.equal(currency.balance(), 30_000);
  const other = pets.createOwnedPets(['003'])[0];
  const validMaterials = [...materials.slice(1), other];
  currency.spend(1, '다른 기능');
  assert.throws(
    () =>
      combine.combine(
        'common',
        validMaterials.map((pet) => pet.ownedPetId),
      ),
    CombineActionError,
  );
  assert.equal(currency.balance(), 29_999);
  assert.equal(pets.countOwnedPets(), 11);
});

test('RARE 합성은 실제 개체 10개를 EPIC 1개로 바꾸고 잔액을 재시작 후 유지한다', async (t) => {
  const { database, currency, pets, transaction } = await fixture(t);
  const { createPersistentCombine } = await import('@pet/combine');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const rare = pets.createOwnedPets(Array(10).fill('002'));
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  const saved = combine.combine(
    'rare',
    rare.map((pet) => pet.ownedPetId),
  );
  assert.equal(saved.result.rarity, 'EPIC');
  assert.equal(saved.result.level, 1);
  assert.equal(saved.balance, 9_900_000);
  database.close();
  database.open();
  assert.equal(currency.balance(), 9_900_000);
  assert.deepEqual(
    pets.listOwnedPets().map((pet) => pet.ownedPetId),
    [saved.result.ownedPetId],
  );
});

test('재화 기록 실패 시 뽑기와 합성 모두 펫 개체를 변경하지 않는다', async (t) => {
  const { database, currency, pets, transaction } = await fixture(t);
  const { createPersistentGacha } = await import('@pet/gacha');
  const { createPersistentCombine } = await import('@pet/combine');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const materials = pets.createOwnedPets(Array(10).fill('003'));
  database.exec(`CREATE TRIGGER fail_feature_spend BEFORE INSERT ON currency_ledger
    WHEN NEW.delta < 0 BEGIN SELECT RAISE(ABORT, 'currency save failed'); END`);
  const gacha = createPersistentGacha(pets, currency, transaction, () => 0);
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  assert.throws(() => gacha.draw(1), /currency save failed/);
  assert.throws(
    () =>
      combine.combine(
        'common',
        materials.map((pet) => pet.ownedPetId),
      ),
    /currency save failed/,
  );
  assert.equal(currency.balance(), 10_000_000);
  assert.equal(pets.countOwnedPets(), 10);
  assert.equal(gacha.load().totalDrawCount, 0);
});

test('뽑기와 합성은 같은 펫 명부와 재화 잔액을 다음 조회에서 공유한다', async (t) => {
  const { currency, pets, transaction } = await fixture(t);
  const { createPersistentGacha } = await import('@pet/gacha');
  const { createPersistentCombine } = await import('@pet/combine');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const gacha = createPersistentGacha(pets, currency, transaction, () => 0);
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  assert.equal(combine.load().balance, 10_000_000);
  const draw = gacha.draw(1);
  assert.equal(combine.load().balance, 9_900_000);
  assert.equal(combine.load().ownedPets[0].ownedPetId, draw.ownedPetIds[0]);
  const more = pets.createOwnedPets(Array(9).fill('003'));
  combine.combine('common', [draw.ownedPetIds[0], ...more.map((pet) => pet.ownedPetId)]);
  assert.equal(gacha.load().balance, 9_870_000);
  assert.equal(gacha.load().ownedCount, 1);
});

test('같은 요청 ID를 다시 보내거나 재시작해도 두 번 차감하지 않는다', async (t) => {
  const { database, currency, pets, transaction } = await fixture(t);
  const { createPersistentGacha } = await import('@pet/gacha');
  const { createPersistentCombine } = await import('@pet/combine');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const gacha = createPersistentGacha(pets, currency, transaction, () => 0);
  gacha.draw(1, 'same-draw');
  assert.throws(() => gacha.draw(1, 'same-draw'));
  database.close();
  database.open();
  const restartedGacha = createPersistentGacha(pets, currency, transaction, () => 0);
  assert.throws(() => restartedGacha.draw(1, 'same-draw'));
  assert.equal(currency.balance(), 9_900_000);
  assert.equal(pets.countOwnedPets(), 1);
  const materials = pets.createOwnedPets(Array(10).fill('003'));
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  combine.combine(
    'common',
    materials.map((pet) => pet.ownedPetId),
    'same-combine',
  );
  const freshMaterials = pets.createOwnedPets(Array(10).fill('003'));
  assert.throws(() =>
    combine.combine(
      'common',
      freshMaterials.map((pet) => pet.ownedPetId),
      'same-combine',
    ),
  );
  assert.equal(currency.balance(), 9_870_000);
  assert.equal(pets.countOwnedPets(), 12);
});

test('합성 화면은 preload와 IPC로 실제 보유 개체 10개를 보내고 저장 결과를 표시한다', async (t) => {
  const { currency, pets, transaction } = await fixture(t);
  const { createPersistentCombine } = await import('@pet/combine');
  const { registerCombineIpc } = await import('../dist/main/ipc/combine.js');
  currency.grantOnce('test:funds', 10_000_000, '테스트 지급');
  const materials = pets.createOwnedPets(Array(10).fill('003'));
  const combine = createPersistentCombine(pets, currency, transaction, () => 0);
  const handlers = new Map();
  const allowed = {};
  registerCombineIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    combine,
    (event) => event === allowed,
  );
  assert.equal(handlers.get('combine:load')({}).ok, false);
  assert.equal(handlers.get('combine:combine')({}, 'common', []).ok, false);

  let exposed;
  vm.runInNewContext(readFileSync(join(__dirname, '../src/preload/combine.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, bridge) => (exposed = bridge) },
      ipcRenderer: { invoke: async (channel, ...args) => handlers.get(channel)(allowed, ...args) },
    }),
  });

  class Element {
    textContent = '';
    children = [];
    listeners = {};
    dataset = {};
    className = '';
    style = { setProperty() {} };
    classList = {
      contains: (value) => this.className.split(' ').includes(value),
      add: (value) => (this.className += ` ${value}`),
      remove: (value) =>
        (this.className = this.className
          .split(' ')
          .filter((item) => item !== value)
          .join(' ')),
      toggle: () => {},
    };
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    querySelector(selector) {
      return element(selector);
    }
    querySelectorAll(selector) {
      return selector === '[data-grade]' ? [element('common-tab'), element('rare-tab')] : [];
    }
    append(...items) {
      this.children.push(...items);
    }
    replaceChildren(...items) {
      this.children = items;
    }
    setAttribute() {}
  }
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  element('common-tab').dataset.grade = 'common';
  element('rare-tab').dataset.grade = 'rare';
  const document = {
    querySelector: element,
    createElement: () => new Element(),
  };
  const window = {
    combine: exposed,
    crypto: { randomUUID: () => 'ui-combine-request' },
    location: { search: '?assets=file:///assets/' },
    matchMedia: () => ({ matches: true }),
    addEventListener() {},
    setTimeout: (callback) => callback(),
    close() {},
  };
  vm.runInNewContext(
    readFileSync(join(__dirname, '../../../packages/pet-combine/ui/app.mjs'), 'utf8'),
    { document, window, URL, URLSearchParams, Error, Set },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element('.selection-slots').children.length, 10);
  assert.equal(element('.token-readout').textContent, 'TOKEN 10,000,000');
  element('.combine-button').listeners.click();
  element('.combine-button').listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currency.balance(), 9_970_000);
  assert.equal(pets.countOwnedPets(), 1);
  assert.equal(
    materials.every(
      (pet) => !pets.listOwnedPets().some((owned) => owned.ownedPetId === pet.ownedPetId),
    ),
    true,
  );
  assert.equal(element('.token-readout').textContent, 'TOKEN 9,970,000');
  assert.match(element('.combine-result').textContent, /획득/);
});
