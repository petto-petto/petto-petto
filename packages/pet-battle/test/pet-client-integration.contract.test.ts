import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OwnedPet, PetClient } from '@pet/client';
import { PetBattleIntegration, type BattleCommand, type BattleGateway, type BattleGrowthRules } from '../src/index.ts';
import { DemoBattleGateway } from '../src/ui/demo-gateway.ts';

const pet: OwnedPet = {
  ownedPetId:'owned-001',speciesId:'003',name:'두더지',nickname:'토리',rarity:'COMMON',
  sprite:'mole_digger',level:13,totalXp:156,xpIntoLevel:0,evolutionStage:0,isActive:true,
};
const rules: BattleGrowthRules = {
  levelXpCosts:Array.from({length:50},(_,i) => 10 + Math.floor((i+1)/2)),
  intervalLevels:{COMMON:12,RARE:10,EPIC:8},
};

function fixture(active: OwnedPet | null = pet) {
  const commands: BattleCommand[] = [];
  const writes: string[] = [];
  const demo = new DemoBattleGateway();
  const client = new Proxy({
    getActivePet:() => active, listOwnedPets:() => active ? [active] : [],
  }, {
    get(target,key) {
      if (key in target) return Reflect.get(target,key);
      return () => {writes.push(String(key)); throw new Error('전투는 공통 데이터에 쓰면 안 됩니다');};
    },
  }) as PetClient;
  const engine: BattleGateway = {execute(command) {
    commands.push(command);
    return demo.execute({type:'GET_STATE',nowMs:0});
  }};
  return { commands, writes, setActive:(value: OwnedPet | null) => {active = value;},
    integration:new PetBattleIntegration(client, engine, rules) };
}

test('공통 PetClient의 저장된 누적 XP와 개체 ID를 읽기 전용으로 동기화한다', async () => {
  const f = fixture();
  await f.integration.syncActivePet();
  assert.equal(f.commands[0]?.type,'SYNC_OWNED_PETS');
  if (f.commands[0]?.type !== 'SYNC_OWNED_PETS') throw new Error('누적 XP 동기화 필요');
  assert.equal(f.commands[0].pets[0]?.totalXp,156);
  assert.equal(f.commands[0].activePetId,'owned-001');
  assert.equal(f.commands[0].pets[0]?.displayName,'토리');
  assert.deepEqual(f.writes,[]);
});

test('활성이 없어지면 이전 전투 펫과 명부를 지우고 임의 생성하지 않는다', async () => {
  const f = fixture();
  await f.integration.syncActivePet();
  f.setActive(null);
  f.commands.length = 0;
  await f.integration.syncActivePet();
  assert.equal(f.commands[0]?.type,'SYNC_OWNED_PETS');
  if (f.commands[0]?.type !== 'SYNC_OWNED_PETS') throw new Error('명부 동기화 필요');
  assert.equal(f.commands[0].activePetId,null);
  assert.deepEqual(f.commands[0].pets,[]);
  assert.deepEqual(f.writes,[]);
});

test('성장 알림은 저장값 재조회 신호이며 알림 amount를 중복 가산하지 않는다', async () => {
  const f = fixture();
  await f.integration.syncActivePet();
  f.setActive({...pet,totalXp:160,xpIntoLevel:4});
  for (let i=0;i<2;i++) await f.integration.applyGrowthXp({ownedPetId:pet.ownedPetId,amount:99999,nowMs:0});
  const syncs = f.commands.filter(c => c.type === 'SYNC_OWNED_PETS');
  assert.equal(syncs.at(-1)?.pets[0]?.totalXp,160);
  assert.equal(f.commands.some(c => c.type === 'GROWTH_XP_ADDED'),false);
  assert.deepEqual(f.writes,[]);
});

test('다른 펫의 알림은 활성 전투에 적용하지 않는다', async () => {
  const f = fixture();
  assert.equal(await f.integration.applyGrowthXp({ownedPetId:'other',amount:1,nowMs:0}),null);
  assert.deepEqual(f.commands,[]);
});

test('공통 조회 실패를 미보유로 바꾸지 않고 다음 정상 요청은 회복한다', async () => {
  let broken = true;
  const client = {
    getActivePet:() => {if (broken) throw new Error('read failed'); return pet;},
    listOwnedPets:() => [pet],
  } as PetClient;
  const integration = new PetBattleIntegration(client,new DemoBattleGateway(),rules);
  await assert.rejects(integration.syncActivePet(),/read failed/);
  broken = false;
  await integration.syncActivePet();
});
