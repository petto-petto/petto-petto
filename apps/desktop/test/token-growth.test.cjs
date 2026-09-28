const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

async function setup(t, directory = mkdtempSync(join(tmpdir(), 'petto-growth-link-'))) {
  const { SqliteFileDatabase } = await import('../dist/main/persistence/sqlite-file.js');
  const { APP_MIGRATIONS } = await import('../dist/main/persistence/migrations/index.js');
  const { SqliteTokenClient } = await import('../dist/main/clients/sqlite-token-client.js');
  const { SqlitePetClient } = await import('../dist/main/clients/sqlite-pet-client.js');
  const { TokenRepository } =
    await import('../dist/main/persistence/repositories/token-repository.js');
  const { PetRepository } = await import('../dist/main/persistence/repositories/pet-repository.js');
  const { TokenGrowthLink } = await import('../dist/main/token-growth.js');
  const db = new SqliteFileDatabase({
    filePath: join(directory, 'petto.sqlite'),
    migrations: APP_MIGRATIONS,
  });
  db.open();
  t.after(() => db.close());
  const tokens = new SqliteTokenClient(new TokenRepository(db));
  const pets = new SqlitePetClient(new PetRepository(db));
  return { db, tokens, pets, directory, link: new TokenGrowthLink(db, tokens, pets) };
}
const usage = (dedupeKey, growthTokens = 5000) => ({
  provider: 'claude_code',
  observed: growthTokens + 3000,
  reward: growthTokens + 1000,
  dedupeKey,
  occurredAt: '2026-09-28T10:00:00.000Z',
});

test('사용량 저장과 활성 펫 XP 지급은 원자적이며 캐시를 XP에 넣지 않는다', async (t) => {
  const { pets, tokens, link } = await setup(t);
  const [pet] = pets.createOwnedPets(['003']);
  pets.setActivePet(pet.ownedPetId);
  link.record(usage('a', 4999), 4999);
  assert.equal(pets.getActivePet().totalXp, 0);
  link.record(usage('b', 1), 1);
  assert.equal(pets.getActivePet().totalXp, 1);
  link.record(usage('b', 1), 1);
  assert.equal(pets.getActivePet().totalXp, 1);
  assert.equal(tokens.recentHistory(10).length, 2);
});

test('재시작 후 잔여 토큰을 보존하고 중복을 지급하지 않는다', async (t) => {
  const first = await setup(t);
  const [pet] = first.pets.createOwnedPets(['001']);
  first.pets.setActivePet(pet.ownedPetId);
  first.link.record(usage('a', 4999), 4999);
  first.db.close();
  const second = await setup(t, first.directory);
  second.link.record(usage('a', 4999), 4999);
  second.link.record(usage('b', 1), 1);
  assert.equal(second.pets.getActivePet().totalXp, 1);
});

test('펫 전환 시 잔여 토큰을 섞지 않고 미보유 때 사용량을 소급 지급하지 않는다', async (t) => {
  const { pets, link } = await setup(t);
  link.record(usage('no-pet'), 5000);
  const [a, b] = pets.createOwnedPets(['001', '003']);
  pets.setActivePet(a.ownedPetId);
  link.record(usage('no-pet'), 5000);
  assert.equal(pets.getActivePet().totalXp, 0);
  link.record(usage('a', 4999), 4999);
  pets.setActivePet(b.ownedPetId);
  link.record(usage('b', 1), 1);
  assert.equal(pets.getActivePet().totalXp, 0);
  pets.setActivePet(a.ownedPetId);
  link.record(usage('c', 1), 1);
  assert.equal(pets.getActivePet().totalXp, 1);
});

test('성장 저장 실패 시 토큰 내역도 rollback되어 재시도가 가능하다', async (t) => {
  const { pets, tokens, db } = await setup(t);
  const { TokenGrowthLink } = await import('../dist/main/token-growth.js');
  const [pet] = pets.createOwnedPets(['003']);
  pets.setActivePet(pet.ownedPetId);
  const broken = {
    getActivePet: () => pets.getActivePet(),
    updateGrowth() {
      throw new Error('disk');
    },
  };
  assert.throws(() => new TokenGrowthLink(db, tokens, broken).record(usage('a'), 5000), /disk/);
  assert.equal(tokens.recentHistory(10).length, 0);
  new TokenGrowthLink(db, tokens, pets).record(usage('a'), 5000);
  assert.equal(pets.getActivePet().totalXp, 1);
});
