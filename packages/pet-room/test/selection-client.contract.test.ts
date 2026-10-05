import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomSelectionAdapter } from '@pet/room';
import { collectionFromRecords, roomPetViews, withActivePet } from '../src/domain/pet.ts';

function sampleCollection() {
  return collectionFromRecords([
    {
      ownedPetId: 'seed-001',
      speciesId: '003',
      level: 3,
      evolutionStage: 0,
      nickname: null,
      isActive: false,
    },
    {
      ownedPetId: 'seed-006',
      speciesId: '006',
      level: 16,
      evolutionStage: 0,
      nickname: null,
      isActive: true,
    },
  ]).collection;
}

test('selection adapter reads the live room snapshot without requiring a store or writer', () => {
  let collection = sampleCollection();
  const source = () => roomPetViews(collection);
  const reader = new RoomSelectionAdapter(source);
  assert.equal(reader.getSnapshot().activePetId, 'seed-006');
  collection = withActivePet(collection, 'seed-001');
  const snapshot = reader.getSnapshot();
  assert.equal(snapshot.activePetId, 'seed-001');
  assert.equal(snapshot.pets[0]?.slug, 'mole_digger');
  assert.equal(snapshot.pets[0]?.level, 3);
  assert.deepEqual(source(), snapshot.pets);
  assert.equal(Reflect.has(reader, 'setActivePet'), false);
});

test('selection adapter distinguishes no selection, empty roster, and read errors', () => {
  const views = roomPetViews(sampleCollection()).map((pet) => ({ ...pet, isActive: false }));
  assert.equal(new RoomSelectionAdapter(() => views).getSnapshot().activePetId, null);
  assert.equal(new RoomSelectionAdapter(() => views).getSnapshot().pets.length, 2);
  assert.deepEqual(new RoomSelectionAdapter(() => []).getSnapshot(), {
    pets: [],
    activePetId: null,
  });
  const failure = new Error('room read failed');
  assert.throws(
    () =>
      new RoomSelectionAdapter(() => {
        throw failure;
      }).getSnapshot(),
    (e) => e === failure,
  );
});

test('selection adapter snapshots do not expose mutable room view objects', () => {
  const views = roomPetViews(sampleCollection());
  const snapshot = new RoomSelectionAdapter(() => views).getSnapshot();
  assert.notEqual(snapshot.pets, views);
  assert.notEqual(snapshot.pets[0], views[0]);
});

test('selection adapter rejects duplicate identities and multiple active pets', () => {
  const views = roomPetViews(sampleCollection());
  const first = views[0]!;
  assert.throws(() => new RoomSelectionAdapter(() => [first, first]).getSnapshot(), /중복/);
  assert.throws(
    () =>
      new RoomSelectionAdapter(() => views.map((p) => ({ ...p, isActive: true }))).getSnapshot(),
    /활성/,
  );
});
