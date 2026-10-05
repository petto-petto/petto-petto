import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { PetSpecies } from '@pet/client';
import type { BattleCommand, BattlePet, BattleResult } from '../src/contracts.ts';
import { BATTLE_CHANNELS } from '../src/platform/handlers.ts';
import { FileBattleSpriteAdapter } from '../src/platform/file-sprites.ts';
import { SpriteBattleGateway } from '../src/app/sprite-gateway.ts';
import type { BattlePetSprites } from '../src/ports/sprites.ts';
import { mountBattleIpc } from '../src/platform/ipc.ts';
import type { BattleIpcRegistry, BattleRuntime } from '../src/ports/runtime.ts';

const command: BattleCommand = { type: 'GET_STATE', nowMs: 1234 };
const species: PetSpecies = {
  speciesId: '003',
  name: '두더지',
  rarity: 'COMMON',
  sprite: 'mole_digger',
};

function pet(overrides: Partial<BattlePet> = {}): BattlePet {
  return {
    petId: 'owned-1',
    displayName: '두더지',
    rarity: species.rarity,
    level: 13,
    sprite: species.sprite,
    evolutionStage: 0,
    stage: 7,
    intervalXp: 11,
    battleMode: 'FIGHTING',
    ...overrides,
  };
}

function result(roster: BattlePet[] = [pet()]): BattleResult {
  return {
    state: {
      activePet: roster[0] ?? null,
      roster,
      spectatorPetIds: roster.slice(1, 2).map((entry) => entry.petId),
      enemyHpRatio: 0.4,
      enemyColor: 'BLUE',
      background: 'CRYSTAL_RUINS',
      overlay: null,
      preview: {
        displayOpacity: 0.8,
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
    events: [{ type: 'ACTIVE_PET_CHANGED', petId: 'owned-1' }],
  };
}

function sprites(id: string): BattlePetSprites {
  return {
    idle: { asset: `file:///sprites/${id}_idle.png`, frameCount: 4 },
    attack: { asset: `file:///sprites/${id}_attack.png`, frameCount: 7 },
  };
}

test('sprite gateway는 명령을 그대로 전달하고 관전 밖 펫까지 roster 전체를 보강한다', async () => {
  const original = result([pet(), pet({ petId: 'spectator' }), pet({ petId: 'bench' })]);
  const snapshot = structuredClone(original);
  const commands: BattleCommand[] = [];
  const resolved: BattlePet[] = [];
  const gateway = new SpriteBattleGateway(
    {
      async execute(received: BattleCommand) {
        commands.push(received);
        return original;
      },
    },
    {
      resolve(entry: BattlePet) {
        resolved.push(entry);
        return sprites(entry.petId);
      },
    },
  );

  const actual = await gateway.execute(command);

  assert.equal(commands.length, 1);
  assert.equal(commands[0], command);
  assert.deepEqual(resolved, original.state.roster);
  assert.deepEqual(actual, {
    ...snapshot,
    state: {
      ...snapshot.state,
      petSprites: {
        'owned-1': sprites('owned-1'),
        spectator: sprites('spectator'),
        bench: sprites('bench'),
      },
    },
  });
  assert.equal(actual.events, original.events);
  assert.notEqual(actual.state, original.state);
  assert.deepEqual(original, snapshot);
});

test('sprite gateway의 빈 roster는 포트를 호출하지 않고 오래된 sprite를 비운다', async () => {
  const original = result([]);
  original.state.petSprites = { stale: sprites('stale') };
  const gateway = new SpriteBattleGateway(
    { execute: async () => original },
    { resolve: () => assert.fail('empty roster must not resolve sprites') },
  );

  assert.deepEqual((await gateway.execute(command)).state.petSprites, {});
  assert.deepEqual(original.state.petSprites, { stale: sprites('stale') });
});

test('sprite gateway는 엔진 오류를 빈 결과로 바꾸지 않는다', async () => {
  const failure = new Error('engine unavailable');
  const gateway = new SpriteBattleGateway(
    {
      async execute() {
        throw failure;
      },
    },
    { resolve: () => assert.fail('failed engine must not resolve sprites') },
  );

  await assert.rejects(gateway.execute(command), (error: unknown) => error === failure);
});

test('sprite gateway는 일부 sprite 조회가 실패해도 원본 state를 부분 변경하지 않는다', async () => {
  const original = result([pet(), pet({ petId: 'broken' })]);
  const snapshot = structuredClone(original);
  const failure = new Error('sprite unavailable');
  const gateway = new SpriteBattleGateway(
    { execute: async () => original },
    {
      resolve(entry: BattlePet) {
        if (entry.petId === 'broken') throw failure;
        return sprites(entry.petId);
      },
    },
  );

  await assert.rejects(gateway.execute(command), (error: unknown) => error === failure);
  assert.deepEqual(original, snapshot);
});

type IpcHandler = (
  event: { sender: { id: number } },
  command: BattleCommand,
) => Promise<BattleResult>;

function ipcFixture() {
  const registered = new Map<string, IpcHandler>();
  const removed: string[] = [];
  const ipc: BattleIpcRegistry = {
    handle(channel: string, handler: IpcHandler) {
      assert.equal(registered.has(channel), false, 'only one registration per channel');
      registered.set(channel, handler);
    },
    removeHandler(channel: string) {
      removed.push(channel);
      registered.delete(channel);
    },
  };
  return {
    ipc,
    registered,
    removed,
    handler(): IpcHandler {
      const handler = registered.get(BATTLE_CHANNELS.command);
      assert.ok(handler, 'battle command handler must be registered');
      return handler;
    },
  };
}

async function invoke(handler: IpcHandler, senderId = 7): Promise<BattleResult> {
  return handler({ sender: { id: senderId } }, command);
}

for (const raw of [
  { type: 'SYNC_OWNED_PETS' },
  { type: 'UPSERT_PET' },
  { type: 'SET_ACTIVE_PET' },
  { type: 'SET_PET_SPECTATORS' },
  { type: 'GROWTH_XP_ADDED' },
  { type: 'UNKNOWN' },
  { type: 'constructor' },
  null,
  'GET_STATE',
]) {
  test(`공개 IPC는 ${JSON.stringify(raw)} 요청을 runtime 생성 전에 차단한다`, async () => {
    const fixture = ipcFixture();
    let creates = 0;
    let executes = 0;
    const dispose = mountBattleIpc(
      fixture.ipc,
      () => {
        creates++;
        return {
          execute: async () => {
            executes++;
            return result();
          },
          close() {},
        };
      },
      () => true,
    );
    try {
      await assert.rejects(
        fixture.handler()({ sender: { id: 7 } }, raw as BattleCommand),
        /허용하지 않습니다/,
      );
      assert.equal(creates, 0, 'invalid client command must not start the engine');
      assert.equal(executes, 0);
    } finally {
      dispose();
    }
  });
}

test('IPC는 command 채널 하나만 등록하고 권한 확인 후 runtime을 한 번 지연 생성한다', async () => {
  const fixture = ipcFixture();
  const order: string[] = [];
  const commands: BattleCommand[] = [];
  const response = result();
  let closes = 0;
  const runtime: BattleRuntime = {
    async execute(received: BattleCommand) {
      commands.push(received);
      return response;
    },
    close() {
      closes++;
    },
  };
  const dispose = mountBattleIpc(
    fixture.ipc,
    () => {
      order.push('create');
      return runtime;
    },
    (id: number) => {
      order.push(`authorize:${id}`);
      return id === 7;
    },
  );
  const handler = fixture.handler();
  assert.deepEqual([...fixture.registered.keys()], [BATTLE_CHANNELS.command]);
  assert.deepEqual(order, []);

  await assert.rejects(invoke(handler, 99));
  assert.deepEqual(order, ['authorize:99']);
  assert.equal(await invoke(handler), response);
  assert.equal(await invoke(handler), response);
  await assert.rejects(invoke(handler, 99));
  assert.deepEqual(order, ['authorize:99', 'authorize:7', 'create', 'authorize:7', 'authorize:99']);
  assert.deepEqual(commands, [command, command]);

  dispose();
  dispose();
  assert.equal(closes, 1);
  assert.deepEqual(fixture.removed, [BATTLE_CHANNELS.command]);
  await assert.rejects(invoke(handler));
  assert.equal(commands.length, 2);
  assert.equal(order.filter((entry) => entry === 'create').length, 1);
});

test('요청 전 dispose도 멱등이며 캡처된 IPC handler로 runtime을 만들 수 없다', async () => {
  const fixture = ipcFixture();
  const dispose = mountBattleIpc(
    fixture.ipc,
    () => assert.fail('disposed IPC must not create a runtime'),
    () => true,
  );
  const handler = fixture.handler();

  dispose();
  dispose();

  assert.deepEqual(fixture.removed, [BATTLE_CHANNELS.command]);
  await assert.rejects(invoke(handler));
});

test('runtime 생성 실패는 그대로 전파하고 다음 승인된 요청에서 재시도한다', async () => {
  const fixture = ipcFixture();
  const failure = new Error('engine startup failed');
  const response = result();
  let creates = 0;
  let closes = 0;
  const dispose = mountBattleIpc(
    fixture.ipc,
    () => {
      creates++;
      if (creates === 1) throw failure;
      return { execute: async () => response, close: () => closes++ };
    },
    () => true,
  );
  const handler = fixture.handler();

  await assert.rejects(invoke(handler), (error: unknown) => error === failure);
  assert.equal(await invoke(handler), response);
  assert.equal(await invoke(handler), response);
  assert.equal(creates, 2);
  dispose();
  assert.equal(closes, 1);
});

test('runtime execute 실패는 전파하되 이미 생성된 runtime을 다시 만들지 않는다', async () => {
  const fixture = ipcFixture();
  const failure = new Error('engine command failed');
  const response = result();
  let creates = 0;
  let executes = 0;
  const dispose = mountBattleIpc(
    fixture.ipc,
    () => {
      creates++;
      return {
        async execute() {
          executes++;
          if (executes === 1) throw failure;
          return response;
        },
        close() {},
      };
    },
    () => true,
  );
  const handler = fixture.handler();

  await assert.rejects(invoke(handler), (error: unknown) => error === failure);
  assert.equal(await invoke(handler), response);
  assert.equal(creates, 1);
  dispose();
});

function fileFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'battle sprites #'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = (entry: PetSpecies, stage: number, motion: 'idle' | 'attack') =>
    join(
      root,
      entry.rarity.toLowerCase(),
      entry.sprite,
      `stage${stage}`,
      `pet_${entry.speciesId}_s${stage}_${motion}`,
    );
  function write(entry = species, stage = 1, idle = 4, attack = 7): BattlePetSprites {
    const resolved = {} as BattlePetSprites;
    for (const motion of ['idle', 'attack'] as const) {
      const path = base(entry, stage, motion);
      const frameCount = motion === 'idle' ? idle : attack;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.json`, JSON.stringify({ frameCount }));
      writeFileSync(`${path}.png`, 'sprite fixture');
      resolved[motion] = { asset: pathToFileURL(`${path}.png`).href, frameCount };
    }
    return resolved;
  }
  return { root, base, write };
}

for (const rarity of ['COMMON', 'RARE', 'EPIC'] as const) {
  test(`파일 sprite는 소유자 ${rarity} 카탈로그와 진화 0/1/2를 실제 stage1/2/3에 연결한다`, (t) => {
    const fixture = fileFixture(t);
    const entry: PetSpecies = { ...species, rarity };
    const other: PetSpecies = {
      ...species,
      speciesId: '999',
      rarity: rarity === 'COMMON' ? 'RARE' : 'COMMON',
    };
    const adapter = new FileBattleSpriteAdapter(fixture.root, [other, entry]);

    for (const evolutionStage of [0, 1, 2] as const) {
      const expected = fixture.write(entry, evolutionStage + 1, evolutionStage + 2, 8);
      assert.deepEqual(adapter.resolve(pet({ rarity, evolutionStage })), expected);
    }
  });
}

test('파일 sprite는 species/stage별 캐시를 공유하되 반환값의 변경은 캐시에 반영하지 않는다', (t) => {
  const fixture = fileFixture(t);
  const stage1 = fixture.write();
  const stage2 = fixture.write(species, 2, 5, 9);
  const other: PetSpecies = { ...species, speciesId: '004', sprite: 'sprout_treant' };
  const otherSprites = fixture.write(other, 1, 6, 10);
  const adapter = new FileBattleSpriteAdapter(fixture.root, [species, other]);
  const first = adapter.resolve(pet());

  first.idle.asset = 'file:///consumer-change.png';
  first.idle.frameCount = 999;
  first.attack = { asset: 'file:///replacement.png', frameCount: 1 };
  fixture.write(species, 1, 100, 200);

  const sameSpecies = adapter.resolve(pet({ petId: 'another-owned-pet' }));
  assert.deepEqual(sameSpecies, stage1);
  assert.notEqual(sameSpecies, first);
  assert.notEqual(sameSpecies.idle, first.idle);
  assert.deepEqual(adapter.resolve(pet({ evolutionStage: 1 })), stage2);
  assert.deepEqual(adapter.resolve(pet({ sprite: other.sprite })), otherSprites);
});

test('파일 sprite는 없는 종과 등급 불일치를 정상적인 빈 값으로 취급하지 않는다', (t) => {
  const fixture = fileFixture(t);
  fixture.write();
  const adapter = new FileBattleSpriteAdapter(fixture.root, [species]);

  assert.throws(() => adapter.resolve(pet({ sprite: 'unknown_pet' })));
  assert.throws(() => adapter.resolve(pet({ rarity: 'EPIC' })));
});

function isValidationFailure(error: unknown): boolean {
  return error instanceof Error && !('code' in error && error.code === 'ENOENT');
}

for (const overrides of [
  { sprite: '../outside' },
  { sprite: 'a/b' },
  { sprite: 'a\\b' },
  { sprite: 'UPPERCASE' },
  { sprite: '' },
  { speciesId: '../003' },
  { speciesId: '003/elsewhere' },
  { speciesId: '003a' },
  { speciesId: '' },
]) {
  test(`파일 sprite는 파일 접근 전 잘못된 소유자 식별자를 거부한다: ${JSON.stringify(overrides)}`, (t) => {
    const fixture = fileFixture(t);
    const invalid: PetSpecies = { ...species, ...overrides };
    assert.throws(
      () =>
        new FileBattleSpriteAdapter(fixture.root, [invalid]).resolve(
          pet({ sprite: invalid.sprite }),
        ),
      isValidationFailure,
    );
  });
}

for (const evolutionStage of [-1, 3, 0.5, NaN, Infinity]) {
  test(`파일 sprite는 파일 접근 전 잘못된 진화 단계를 거부한다: ${evolutionStage}`, (t) => {
    const fixture = fileFixture(t);
    const adapter = new FileBattleSpriteAdapter(fixture.root, [species]);
    assert.throws(
      () => adapter.resolve(pet({ evolutionStage: evolutionStage as BattlePet['evolutionStage'] })),
      isValidationFailure,
    );
  });
}

for (const frameCount of [0, -1, 1.5, '4', null]) {
  test(`파일 sprite는 양의 정수가 아닌 프레임 메타를 거부한다: ${JSON.stringify(frameCount)}`, (t) => {
    const fixture = fileFixture(t);
    fixture.write();
    writeFileSync(`${fixture.base(species, 1, 'attack')}.json`, JSON.stringify({ frameCount }));
    const adapter = new FileBattleSpriteAdapter(fixture.root, [species]);

    assert.throws(() => adapter.resolve(pet()));
    const repaired = fixture.write(species, 1, 5, 8);
    assert.deepEqual(
      adapter.resolve(pet()),
      repaired,
      'failed metadata must not populate the cache',
    );
  });
}

test('파일 sprite의 누락·깨진 JSON 메타는 fallback 없이 읽기 오류로 전파된다', (t) => {
  const fixture = fileFixture(t);
  const adapter = new FileBattleSpriteAdapter(fixture.root, [species]);
  assert.throws(() => adapter.resolve(pet()), { code: 'ENOENT' });

  fixture.write();
  writeFileSync(`${fixture.base(species, 1, 'idle')}.json`, '{broken json');
  assert.throws(() => adapter.resolve(pet()), SyntaxError);

  const repaired = fixture.write();
  assert.deepEqual(adapter.resolve(pet()), repaired);
});
