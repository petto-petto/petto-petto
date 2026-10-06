const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-starter-${name}-`));
}

async function open(directory) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { CurrencyRepository } =
    await import('../dist/main/persistence/repositories/currency-repository.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const starter = await import('../dist/main/starter-pet.js');
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  return {
    database,
    pets: new SqlitePetClient(new PetRepository(database)),
    tokens: new SqliteTokenClient(new TokenRepository(database), new CurrencyRepository(database)),
    ...starter,
  };
}

test('첫 실행에 뽑기 1회분을 지급한다', async () => {
  const directory = temporaryDirectory('grant');
  const { database, tokens, grantFirstDrawCurrency, FIRST_DRAW_GRANT } = await open(directory);
  try {
    assert.equal(tokens.balance(), 0, '처음에는 잔액이 없다');

    assert.deepEqual(grantFirstDrawCurrency(tokens), {
      kind: 'granted',
      amount: FIRST_DRAW_GRANT,
    });
    assert.equal(tokens.balance(), FIRST_DRAW_GRANT);
    assert.equal(FIRST_DRAW_GRANT, 100_000, '뽑기 1회 비용과 같아야 한다');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('두 번째 실행부터는 지급하지 않는다', async () => {
  const directory = temporaryDirectory('once');
  const first = await open(directory);
  try {
    first.grantFirstDrawCurrency(first.tokens);
    first.tokens.spend(100_000, '뽑기');
    assert.equal(first.tokens.balance(), 0);
  } finally {
    first.database.close();
  }

  const second = await open(directory);
  try {
    assert.deepEqual(
      second.grantFirstDrawCurrency(second.tokens),
      { kind: 'already_granted' },
      '재시작해도 다시 주지 않는다',
    );
    assert.equal(second.tokens.balance(), 0, '잔액을 다시 채워 주지 않는다');
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('보유 펫이 없으면 활성화할 것이 없다', async () => {
  const directory = temporaryDirectory('none');
  const { database, pets, ensureActivePet } = await open(directory);
  try {
    assert.deepEqual(ensureActivePet(pets), { kind: 'no_pets' });
    assert.equal(pets.getActivePet(), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('뽑기로 받은 비활성 개체를 활성화한다', async () => {
  const directory = temporaryDirectory('activate');
  const { database, pets, ensureActivePet } = await open(directory);
  try {
    // 뽑기는 createOwnedPets 로 비활성 개체를 만든다.
    const [drawn] = pets.createOwnedPets([pets.listSpecies('COMMON')[0].speciesId]);
    assert.equal(pets.getActivePet(), null, '뽑기만으로는 활성 펫이 생기지 않는다');

    assert.deepEqual(ensureActivePet(pets), { kind: 'activated', ownedPetId: drawn.ownedPetId });
    assert.equal(pets.getActivePet().ownedPetId, drawn.ownedPetId);
    assert.deepEqual(ensureActivePet(pets), { kind: 'already_active' }, '두 번 바꾸지 않는다');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('이미 고른 활성 펫을 뒤집지 않는다', async () => {
  const directory = temporaryDirectory('keep');
  const { database, pets, ensureActivePet } = await open(directory);
  try {
    const owned = pets.createOwnedPets([
      pets.listSpecies('COMMON')[0].speciesId,
      pets.listSpecies('RARE')[0].speciesId,
    ]);
    pets.setActivePet(owned[1].ownedPetId);

    assert.deepEqual(ensureActivePet(pets), { kind: 'already_active' });
    assert.equal(pets.getActivePet().ownedPetId, owned[1].ownedPetId, '사용자 선택을 지킨다');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
