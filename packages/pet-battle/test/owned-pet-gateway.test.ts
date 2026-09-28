import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PetClient } from '@pet/client';
import * as battle from '../src/index.ts';
import { DemoBattleGateway } from '../src/ui/demo-gateway.ts';

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
  const pets = { getActivePet: () => pet, listOwnedPets: () => [pet] } as PetClient;
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
