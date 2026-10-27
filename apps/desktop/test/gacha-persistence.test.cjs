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

async function uiHarness(t, { failLoad = false, failDraw = false, spent = 0 } = {}) {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const { client, currency, database, gacha } = await fixture(t);
  if (spent > 0) currency.spendOnce('test:spent', spent, '테스트 소비');
  const { registerGachaIpc } = await import('../dist/main/ipc/gacha.js');
  const { ensureActivePet } = await import('../dist/main/starter-pet.js');
  const handlers = new Map();
  const allowed = {};
  let petsChanged = 0;
  registerGachaIpc(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    gacha,
    (event) => event === allowed,
    () => {
      petsChanged++;
      // 앱과 같이, 첫 펫은 뽑는 순간 오버레이 펫이 된다.
      ensureActivePet(client);
    },
  );
  // 결과 화면이 부르는 앱 채널(오버레이 펫·펫룸). 무엇을 불렀는지 남긴다.
  const opened = [];
  handlers.set('room:scene', () => ({
    pets: client
      .listOwnedPets()
      .map((pet) => ({ ownedPetId: pet.ownedPetId, isActive: pet.isActive })),
  }));
  handlers.set('room:setActivePet', (_event, ownedPetId) => client.setActivePet(ownedPetId));
  handlers.set('screen:open', (_event, screen, focus) => opened.push({ screen, focus }));
  let closed = 0;
  let requestSeq = 0;
  // 연출 타이머는 테스트가 원할 때 돌린다. 취소한 타이머는 돌지 않는다.
  const timers = new Map();
  let timerId = 0;
  const flushTimers = () => {
    for (const [id, fn] of [...timers]) {
      timers.delete(id);
      fn();
    }
  };
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
        // preload 는 상단 바용 `shell`도 노출한다. 화면 코드가 쓰는 `gacha`만 잡는다.
        exposeInMainWorld: (name, value) => {
          if (name === 'gacha') bridge = value;
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
      remove: (value) => {
        this.className = this.className
          .split(' ')
          .filter((name) => name !== value)
          .join(' ');
      },
      toggle: (value, force) => {
        const on = force ?? !this.classList.contains(value);
        if (on && !this.classList.contains(value)) this.classList.add(value);
        if (!on) this.classList.remove(value);
        return on;
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
      // 요청마다 새 id 다. 실패한 요청을 다시 보낼 때만 같은 id 를 쓰는 것은 화면 코드의 일이다.
      crypto: { randomUUID: () => `ui-gacha-request-${++requestSeq}` },
      addEventListener() {},
      matchMedia: () => ({ matches: true }),
      location: { search: '', href: 'file:///game/packages/pet-gacha/ui/index.html' },
      setTimeout: (fn) => {
        timers.set(++timerId, fn);
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      close() {
        closed++;
      },
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    client,
    database,
    element,
    settle,
    handlers,
    allowed,
    draws: () => draws,
    petsChanged: () => petsChanged,
    opened,
    closed: () => closed,
    flushTimers,
  };
}

test('뽑기 화면은 preload와 main을 거쳐 저장하고 연속 클릭을 한 요청으로 막는다', async (t) => {
  const { client, element, settle, draws, petsChanged } = await uiHarness(t);
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
  // 보유 펫이 바뀌었으니 펫룸·오버레이가 다시 읽도록 한 번 알린다.
  assert.equal(petsChanged(), 1);
  assert.equal(element('owned-count').textContent, '10');
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
  // 잔액은 상단 바가 보인다. 실패한 소환이 차감하지 않았으니 10회 소환이 그대로 가능하다.
  assert.equal(element('draw-ten-cost').textContent, '1M 토큰 · RARE 이상 보장');
  assert.equal(element('pity-counter').textContent, '0 / 100');
  assert.equal(element('draw-one').disabled, false);
  element('draw-one').listeners.click();
  await settle();
  assert.equal(client.countOwnedPets(), 1);
  assert.equal(element('owned-count').textContent, '1');
  assert.equal(element('pity-counter').textContent, '1 / 100');
});

test('잔액이 모자란 소환은 누르기 전에 비활성으로 보이고 부족분과 모으는 방법을 알린다', async (t) => {
  // 10,000,000 - 9,744,691 = 255,309
  const { element, settle } = await uiHarness(t, { spent: 9_744_691 });
  await settle();
  assert.equal(element('draw-ten').disabled, true);
  assert.equal(element('draw-ten').classList.contains('unaffordable'), true);
  assert.equal(element('draw-ten-cost').textContent, '1M 토큰 · 745K 부족');
  assert.equal(element('draw-one').disabled, false);
  assert.equal(element('draw-one-cost').textContent, '100K 토큰');
  assert.equal(element('token-hint').hidden, false);
  assert.equal(element('token-hint').textContent, 'AI 도구를 쓰면 토큰이 쌓여요.');
});

test('잔액이 충분하면 토큰 안내를 보이지 않는다', async (t) => {
  const { element, settle } = await uiHarness(t);
  await settle();
  assert.equal(element('draw-ten').disabled, false);
  assert.equal(element('draw-ten-cost').textContent, '1M 토큰 · RARE 이상 보장');
  assert.equal(element('token-hint').hidden, true);
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

test('첫 펫의 결과 화면은 오버레이에서 만나기가 기본이고, 누르면 창만 닫는다', async (t) => {
  const { client, element, settle, closed, flushTimers } = await uiHarness(t);
  await settle();
  element('draw-one').listeners.click();
  await settle();
  element('skip-button').listeners.click();
  flushTimers();
  await settle();
  assert.equal(element('result-actions').hidden, false);
  assert.equal(element('result-overlay').textContent, '오버레이에서 만나기');
  assert.equal(element('result-overlay').classList.contains('primary'), true);
  assert.equal(element('result-room').classList.contains('primary'), false);
  assert.equal(element('result-again-cost').textContent, '100K 토큰');

  const [first] = client.listOwnedPets();
  element('result-overlay').listeners.click();
  await settle();
  assert.equal(closed(), 1);
  assert.equal(client.getActivePet()?.ownedPetId, first.ownedPetId);
});

test('두 번째 펫부터는 오버레이로 지정이 그 펫을 세우고, 펫룸에서 보기는 그 펫의 상세를 연다', async (t) => {
  const { client, element, settle, opened, closed, flushTimers } = await uiHarness(t);
  await settle();
  element('draw-one').listeners.click();
  await settle();
  element('skip-button').listeners.click();
  element('close-results').listeners.click();

  element('draw-one').listeners.click();
  await settle();
  element('skip-button').listeners.click();
  flushTimers();
  await settle();
  assert.equal(element('result-overlay').textContent, '오버레이로 지정');
  assert.equal(element('result-room').classList.contains('primary'), true);

  const second = client.listOwnedPets().find((pet) => !pet.isActive);
  element('result-room').listeners.click();
  await settle();
  assert.deepEqual(opened, [{ screen: 'room', focus: second.ownedPetId }]);

  element('result-overlay').listeners.click();
  await settle();
  assert.equal(client.getActivePet()?.ownedPetId, second.ownedPetId);
  assert.equal(closed(), 1);
});

test('10회 소환 결과는 가장 높은 등급의 첫 카드를 고르고, 카드를 누르면 대상이 바뀐다', async (t) => {
  const { element, settle, flushTimers } = await uiHarness(t);
  await settle();
  element('draw-ten').listeners.click();
  await settle();
  element('skip-button').listeners.click();
  flushTimers();
  await settle();
  const cards = element('result-grid').children;
  const grades = cards.map((card) => card.className.split(' ')[1]);
  const rank = { common: 0, rare: 1, epic: 2 };
  const top = Math.max(...grades.map((grade) => rank[grade]));
  const expected = grades.findIndex((grade) => rank[grade] === top);
  assert.equal(
    cards.findIndex((card) => card.classList.contains('selected')),
    expected,
  );

  const other = expected === 0 ? 1 : 0;
  cards[other].listeners.click();
  assert.equal(
    cards.findIndex((card) => card.classList.contains('selected')),
    other,
  );
});

test('잔액이 모자라면 한 번 더는 비활성이고 부족분을 쓴다', async (t) => {
  // 잔액 1,100,000 에서 10회 소환하면 100,000 이 남아 다음 10회는 모자라다.
  const { element, settle, flushTimers } = await uiHarness(t, { spent: 8_900_000 });
  await settle();
  element('draw-ten').listeners.click();
  await settle();
  element('skip-button').listeners.click();
  flushTimers();
  await settle();
  assert.equal(element('result-again').disabled, true);
  assert.equal(element('result-again-cost').textContent, '1M 토큰 · 900K 부족');
});
