import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PetClient } from '@pet/client';
import type { OwnedPet } from '@pet/client';
import * as battle from '../src/index.ts';
import { DemoBattleGateway } from '../src/testing/demo-gateway.ts';

test('개체 ID가 같아도 진화 단계나 종류가 바뀌면 응원 후보를 갱신한다', async () => {
  const active: OwnedPet = {
    ownedPetId: 'active',
    speciesId: '003',
    name: '두더지',
    nickname: null,
    rarity: 'COMMON',
    sprite: 'mole_digger',
    level: 1,
    totalXp: 0,
    xpIntoLevel: 0,
    evolutionStage: 1,
    isActive: true,
  };
  const candidate: OwnedPet = { ...active, ownedPetId: 'candidate', isActive: false };
  const commands: battle.BattleCommand[] = [];
  const demo = new DemoBattleGateway();
  const gateway = new battle.OwnedPetBattleGateway(
    { getActivePet: () => active, listOwnedPets: () => [active, candidate] },
    {
      execute(command) {
        commands.push(command);
        return demo.execute({ type: 'GET_STATE', nowMs: 0 });
      },
    },
    { levelXpCosts: [10], intervalLevels: { COMMON: 2, RARE: 2, EPIC: 3 } },
  );
  async function selected() {
    await gateway.execute({ type: 'GET_STATE', nowMs: 0 });
    const sync = commands.at(-2);
    assert.equal(sync?.type, 'SYNC_OWNED_PETS');
    return sync?.type === 'SYNC_OWNED_PETS' ? sync.spectatorPetIds : [];
  }
  assert.deepEqual(await selected(), []);
  candidate.evolutionStage = 0;
  assert.deepEqual(await selected(), ['candidate']);
  active.evolutionStage = 0;
  assert.deepEqual(await selected(), []);
  candidate.sprite = 'cat';
  assert.deepEqual(await selected(), ['candidate']);
});

test('앱 전투 조회는 저장된 펫 XP를 동기화하고 원시 토큰·임의 XP 명령은 받지 않는다', async () => {
  const commands: battle.BattleCommand[] = [];
  const demo = new DemoBattleGateway();
  const pet = {
    ownedPetId: 'owned',
    speciesId: '003',
    name: '두더지',
    nickname: null,
    rarity: 'COMMON',
    sprite: 'mole_digger',
    level: 13,
    totalXp: 156,
    xpIntoLevel: 0,
    evolutionStage: 0,
    isActive: true,
  } as const;
  const pets = {
    getActivePet: () => pet,
    listOwnedPets: () => [pet],
  } satisfies Pick<PetClient, 'getActivePet' | 'listOwnedPets'>;
  const gateway = new battle.OwnedPetBattleGateway(
    pets,
    {
      execute(command) {
        commands.push(command);
        return demo.execute({ type: 'GET_STATE', nowMs: 0 });
      },
    },
    {
      levelXpCosts: Array.from({ length: 50 }, (_, i) => 10 + Math.floor((i + 1) / 2)),
      intervalLevels: { COMMON: 12, RARE: 10, EPIC: 8 },
    },
  );
  await gateway.execute({ type: 'GET_STATE', nowMs: 100 });
  assert.equal(commands[0]?.type, 'SYNC_OWNED_PETS');
  assert.equal(commands[0]?.type === 'SYNC_OWNED_PETS' && commands[0].pets[0]?.totalXp, 156);
  await assert.rejects(
    gateway.execute({ type: 'GROWTH_XP_ADDED', petId: 'owned', amount: 900, nowMs: 100 }),
    /허용/,
  );
});
