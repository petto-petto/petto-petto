import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OwnedPet, PetClient } from '@pet/client';

import {
  PetBattleIntegration,
  type BattleCommand,
  type BattleGateway,
  type BattleResult,
} from '../src/index.ts';

const activePet: OwnedPet = {
  ownedPetId: 'owned-001',
  speciesId: '001',
  name: '도토리다람쥐',
  nickname: '토리',
  rarity: 'EPIC',
  sprite: 'acorn_squirrel',
  level: 12,
  totalXp: 4_200,
  xpIntoLevel: 180,
  evolutionStage: 1,
  isActive: true,
};

const result: BattleResult = {
  state: {
    activePet: null,
    roster: [],
    enemyHpRatio: 1,
    enemyColor: 'RED',
    background: 'MUSHROOM_FOREST',
    overlay: null,
    preview: {
      displayOpacity: 1,
      menu: 'CLOSED',
      petAction: null,
      enemyAction: null,
      enemyPhase: 'VISIBLE',
      enemySize: null,
      enemyColor: null,
      enemyHpRatio: null,
      petAssetRarity: null,
      attackEffectRarity: null,
      reducedMotion: false,
    },
  },
  events: [],
};

class RecordingGateway implements BattleGateway {
  readonly commands: BattleCommand[] = [];

  async execute(command: BattleCommand): Promise<BattleResult> {
    this.commands.push(command);
    return result;
  }
}

function petClient(pet: OwnedPet | null): PetClient {
  return {
    getActivePet: () => pet,
  } as PetClient;
}

test('PetClient 활성 펫을 전투 메타데이터와 active pet으로 순서대로 동기화한다', async () => {
  const gateway = new RecordingGateway();
  const integration = new PetBattleIntegration(petClient(activePet), gateway);

  await integration.syncActivePet(1_000);

  assert.deepEqual(gateway.commands, [
    {
      type: 'UPSERT_PET',
      petId: 'owned-001',
      displayName: '토리',
      rarity: 'EPIC',
      level: 12,
      sprite: 'acorn_squirrel',
      evolutionStage: 1,
    },
    { type: 'SET_ACTIVE_PET', petId: 'owned-001' },
  ]);
});

test('성장 XP 알림은 저장된 활성 펫 ID 기준으로 전투 HP 입력에 전달한다', async () => {
  const gateway = new RecordingGateway();
  const integration = new PetBattleIntegration(petClient(activePet), gateway);

  await integration.applyGrowthXp({ ownedPetId: 'owned-001', amount: 35, nowMs: 2_000 });

  assert.deepEqual(gateway.commands.at(-1), {
    type: 'GROWTH_XP_ADDED',
    petId: 'owned-001',
    amount: 35,
    nowMs: 2_000,
  });
});

test('다른 펫의 XP 알림은 현재 전투에 적용하지 않는다', async () => {
  const gateway = new RecordingGateway();
  const integration = new PetBattleIntegration(petClient(activePet), gateway);

  const applied = await integration.applyGrowthXp({
    ownedPetId: 'owned-other',
    amount: 35,
    nowMs: 2_000,
  });

  assert.equal(applied, null);
  assert.deepEqual(gateway.commands, []);
});
