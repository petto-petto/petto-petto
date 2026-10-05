import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OwnedPet, PetClient, PetSpecies, Rarity } from '@pet/client';
import { PetClientRoomAdapter, type RoomPetReadClient } from '@pet/room';

function fixture(): {
  pets: OwnedPet[];
  client: PetClient;
  reader: RoomPetReadClient;
} {
  const pets: OwnedPet[] = [0, 1, 2].map((index) => ({
    ownedPetId: `owned-${index}`,
    speciesId: '006',
    name: '별빛마법사',
    nickname: index === 1 ? '둘째' : null,
    rarity: 'EPIC',
    sprite: 'star_wizard',
    level: 25,
    totalXp: 384,
    xpIntoLevel: 12,
    evolutionStage: index as 0 | 1 | 2,
    isActive: index === 0,
  }));
  const unused = (): never => {
    throw new Error('room must not use unrelated pet operations');
  };
  const client: PetClient = {
    listSpecies: unused,
    countSpecies: unused,
    listOwnedPets: () => pets.map((pet) => ({ ...pet })),
    getOwnedPet: unused,
    countOwnedPets: unused,
    countOwnedSpecies: unused,
    getHighestLevel: unused,
    getActivePet: () => pets.find((pet) => pet.isActive) ?? null,
    createOwnedPets: unused,
    updateNickname: unused,
    updateGrowth: unused,
    setActivePet(ownedPetId) {
      const selected = pets.find((pet) => pet.ownedPetId === ownedPetId);
      if (!selected) throw new Error('unknown owned pet');
      pets.forEach((pet) => {
        pet.isActive = pet === selected;
      });
      return { ...selected };
    },
    replaceOwnedPets: unused,
  };
  return { pets, client, reader: new PetClientRoomAdapter(client) };
}

test('room read adapter accepts a source with only owner read capabilities', () => {
  const source: RoomPetReadClient = {
    getActivePet: () => null,
    listOwnedPets: () => [],
    listSpecies: () => [],
  };
  const reader = new PetClientRoomAdapter(source);

  assert.equal(reader.getActivePet(), null);
  assert.deepEqual(reader.listOwnedPets(), []);
  assert.deepEqual(reader.listSpecies(), []);
});

test('room read adapter exposes no UI selection or owner growth writer', () => {
  const { reader } = fixture();
  assert.equal(Reflect.has(reader, 'selectActivePet'), false);
  assert.equal(Reflect.has(reader, 'setActivePet'), false);
  assert.equal(Reflect.has(reader, 'updateGrowth'), false);
});

test('room read client preserves full growth and duplicate-species identities without owner mutations', () => {
  const { pets, client, reader } = fixture();
  pets.forEach((pet, index) => {
    pet.totalXp += index * 100;
    pet.xpIntoLevel += index;
    Object.freeze(pet);
  });
  Object.freeze(pets);
  const before = structuredClone(pets);
  client.setActivePet = () => assert.fail('reading must not change the owner selection');

  const ownerRead: Pick<PetClient, 'getActivePet' | 'listOwnedPets' | 'listSpecies'> = reader;
  const publishedRead: RoomPetReadClient = ownerRead;
  assert.deepEqual(publishedRead.listOwnedPets(), before);
  assert.deepEqual(publishedRead.getActivePet(), before[0]);
  assert.deepEqual(pets, before);
});

test('room read client observes fresh owner selection and growth without caching the UI projection', () => {
  const { pets, client, reader } = fixture();
  assert.equal(reader.getActivePet()?.ownedPetId, 'owned-0');
  client.setActivePet('owned-1');
  const selected = pets.find((pet) => pet.ownedPetId === 'owned-1');
  assert.ok(selected);
  Object.assign(selected, {
    nickname: '성장한 둘째',
    level: 26,
    totalXp: 941,
    xpIntoLevel: 9,
    evolutionStage: 2,
  });

  assert.deepEqual(reader.getActivePet(), selected);
  assert.deepEqual(reader.listOwnedPets(), pets);
  assert.equal(reader.getActivePet()?.totalXp, 941);
  assert.equal(reader.getActivePet()?.evolutionStage, 2);
});

test('room read client distinguishes no selection from an empty owner roster', () => {
  const { pets, reader } = fixture();
  pets.forEach((pet) => {
    pet.isActive = false;
  });
  assert.equal(reader.getActivePet(), null);
  assert.deepEqual(reader.listOwnedPets(), pets);
  assert.equal(reader.listOwnedPets().length, 3);

  pets.splice(0);
  assert.deepEqual(reader.listOwnedPets(), []);
  assert.equal(reader.getActivePet(), null);
});

test('room read client forwards the optional species filter without collapsing duplicate owners', () => {
  const { pets, client, reader } = fixture();
  const filters: (string | undefined)[] = [];
  client.listOwnedPets = (speciesId) => {
    filters.push(speciesId);
    return pets.filter((pet) => speciesId === undefined || pet.speciesId === speciesId);
  };

  assert.deepEqual(reader.listOwnedPets(), pets);
  assert.deepEqual(reader.listOwnedPets('006'), pets);
  assert.deepEqual(reader.listOwnedPets('missing'), []);
  assert.deepEqual(filters, [undefined, '006', 'missing']);
});

test('room read client forwards catalog rarity filters and returns the owner species unchanged', () => {
  const { client, reader } = fixture();
  const species: PetSpecies[] = [
    { speciesId: '003', name: '두더지', rarity: 'COMMON', sprite: 'mole_digger' },
    { speciesId: '005', name: '볼주머니햄', rarity: 'RARE', sprite: 'cheek_hamster' },
    { speciesId: '006', name: '별빛마법사', rarity: 'EPIC', sprite: 'star_wizard' },
  ];
  const filters: (Rarity | undefined)[] = [];
  client.listSpecies = (rarity) => {
    filters.push(rarity);
    return species.filter((pet) => rarity === undefined || pet.rarity === rarity);
  };

  assert.deepEqual(reader.listSpecies(), species);
  for (const rarity of ['COMMON', 'RARE', 'EPIC'] as const) {
    assert.deepEqual(
      reader.listSpecies(rarity),
      species.filter((pet) => pet.rarity === rarity),
    );
  }
  assert.deepEqual(filters, [undefined, 'COMMON', 'RARE', 'EPIC']);
});

for (const method of ['getActivePet', 'listOwnedPets', 'listSpecies'] as const) {
  test(`room read client propagates ${method} errors instead of empty results`, () => {
    const { pets, client, reader } = fixture();
    const before = structuredClone(pets);
    const failure = new Error(`${method} failed`);
    client[method] = () => {
      throw failure;
    };

    const read = () => reader[method]();
    assert.throws(read, (error) => error === failure);
    assert.deepEqual(pets, before);
  });
}
