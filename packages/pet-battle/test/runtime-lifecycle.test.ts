import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import type { BattleCommand, BattleResult } from '../src/contracts.ts';
import { mountBattleIpc, type BattleIpcRegistry, type BattleRuntime } from '../src/ipc/host.ts';

const command: BattleCommand = { type: 'GET_STATE', nowMs: 100 };
const response = { marker: 'ready runtime' } as unknown as BattleResult;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let handler!: Parameters<BattleIpcRegistry['handle']>[1];
  let removed = 0;
  const quits = new Set<() => void>();
  const closes = new Set<() => void>();
  return {
    ipc: {
      handle(_channel, registered) {
        handler = registered;
      },
      removeHandler() {
        removed++;
      },
    } satisfies BattleIpcRegistry,
    lifecycle: {
      onQuit(listener: () => void) {
        quits.add(listener);
        return () => quits.delete(listener);
      },
      onWindowClosed(listener: () => void) {
        closes.add(listener);
        return () => closes.delete(listener);
      },
    },
    invoke(value: BattleCommand = command, sender = 7) {
      return handler({ sender: { id: sender } }, value);
    },
    quit: () => [...quits].forEach((listener) => listener()),
    closeWindow: () => [...closes].forEach((listener) => listener()),
    removed: () => removed,
    subscriptions: () => quits.size + closes.size,
  };
}

function runtime() {
  const commands: BattleCommand[] = [];
  let closes = 0;
  return {
    value: {
      async execute(value) {
        commands.push(value);
        return response;
      },
      close() {
        closes++;
      },
    } satisfies BattleRuntime,
    commands,
    closes: () => closes,
  };
}

test('비동기 준비는 승인된 동시 요청 하나가 공유하고 요청 순서를 보존한다', async () => {
  const host = fixture();
  const build = deferred<BattleRuntime>();
  const engine = runtime();
  let prepares = 0;
  const dispose = mountBattleIpc(
    host.ipc,
    () => {
      prepares++;
      return build.promise;
    },
    (id) => id === 7,
  );
  try {
    assert.equal(prepares, 0);
    assert.throws(() => host.invoke(command, 99), /전투 창/);
    await assert.rejects(host.invoke({ type: 'UPSERT_PET' } as BattleCommand), /허용하지/);
    assert.equal(prepares, 0);

    const later: BattleCommand = { type: 'GET_STATE', nowMs: 200 };
    const first = host.invoke();
    const second = host.invoke(later);
    assert.equal(prepares, 1);
    assert.deepEqual(engine.commands, []);
    build.resolve(engine.value);

    assert.deepEqual(await Promise.all([first, second]), [response, response]);
    assert.deepEqual(engine.commands, [command, later]);
  } finally {
    dispose();
  }
  assert.equal(engine.closes(), 1);
});

test('비동기 준비 실패는 모든 요청에 전파되며 다음 요청에서 재시도한다', async () => {
  const host = fixture();
  const build = deferred<BattleRuntime>();
  const engine = runtime();
  const failure = new Error('Cargo build failed');
  let prepares = 0;
  const dispose = mountBattleIpc(
    host.ipc,
    () => (++prepares === 1 ? build.promise : Promise.resolve(engine.value)),
    () => true,
  );
  try {
    const first = assert.rejects(host.invoke(), (error) => error === failure);
    const second = assert.rejects(host.invoke(), (error) => error === failure);
    build.reject(failure);
    await Promise.all([first, second]);
    assert.equal(await host.invoke(), response);
    assert.equal(prepares, 2);
  } finally {
    dispose();
  }
});

test('앱 종료는 준비를 즉시 취소하고 늦게 반환된 runtime도 실행 없이 닫는다', async () => {
  const host = fixture();
  const build = deferred<BattleRuntime>();
  const engine = runtime();
  let signal: AbortSignal | undefined;
  const dispose = mountBattleIpc(
    host.ipc,
    (receivedSignal: AbortSignal) => {
      signal = receivedSignal;
      return build.promise;
    },
    () => true,
    host.lifecycle,
  );
  const rejected = assert.rejects(host.invoke(), /종료|취소/);
  host.quit();
  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(host.removed(), 1);
  assert.equal(host.subscriptions(), 0);
  assert.throws(() => host.invoke(), /종료/);
  build.resolve(engine.value);
  await nextTurn();
  assert.equal(engine.closes(), 1);
  assert.deepEqual(engine.commands, []);
  dispose();
  assert.equal(host.removed(), 1);
});

test('준비 중 창 닫기는 늦은 생성을 폐기하고 재개한 요청은 새 준비를 시작한다', async () => {
  const host = fixture();
  const staleBuild = deferred<BattleRuntime>();
  const stale = runtime();
  const current = runtime();
  let prepares = 0;
  let firstSignal: AbortSignal | undefined;
  const dispose = mountBattleIpc(
    host.ipc,
    (signal: AbortSignal) => {
      prepares++;
      if (prepares === 1) {
        firstSignal = signal;
        return staleBuild.promise;
      }
      return Promise.resolve(current.value);
    },
    () => true,
    host.lifecycle,
  );
  try {
    const rejected = assert.rejects(host.invoke(), /종료|취소/);
    host.closeWindow();
    await rejected;
    assert.equal(firstSignal?.aborted, true);
    assert.equal(host.removed(), 0);
    assert.equal(await host.invoke(), response);
    staleBuild.resolve(stale.value);
    await nextTurn();
    assert.equal(stale.closes(), 1);
    assert.deepEqual(stale.commands, []);
    assert.equal(current.closes(), 0);
    assert.equal(prepares, 2);
  } finally {
    dispose();
  }
  assert.equal(current.closes(), 1);
});

test('준비된 창을 닫았다 열면 preview와 STOP 상태를 가진 runtime을 재사용한다', async () => {
  const host = fixture();
  const engine = runtime();
  let creates = 0;
  const dispose = mountBattleIpc(
    host.ipc,
    () => {
      creates++;
      return engine.value;
    },
    () => true,
    host.lifecycle,
  );
  try {
    assert.equal(await host.invoke(), response);
    host.closeWindow();
    assert.equal(await host.invoke(), response);
    assert.equal(creates, 1);
    assert.equal(engine.closes(), 0);
    host.quit();
    assert.equal(engine.closes(), 1);
    assert.equal(host.subscriptions(), 0);
  } finally {
    dispose();
  }
});
