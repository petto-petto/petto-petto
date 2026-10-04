import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { PetClient } from '@pet/client';
import type { BattleCommand, BattleResult } from '../src/contracts.ts';
import {
  createBattleRuntime,
  mountBattle,
  type BattleIpcRegistry,
  type BattleLifecyclePort,
} from '../src/node.ts';

const command: BattleCommand = { type: 'GET_STATE', nowMs: 1234 };
const levelXpCosts = [10, 11, 12] as const;
const response: BattleResult = {
  state: {
    activePet: null,
    roster: [],
    spectatorPetIds: [],
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

function petsFixture() {
  const reads: string[] = [];
  const unexpected: string[] = [];
  const pets = new Proxy<Pick<PetClient, 'listSpecies' | 'getActivePet' | 'listOwnedPets'>>(
    {
      listSpecies() {
        reads.push('listSpecies');
        return [];
      },
      getActivePet() {
        reads.push('getActivePet');
        return null;
      },
      listOwnedPets() {
        reads.push('listOwnedPets');
        return [];
      },
    },
    {
      get(target, key) {
        if (key in target) return Reflect.get(target, key);
        return () => {
          unexpected.push(String(key));
          assert.fail(`runtime must not call another owner operation: ${String(key)}`);
        };
      },
    },
  );
  return { pets, reads, unexpected };
}

function sidecarFixture(t: TestContext, stalled = false) {
  const root = mkdtempSync(join(tmpdir(), 'battle-node-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binaryPath = join(root, 'sidecar.cjs');
  const requestsPath = join(root, 'requests.jsonl');
  // A real, harmless child keeps process lifecycle coverage independent of a Rust build.
  writeFileSync(
    binaryPath,
    [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs');",
      "const { createInterface } = require('node:readline');",
      `const response = ${JSON.stringify(response)};`,
      "createInterface({ input: process.stdin }).on('line', (line) => {",
      '  const request = JSON.parse(line);',
      `  appendFileSync(${JSON.stringify(requestsPath)}, JSON.stringify(request.command) + '\\n');`,
      `  if (${stalled}) return;`,
      "  process.stdout.write(JSON.stringify({ requestId: request.requestId, ok: true, ...response }) + '\\n');",
      '});',
    ].join('\n'),
    { mode: 0o700 },
  );
  return {
    options: { binaryPath, petAssetsDir: root, levelXpCosts },
    commands(): BattleCommand[] {
      if (!existsSync(requestsPath)) return [];
      return readFileSync(requestsPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BattleCommand);
    },
  };
}

test('Node runtime은 주입한 프로세스와 소유자 읽기 포트를 조립해 전투 결과를 반환한다', async (t) => {
  const sidecar = sidecarFixture(t);
  const owner = petsFixture();
  const runtime = createBattleRuntime(owner.pets, sidecar.options);
  t.after(() => runtime.close());
  assert.deepEqual(owner.reads, ['listSpecies']);

  const actual = await runtime.execute(command);

  assert.deepEqual(actual, {
    ...response,
    state: { ...response.state, petSprites: {} },
  });
  const commands = sidecar.commands();
  assert.deepEqual(
    commands.map((entry) => entry.type),
    ['SYNC_OWNED_PETS', 'GET_STATE'],
  );
  assert.equal(commands[0]?.type, 'SYNC_OWNED_PETS');
  if (commands[0]?.type !== 'SYNC_OWNED_PETS') assert.fail('owner sync must precede GET_STATE');
  assert.deepEqual(commands[0].levelXpCosts, [...levelXpCosts]);
  assert.deepEqual(owner.reads, ['listSpecies', 'getActivePet', 'listOwnedPets']);
  assert.deepEqual(owner.unexpected, []);
});

test('Node runtime close는 멱등이며 종료 후 execute는 소유자 조회 없이 거부된다', async (t) => {
  const sidecar = sidecarFixture(t);
  const owner = petsFixture();
  const runtime = createBattleRuntime(owner.pets, sidecar.options);
  t.after(() => runtime.close());
  await runtime.execute(command);
  const readsBeforeClose = [...owner.reads];

  assert.doesNotThrow(() => runtime.close());
  assert.doesNotThrow(() => runtime.close());
  await assert.rejects(runtime.execute(command), /종료/);

  assert.deepEqual(owner.reads, readsBeforeClose);
  assert.deepEqual(
    sidecar.commands().map((entry) => entry.type),
    ['SYNC_OWNED_PETS', 'GET_STATE'],
  );
  assert.deepEqual(owner.unexpected, []);
});

test('Node runtime close는 실제 응답 대기 중인 요청을 다음 event-loop turn 전에 거부한다', async (t) => {
  const sidecar = sidecarFixture(t, true);
  const owner = petsFixture();
  const runtime = createBattleRuntime(owner.pets, sidecar.options);
  t.after(() => runtime.close());
  const pending = runtime.execute(command).then(
    () => ({ status: 'resolved' as const }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  const deadline = Date.now() + 2000;
  while (sidecar.commands().length === 0 && Date.now() < deadline) await delay(5);
  assert.equal(
    sidecar.commands()[0]?.type,
    'SYNC_OWNED_PETS',
    'child must receive the pending request',
  );

  runtime.close();
  const outcome = await Promise.race([
    pending,
    nextTurn().then(() => ({ status: 'still-pending' as const })),
  ]);

  assert.equal(outcome.status, 'rejected');
  if (outcome.status !== 'rejected') assert.fail('close must immediately reject pending work');
  assert.ok(outcome.error instanceof Error);
  assert.match(outcome.error.message, /disposed/);
  assert.deepEqual(owner.unexpected, []);
});

test('Node runtime은 소유자 카탈로그 읽기 실패를 빈 목록으로 바꾸지 않는다', (t) => {
  const sidecar = sidecarFixture(t);
  const failure = new Error('owner catalog unavailable');
  const { pets } = petsFixture();
  pets.listSpecies = () => {
    throw failure;
  };

  assert.throws(
    () => createBattleRuntime(pets, sidecar.options),
    (error: unknown) => error === failure,
  );
  assert.deepEqual(sidecar.commands(), []);
});

function lifecycleFixture() {
  let quit: (() => void) | undefined;
  let closed: (() => void) | undefined;
  const lifecycle: BattleLifecyclePort = {
    onQuit(listener) {
      quit = listener;
      return () => {
        quit = undefined;
      };
    },
    onWindowClosed(listener) {
      closed = listener;
      return () => {
        closed = undefined;
      };
    },
  };
  let handler!: Parameters<BattleIpcRegistry['handle']>[1];
  const ipc: BattleIpcRegistry = {
    handle(_channel, listener) {
      handler = listener;
    },
    removeHandler() {},
  };
  return {
    ipc,
    lifecycle,
    quit: () => quit?.(),
    closeWindow: () => closed?.(),
    invoke: (value: BattleCommand = command, sender = 7) =>
      handler({ sender: { id: sender } }, value),
  };
}

test('mountBattle은 승인 전 소유자나 프로세스를 열지 않고 명시 바이너리를 지연 준비한다', async (t) => {
  const sidecar = sidecarFixture(t);
  const owner = petsFixture();
  const host = lifecycleFixture();
  const dispose = mountBattle(owner.pets, host.ipc, {
    ...sidecar.options,
    lifecycle: host.lifecycle,
    isBattleSender: (id) => id === 7,
  });
  t.after(dispose);
  assert.deepEqual(owner.reads, []);
  assert.throws(() => host.invoke(command, 99), /전투 창/);
  await assert.rejects(host.invoke({ type: 'UPSERT_PET' } as BattleCommand), /허용하지/);
  assert.deepEqual(owner.reads, []);
  assert.deepEqual((await host.invoke()).state.petSprites, {});
  host.closeWindow();
  await host.invoke();
  assert.equal(owner.reads.filter((value) => value === 'listSpecies').length, 1);
  host.quit();
  assert.throws(() => host.invoke(), /종료/);
});

test('mountBattle 준비 중 창 닫기는 생성 전 취소되며 다시 열면 정상 연결된다', async (t) => {
  const sidecar = sidecarFixture(t);
  const owner = petsFixture();
  const host = lifecycleFixture();
  const dispose = mountBattle(owner.pets, host.ipc, {
    ...sidecar.options,
    lifecycle: host.lifecycle,
    isBattleSender: () => true,
  });
  t.after(dispose);
  const rejected = assert.rejects(host.invoke(), /종료|취소/);
  host.closeWindow();
  await rejected;
  assert.deepEqual(owner.reads, []);
  await host.invoke();
  assert.equal(owner.reads.filter((value) => value === 'listSpecies').length, 1);
});

test('mountBattle 준비 중 앱 종료는 비동기 파일 확인 후에도 runtime을 생성하지 않는다', async (t) => {
  const sidecar = sidecarFixture(t);
  const owner = petsFixture();
  const host = lifecycleFixture();
  const dispose = mountBattle(owner.pets, host.ipc, {
    ...sidecar.options,
    lifecycle: host.lifecycle,
    isBattleSender: () => true,
  });
  t.after(dispose);
  const rejected = assert.rejects(host.invoke(), /종료|취소/);
  host.quit();
  await rejected;
  await nextTurn();
  assert.deepEqual(owner.reads, []);
  assert.deepEqual(sidecar.commands(), []);
  assert.throws(() => host.invoke(), /종료/);
});
