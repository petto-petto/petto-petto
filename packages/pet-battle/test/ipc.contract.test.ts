import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BATTLE_CHANNELS,
  battleHandlers,
  type BattleCommand,
  type BattleGateway,
  type BattleState,
} from '../src/index.ts';

test('feature 패키지가 자기 Electron IPC 채널과 핸들러를 모두 소유한다', async () => {
  const commands: BattleCommand[] = [];
  const gateway: BattleGateway = {
    async execute(command) {
      commands.push(command);
      return { state: {} as BattleState, events: [] };
    },
  };
  const broadcasts: string[] = [];
  const handlers = battleHandlers(gateway, {
    broadcast(channel) {
      broadcasts.push(channel);
    },
  });

  assert.deepEqual(Object.keys(handlers).sort(), Object.values(BATTLE_CHANNELS).sort());
  await handlers[BATTLE_CHANNELS.command]?.({ type: 'TOGGLE_BATTLE' });
  assert.deepEqual(commands, [{ type: 'TOGGLE_BATTLE' }]);
  assert.deepEqual(broadcasts, [BATTLE_CHANNELS.stateChanged]);
});
