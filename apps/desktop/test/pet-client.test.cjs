const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

async function fixture(t) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-pet-client-'));
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
  return { database, client };
}

test('PetClient는 최초 6종을 조회하고 재시작해도 seed를 중복 지급하지 않는다', async (t) => {
  const { database, client } = await fixture(t);
  assert.equal(client.countSpecies(), 6);
  for (const rarity of ['COMMON', 'RARE', 'EPIC']) {
    const species = client.listSpecies(rarity);
    assert.equal(species.length, 2);
    assert.equal(client.countSpecies(rarity), species.length);
    for (const pet of species) {
      const asset = JSON.parse(
        readFileSync(
          join(__dirname, `../renderer/assets/pets/${rarity.toLowerCase()}/${pet.sprite}/pet.json`),
          'utf8',
        ),
      );
      assert.deepEqual(pet, {
        speciesId: asset.petId,
        name: asset.name,
        rarity: asset.grade,
        sprite: asset.slug,
      });
    }
  }
  assert.deepEqual(client.listOwnedPets(), []);
  assert.equal(client.getActivePet(), null);
  assert.equal(client.countOwnedSpecies(), 0);
  assert.equal(client.getHighestLevel(), 0);
  database.close();
  database.open();
  assert.equal(client.countSpecies(), 6);
  assert.equal(client.countOwnedPets(), 0);
});

test('중복 종류는 개체별로 생성되고 별명·성장·활성이 재연결 후 보존된다', async (t) => {
  const { database, client } = await fixture(t);
  const [first, second, third] = client.createOwnedPets(['003', '003', '004']);
  assert.notEqual(first.ownedPetId, second.ownedPetId);
  assert.equal(first.level, 1);
  assert.equal(first.totalXp, 0);
  assert.equal(first.evolutionStage, 0);
  assert.equal(first.nickname, null);
  assert.equal(first.isActive, false);
  assert.equal(client.countOwnedPets(), 3);
  assert.equal(client.countOwnedSpecies(), 2);
  assert.equal(client.listOwnedPets('003').length, 2);
  assert.deepEqual(client.listOwnedPets('unknown'), []);
  client.updateNickname(first.ownedPetId, '  모찌  ');
  client.updateGrowth(first.ownedPetId, {
    level: 15,
    totalXp: 190,
    xpIntoLevel: 1,
    evolutionStage: 1,
  });
  client.setActivePet(second.ownedPetId);
  client.setActivePet(first.ownedPetId);
  database.close();
  database.open();
  assert.equal(client.getActivePet().ownedPetId, first.ownedPetId);
  assert.equal(client.getOwnedPet(first.ownedPetId).nickname, '모찌');
  assert.equal(client.getOwnedPet(first.ownedPetId).totalXp, 190);
  assert.equal(client.getOwnedPet(first.ownedPetId).evolutionStage, 1);
  assert.equal(client.getOwnedPet(second.ownedPetId).level, 1);
  assert.equal(client.getOwnedPet(third.ownedPetId).isActive, false);
  assert.equal(client.getHighestLevel(), 15);
  assert.equal(client.updateNickname(first.ownedPetId, '   ').nickname, null);
  assert.equal(client.updateNickname(first.ownedPetId, null).nickname, null);
});

test('활성 펫 선택 실패는 기존 선택을 보존하고 DB도 중복 활성을 거부한다', async (t) => {
  const { database, client } = await fixture(t);
  const [first, second] = client.createOwnedPets(['003', '004']);
  client.setActivePet(first.ownedPetId);
  assert.throws(() => client.setActivePet('missing'));
  assert.equal(client.getActivePet().ownedPetId, first.ownedPetId);
  assert.throws(() =>
    database
      .prepare('UPDATE owned_pets SET is_active = 1 WHERE owned_pet_id = ?')
      .run(second.ownedPetId),
  );
  assert.equal(client.listOwnedPets().filter((pet) => pet.isActive).length, 1);
});

test('합성 저장은 선택한 개체만 삭제하며 결과는 초기 상태로 생성한다', async (t) => {
  const { client } = await fixture(t);
  const [first, second, keep] = client.createOwnedPets(['003', '003', '004']);
  client.setActivePet(keep.ownedPetId);
  const result = client.replaceOwnedPets([first.ownedPetId, second.ownedPetId], '005');
  assert.equal(result.speciesId, '005');
  assert.equal(result.level, 1);
  assert.equal(result.totalXp, 0);
  assert.equal(result.isActive, false);
  assert.equal(client.countOwnedPets(), 2);
  assert.equal(client.getActivePet().ownedPetId, keep.ownedPetId);
  assert.throws(() => client.getOwnedPet(first.ownedPetId));
  assert.throws(() => client.replaceOwnedPets([first.ownedPetId], '005'));
  assert.equal(client.countOwnedPets(), 2);
});

test('잘못된 합성 입력과 결과 INSERT 실패는 모든 재료를 보존한다', async (t) => {
  const { database, client } = await fixture(t);
  const [first, second] = client.createOwnedPets(['003', '004']);
  const before = client.listOwnedPets();
  for (const [ids, species] of [
    [[], '005'],
    [[first.ownedPetId, first.ownedPetId], '005'],
    [[first.ownedPetId, 'missing'], '005'],
    [[first.ownedPetId], 'missing'],
  ]) {
    assert.throws(() => client.replaceOwnedPets(ids, species));
    assert.deepEqual(client.listOwnedPets(), before);
  }
  database.exec(`CREATE TRIGGER reject_pet_insert BEFORE INSERT ON owned_pets
    BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END`);
  assert.throws(
    () => client.replaceOwnedPets([first.ownedPetId, second.ownedPetId], '005'),
    /injected insert failure/,
  );
  assert.deepEqual(client.listOwnedPets(), before);
  database.exec('DROP TRIGGER reject_pet_insert');
  client.setActivePet(first.ownedPetId);
  assert.throws(() => client.replaceOwnedPets([first.ownedPetId], '005'));
  assert.equal(client.countOwnedPets(), 2);
});

test('여러 마리 생성 중 실패해도 일부 개체가 남지 않는다', async (t) => {
  const { database, client } = await fixture(t);
  assert.throws(() => client.createOwnedPets(['003', 'missing']));
  assert.equal(client.countOwnedPets(), 0);
  database.exec(`CREATE TRIGGER reject_second_pet BEFORE INSERT ON owned_pets
    WHEN NEW.species_id = '004' BEGIN SELECT RAISE(ABORT, 'second insert failed'); END`);
  assert.throws(() => client.createOwnedPets(['003', '004']), /second insert failed/);
  assert.equal(client.countOwnedPets(), 0);
});

test('잘못된 성장 값·없는 개체·DB 실패를 정상 결과로 숨기지 않는다', async (t) => {
  const { database, client } = await fixture(t);
  const [pet] = client.createOwnedPets(['003']);
  const growth = { level: 1, totalXp: 0, xpIntoLevel: 0, evolutionStage: 0 };
  for (const patch of [
    { level: 0 },
    { level: 1.5 },
    { totalXp: -1 },
    { totalXp: NaN },
    { totalXp: Number.MAX_SAFE_INTEGER + 1 },
    { xpIntoLevel: Infinity },
    { evolutionStage: 3 },
  ]) {
    assert.throws(() => client.updateGrowth(pet.ownedPetId, { ...growth, ...patch }));
    assert.deepEqual(client.getOwnedPet(pet.ownedPetId), pet);
  }
  assert.throws(() => client.updateGrowth('missing', growth));
  assert.throws(() => client.updateNickname('missing', '모찌'));
  assert.throws(() => client.listSpecies('INVALID'));
  database.close();
  assert.throws(() => client.getActivePet());
  assert.throws(() => client.countOwnedPets());
  assert.throws(() => client.listOwnedPets());
});

test('기존 성장 DB에 pet migration을 추가해도 기존 데이터는 보존된다', async (t) => {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-pet-upgrade-'));
  const filePath = join(directory, 'petto.sqlite');
  let database = new SqliteFileDatabase({
    filePath,
    migrations: APP_MIGRATIONS.filter((migration) => migration.scope !== 'pet'),
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.open();
  database.exec(
    `INSERT INTO pet_profiles VALUES ('mole_digger', '기존 펫', 7, 3, 63, 0, 9000, 3, '2026-09-13')`,
  );
  database.close();
  database = new SqliteFileDatabase({ filePath, migrations: APP_MIGRATIONS });
  database.open();
  const row = database.prepare('SELECT * FROM pet_profiles').get();
  assert.equal(row.display_name, '기존 펫');
  assert.equal(row.total_xp, 63);
  assert.equal(row.token_bank, 9000);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM pet_species').get().count, 6);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM owned_pets').get().count, 0);
});

test('pet migration 실패 시 테이블과 seed가 rollback되고 다음 실행에 재적용된다', async (t) => {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { PET_MIGRATIONS } = await import('../dist/main/persistence/migrations/pet.js');
  const directory = mkdtempSync(join(tmpdir(), 'petto-pet-migration-failure-'));
  const filePath = join(directory, 'petto.sqlite');
  const first = PET_MIGRATIONS[0];
  let database = new SqliteFileDatabase({
    filePath,
    migrations: [
      {
        ...first,
        up(db) {
          first.up(db);
          throw new Error('injected migration failure');
        },
      },
    ],
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.throws(() => database.open(), /injected migration failure/);
  database = new SqliteFileDatabase({ filePath });
  database.open();
  assert.equal(
    database.prepare("SELECT name FROM sqlite_master WHERE name = 'pet_species'").get(),
    undefined,
  );
  assert.equal(
    database.prepare("SELECT * FROM schema_migrations WHERE scope = 'pet'").get(),
    undefined,
  );
  database.close();
  database = new SqliteFileDatabase({ filePath, migrations: PET_MIGRATIONS });
  database.open();
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM pet_species').get().count, 6);
});
