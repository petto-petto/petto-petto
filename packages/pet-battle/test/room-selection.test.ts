import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OwnedPet } from '@pet/client';
import { roomPetViews, seedCollection, withActivePet } from '@pet/room';
import { PetBattleIntegration, type BattleCommand, type BattleGateway } from '../src/index.ts';
import { DemoBattleGateway } from '../src/testing/demo-gateway.ts';

function fixture() {
  let collection = seedCollection();
  let owned: OwnedPet[] = [];
  let failure: Error | undefined;
  const commands: BattleCommand[] = [];
  const client = {
    getActivePet() {
      throw new Error('must not read shared active when a room selection is provided');
    },
    listOwnedPets() {
      if (failure) throw failure;
      return owned;
    },
    readOwnedPetGrowth() {
      return new Map();
    },
  };
  const selection = {
    getSnapshot() {
      const pets = roomPetViews(collection);
      return { pets, activePetId: collection.activePetId || null };
    },
  };
  const demo = new DemoBattleGateway();
  const engine: BattleGateway = {
    execute(command) {
      commands.push(command);
      return demo.execute({ type: 'GET_STATE', nowMs: 0 });
    },
  };
  const integration = new PetBattleIntegration(
    client,
    engine,
    {
      intervalLevels: { COMMON: 12, RARE: 10, EPIC: 8 },
      levelXpCosts: Array(50).fill(10),
    },
    selection,
  );
  return {
    client,
    selection,
    commands,
    integration,
    select(id: string) {
      collection = withActivePet(collection, id);
    },
    clear() {
      collection = { ...collection, activePetId: '' };
    },
    empty() {
      collection = { pets: [], activePetId: '' };
    },
    setOwned(value: OwnedPet[]) {
      owned = value;
    },
    fail(value?: Error) {
      failure = value;
    },
    sync() {
      const sync = commands.findLast((c) => c.type === 'SYNC_OWNED_PETS');
      assert.ok(sync);
      return sync;
    },
  };
}

function owner(ownedPetId: string): OwnedPet {
  return {
    ownedPetId,
    speciesId: '006',
    name: '별빛마법사',
    nickname: '실제 개체',
    sprite: 'star_wizard',
    rarity: 'EPIC',
    level: 30,
    evolutionStage: 1,
    totalXp: 100,
    xpIntoLevel: 2,
    isActive: false,
  };
}

test('room selection reaches battle even when shared roster is empty, without inventing XP', async () => {
  const f = fixture();
  const result = await f.integration.syncActivePet();
  assert.equal(f.sync().activePetId, 'seed-006');
  const wizard = f.sync().pets.find((p) => p.petId === 'seed-006');
  assert.equal(wizard?.sprite, 'star_wizard');
  assert.equal(wizard?.level, 16);
  assert.equal(wizard?.evolutionStage, 0);
  assert.equal(wizard?.totalXp, null);
  assert.equal(result.state.growthStatus, 'UNLINKED');
  assert.equal(result.state.selectionSource, 'ROOM');
  f.select('seed-001');
  await f.integration.syncActivePet();
  assert.equal(f.sync().activePetId, 'seed-001');
  assert.equal(f.sync().pets.find((p) => p.petId === 'seed-001')?.sprite, 'mole_digger');
  assert.ok(!f.sync().spectatorPetIds.includes('seed-001'));
});

test('exact ID uses full committed growth and does not borrow a same-species shared active pet', async () => {
  const f = fixture();
  const exact = Object.freeze(owner('seed-006'));
  const other = Object.freeze({ ...owner('another-wizard'), totalXp: 99999, isActive: true });
  f.setOwned([other, exact]);
  const result = await f.integration.syncActivePet();
  assert.equal(result.state.growthStatus, 'LINKED');
  const wizard = f.sync().pets.find((p) => p.petId === 'seed-006');
  assert.equal(wizard?.displayName, '실제 개체');
  assert.equal(wizard?.level, 30);
  assert.equal(wizard?.evolutionStage, 1);
  assert.equal(wizard?.totalXp, 100);
  f.setOwned([other]);
  assert.equal((await f.integration.syncActivePet()).state.growthStatus, 'UNLINKED');
  assert.equal(f.sync().pets.find((p) => p.petId === 'seed-006')?.totalXp, null);
});

test('same ID with conflicting species is an error, not an XP link', async () => {
  const f = fixture();
  f.setOwned([{ ...owner('seed-006'), speciesId: '003', sprite: 'mole_digger' }]);
  await assert.rejects(f.integration.syncActivePet(), /개체.*불일치/);
  assert.equal(f.commands.length, 0);
  f.setOwned([{ ...owner('seed-006'), sprite: 'mole_digger' }]);
  await assert.rejects(f.integration.syncActivePet(), /개체.*불일치/);
  assert.equal(f.commands.length, 0);
});

test('an invalid room selection fails before reaching the engine', async () => {
  const f = fixture();
  f.selection.getSnapshot = () => ({ pets: [], activePetId: 'missing' });
  await assert.rejects(f.integration.syncActivePet(), /활성 개체.*명부/);
  assert.equal(f.commands.length, 0);
});

test('room no-selection and empty roster never fall back to shared active', async () => {
  const f = fixture();
  f.setOwned([owner('another-wizard')]);
  f.clear();
  assert.equal((await f.integration.syncActivePet()).state.growthStatus, null);
  assert.equal(f.sync().activePetId, null);
  f.empty();
  await f.integration.syncActivePet();
  assert.deepEqual(f.sync().pets, []);
});

test('shared/room failures propagate and a later healthy request recovers', async () => {
  const f = fixture();
  f.fail(new Error('shared read failed'));
  await assert.rejects(f.integration.syncActivePet(), /shared read failed/);
  assert.equal(f.commands.length, 0);
  f.fail();
  await f.integration.syncActivePet();
  f.selection.getSnapshot = () => {
    throw new Error('room read failed');
  };
  const before = f.commands.length;
  await assert.rejects(f.integration.syncActivePet(), /room read failed/);
  assert.equal(f.commands.length, before);
});

test('growth notifications follow room identity, re-read committed totals and never write XP', async () => {
  const f = fixture();
  f.setOwned([owner('seed-006')]);
  assert.notEqual(
    await f.integration.applyGrowthXp({ ownedPetId: 'seed-006', amount: 900, nowMs: 0 }),
    null,
  );
  assert.equal(f.sync().pets.find((p) => p.petId === 'seed-006')?.totalXp, 100);
  f.select('seed-001');
  assert.equal(
    await f.integration.applyGrowthXp({ ownedPetId: 'seed-006', amount: 900, nowMs: 0 }),
    null,
  );
  f.clear();
  assert.equal(
    await f.integration.applyGrowthXp({ ownedPetId: 'seed-006', amount: 900, nowMs: 0 }),
    null,
  );
  assert.ok(f.commands.every((c) => c.type !== 'GROWTH_XP_ADDED'));
});
