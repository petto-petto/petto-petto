import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BATTLE_CHANNELS,
  RustBattleClient,
  battleHandlers,
  type BattleCommand,
  type BattleGateway,
  type BattleState,
  type JsonLineTransport,
} from '../src/index.ts';

class FakeTransport implements JsonLineTransport {
  readonly sent: string[] = [];
  private listener: ((line: string) => void) | undefined;

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(listener: (line: string) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  reply(line: string): void {
    this.listener?.(line);
  }
}

test('Rust 클라이언트는 requestId로 JSON-lines 응답을 원 요청과 연결한다', async () => {
  const transport = new FakeTransport();
  const client = new RustBattleClient(transport, () => 'request-1');
  const pending = client.execute({ type: 'GET_STATE', nowMs: 1200 });

  assert.deepEqual(JSON.parse(transport.sent[0] ?? ''), {
    requestId: 'request-1',
    command: { type: 'GET_STATE', nowMs: 1200 },
  });

  transport.reply(
    JSON.stringify({
      requestId: 'request-1',
      ok: true,
      state: { marker: 'state-from-rust' },
      events: [],
    }),
  );
  assert.deepEqual(await pending, {
    state: { marker: 'state-from-rust' },
    events: [],
  });
});

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
