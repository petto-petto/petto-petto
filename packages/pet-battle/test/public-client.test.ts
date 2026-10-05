import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BattleClient, BattleClientCommand } from '../src/client.ts';
import type { BattleCommand } from '../src/contracts.ts';
import type { BattleRuntime } from '../src/ports/runtime.ts';
import type { BattleClient as ExportedClient } from '../src/index.ts';
import { DemoBattleGateway } from '../src/testing/demo-gateway.ts';

type Expect<T extends true> = T;
type Forbidden = Extract<
  BattleCommand,
  {
    type:
      | 'SYNC_OWNED_PETS'
      | 'UPSERT_PET'
      | 'SET_ACTIVE_PET'
      | 'SET_PET_SPECTATORS'
      | 'GROWTH_XP_ADDED';
  }
>;
// Compile-time assertions: broad internal commands may not leak into the consumer API.
type _NoOwnerCommands = Expect<
  Extract<BattleClientCommand, Forbidden> extends never ? true : false
>;
type _NoFutureProtocolLeak = Expect<
  Exclude<
    BattleClientCommand['type'],
    | 'GET_STATE'
    | 'TOGGLE_BATTLE'
    | 'SET_BATTLE_RUNNING'
    | 'OVERLAY_CLICK'
    | 'TOGGLE_MENU'
    | 'PREVIEW_PET'
    | 'PREVIEW_ENEMY'
    | 'CYCLE_ENEMY_SIZE'
    | 'CYCLE_ENEMY_COLOR'
    | 'CYCLE_ENEMY_HP'
    | 'SET_DISPLAY_OPACITY'
    | 'CYCLE_PET_ASSET'
    | 'CYCLE_ATTACK_EFFECT'
    | 'TOGGLE_REDUCED_MOTION'
  > extends never
    ? true
    : false
>;
type _RuntimeUsesClient = Expect<
  Parameters<BattleRuntime['execute']>[0] extends BattleClientCommand ? true : false
>;
type _PublicExport = Expect<ExportedClient extends BattleClient ? true : false>;

test('BattleClient는 현재 전투 화면 명령을 전달하며 소유자 쓰기를 계약에서 제외한다', async () => {
  const client: BattleClient = new DemoBattleGateway();
  const commands: BattleClientCommand[] = [
    { type: 'GET_STATE', nowMs: 1000 },
    { type: 'TOGGLE_BATTLE' },
    { type: 'SET_BATTLE_RUNNING', running: false },
    { type: 'OVERLAY_CLICK', nowMs: 1000 },
    { type: 'TOGGLE_MENU', menu: 'PET' },
    { type: 'PREVIEW_PET', action: 'ATTACK', nowMs: 1000 },
    { type: 'PREVIEW_ENEMY', action: 'HIT', nowMs: 1000 },
    { type: 'CYCLE_ENEMY_SIZE' },
    { type: 'CYCLE_ENEMY_COLOR' },
    { type: 'CYCLE_ENEMY_HP' },
    { type: 'SET_DISPLAY_OPACITY', percent: 35 },
    { type: 'CYCLE_PET_ASSET' },
    { type: 'CYCLE_ATTACK_EFFECT' },
    { type: 'TOGGLE_REDUCED_MOTION' },
  ];
  for (const command of commands) assert.ok((await client.execute(command)).state.activePet);
});

test('renderer는 엔진 프로토콜 대신 BattleClient를 소비하고 공개 계약은 런타임 I/O를 불러오지 않는다', () => {
  const renderer = readFileSync(new URL('../src/ui/battle-overlay.ts', import.meta.url), 'utf8');
  assert.match(renderer, /petBattle\?: BattleClient/);
  assert.match(renderer, /const gateway: BattleClient/);
  assert.doesNotMatch(renderer, /\bBattleCommand\b|\bBattleGateway\b/);
  const contract = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(contract, /node:|electron|sqlite|spawnBattle|PetRepository/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.exports['./client'], {
    types: './dist/client.d.ts',
    default: './dist/client.js',
  });
});
