const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `petto-starter-${name}-`));
}

async function openClient(directory) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { ensureStarterPet } = await import('../dist/main/starter-pet.js');
  const database = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  database.open();
  return {
    database,
    pets: new SqlitePetClient(new PetRepository(database)),
    ensureStarterPet,
  };
}

const always = (index) => () => index;

test('새 설치에는 COMMON 한 마리를 주고 활성화한다', async () => {
  const directory = temporaryDirectory('grant');
  const { database, pets, ensureStarterPet } = await openClient(directory);
  try {
    assert.equal(pets.countOwnedPets(), 0, '처음에는 보유 펫이 없다');
    assert.equal(pets.getActivePet(), null);

    const outcome = ensureStarterPet(pets, always(0));

    assert.equal(outcome.kind, 'granted');
    assert.equal(pets.countOwnedPets(), 1);
    const active = pets.getActivePet();
    assert.ok(active, '활성 펫이 정해져야 오버레이가 그릴 대상이 생긴다');
    assert.equal(active.ownedPetId, outcome.ownedPetId);
    assert.equal(active.rarity, 'COMMON', '초기 펫은 COMMON에서만 고른다');
    assert.equal(active.level, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('이미 활성 펫이 있으면 아무것도 하지 않는다', async () => {
  const directory = temporaryDirectory('idempotent');
  const { database, pets, ensureStarterPet } = await openClient(directory);
  try {
    const first = ensureStarterPet(pets, always(0));
    assert.equal(first.kind, 'granted');

    const second = ensureStarterPet(pets, always(0));

    assert.equal(second.kind, 'already_ready', '두 번째 실행이 펫을 또 주면 안 된다');
    assert.equal(pets.countOwnedPets(), 1, '앱을 다시 켤 때마다 늘어나지 않는다');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('보유 펫은 있는데 활성 펫만 없으면 첫 개체를 활성화한다', async () => {
  const directory = temporaryDirectory('activate');
  const { database, pets, ensureStarterPet } = await openClient(directory);
  try {
    // 뽑기로 받은 개체는 비활성 상태로 생긴다. 그대로 두면 오버레이가 그릴 펫이 없다.
    const [drawn] = pets.createOwnedPets([pets.listSpecies('RARE')[0].speciesId]);
    assert.equal(pets.getActivePet(), null);

    const outcome = ensureStarterPet(pets, always(0));

    assert.equal(outcome.kind, 'activated');
    assert.equal(outcome.ownedPetId, drawn.ownedPetId);
    assert.equal(pets.countOwnedPets(), 1, '활성화만 하고 새로 주지 않는다');
    assert.equal(pets.getActivePet().ownedPetId, drawn.ownedPetId);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('무작위 선택이 어느 COMMON 종을 고르든 지급된다', async () => {
  const commonIds = new Set();
  for (let index = 0; index < 4; index += 1) {
    const directory = temporaryDirectory(`pick-${index}`);
    const { database, pets, ensureStarterPet } = await openClient(directory);
    try {
      // 범위를 벗어난 값을 줘도 목록 밖을 가리키지 않아야 한다.
      const outcome = ensureStarterPet(pets, always(index));
      assert.equal(outcome.kind, 'granted');
      assert.equal(pets.getActivePet().rarity, 'COMMON');
      commonIds.add(outcome.speciesId);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  assert.ok(commonIds.size >= 2, '선택 인덱스에 따라 다른 종이 나온다');
});

test('재연결 후에도 초기 펫이 한 마리로 유지된다', async () => {
  const directory = temporaryDirectory('restart');
  const first = await openClient(directory);
  let grantedId;
  try {
    grantedId = first.ensureStarterPet(first.pets, always(0)).ownedPetId;
  } finally {
    first.database.close();
  }

  const second = await openClient(directory);
  try {
    assert.equal(second.ensureStarterPet(second.pets, always(0)).kind, 'already_ready');
    assert.equal(second.pets.countOwnedPets(), 1);
    assert.equal(second.pets.getActivePet().ownedPetId, grantedId);
  } finally {
    second.database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
