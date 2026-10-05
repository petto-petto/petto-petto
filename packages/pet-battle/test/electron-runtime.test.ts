import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { OwnedPet } from '@pet/client';
import { createBattleRuntime, mountBattle, type BattleIpcRegistry } from '../src/node.ts';

function fixture() {
  let owned: OwnedPet = {
    ownedPetId: 'one',
    speciesId: '003',
    name: '두더지',
    nickname: null,
    sprite: 'mole_digger',
    rarity: 'COMMON',
    level: 1,
    evolutionStage: 0,
    totalXp: 0,
    xpIntoLevel: 0,
    isActive: true,
  };
  const pets = {
    listSpecies: () => [
      { speciesId: '003', name: '두더지', sprite: 'mole_digger', rarity: 'COMMON' as const },
    ],
    getActivePet: () => owned,
    listOwnedPets: () => [owned],
    readOwnedPetGrowth: (ownedPetIds: readonly string[]) =>
      new Map(
        ownedPetIds.includes(owned.ownedPetId)
          ? [
              [
                owned.ownedPetId,
                {
                  level: owned.level,
                  totalXp: owned.totalXp,
                  evolutionStage: owned.evolutionStage,
                },
              ],
            ]
          : [],
      ),
  };
  const options = {
    petAssetsDir: fileURLToPath(
      new URL('../../../apps/desktop/renderer/assets/pets', import.meta.url),
    ),
    levelXpCosts: Array.from({ length: 50 }, () => 10),
  };
  return {
    pets,
    options,
    grow(totalXp: number) {
      owned = { ...owned, totalXp };
    },
    snapshot: () => structuredClone(owned),
  };
}

test('default runtime uses committed XP and real assets without a Rust executable', async () => {
  const f = fixture();
  const runtime = createBattleRuntime(f.pets, f.options);
  try {
    const initial = await runtime.execute({ type: 'GET_STATE', nowMs: 0 });
    assert.equal(initial.state.activePet?.petId, 'one');
    assert.match(initial.state.petSprites?.one?.idle.asset ?? '', /pet_003_s1_idle.png$/);
    await runtime.execute({ type: 'SET_BATTLE_RUNNING', running: false });
    await runtime.execute({ type: 'SET_DISPLAY_OPACITY', percent: 35 });
    f.grow(20);
    const before = f.snapshot();
    const conquest = await runtime.execute({ type: 'GET_STATE', nowMs: 0 });
    assert.equal(conquest.state.activePet?.stage, 2);
    assert.equal(conquest.state.overlay?.phase, 'DEFEAT_MOTION');
    assert.equal(conquest.state.activePet?.battleMode, 'PAUSED');
    assert.equal(conquest.state.preview.displayOpacity, 0.35);
    assert.deepEqual((await runtime.execute({ type: 'GET_STATE', nowMs: 0 })).events, []);
    assert.deepEqual(f.snapshot(), before, 'engine never writes owner data');
    const untrustedExecute = runtime.execute as (command: unknown) => Promise<unknown>;
    await assert.rejects(
      untrustedExecute({ type: 'GROWTH_XP_ADDED', petId: 'one', amount: 999, nowMs: 0 }),
      /허용|읽기|전투/,
    );
  } finally {
    runtime.close();
  }
  await assert.rejects(runtime.execute({ type: 'GET_STATE', nowMs: 0 }), /종료/);
  const restored = createBattleRuntime(f.pets, f.options);
  assert.equal((await restored.execute({ type: 'GET_STATE', nowMs: 0 })).state.activePet?.stage, 2);
  assert.equal((await restored.execute({ type: 'GET_STATE', nowMs: 0 })).state.overlay, null);
  restored.close();
});

test('default IPC rejects other windows and preserves settings across closing/reopening', async () => {
  const f = fixture();
  let handler!: Parameters<BattleIpcRegistry['handle']>[1];
  let closeWindow!: () => void;
  let quit!: () => void;
  let removed = 0;
  const dispose = mountBattle(
    f.pets,
    {
      handle: (_channel, fn) => {
        handler = fn;
      },
      removeHandler: () => {
        removed++;
      },
    },
    {
      ...f.options,
      isBattleSender: (id) => id === 7,
      lifecycle: {
        onQuit: (fn) => {
          quit = fn;
          return () => {};
        },
        onWindowClosed: (fn) => {
          closeWindow = fn;
          return () => {};
        },
      },
    },
  );
  assert.throws(() => handler({ sender: { id: 8 } }, { type: 'GET_STATE', nowMs: 0 }), /전투 창/);
  const send = (command: Parameters<typeof handler>[1]) => handler({ sender: { id: 7 } }, command);
  await send({ type: 'SET_BATTLE_RUNNING', running: false });
  await send({ type: 'SET_DISPLAY_OPACITY', percent: 35 });
  closeWindow();
  const result = await send({ type: 'GET_STATE', nowMs: 0 });
  assert.equal(result.state.preview.displayOpacity, 0.35);
  assert.equal(result.state.activePet?.battleMode, 'PAUSED');
  quit();
  dispose();
  assert.equal(removed, 1);
  assert.throws(() => send({ type: 'GET_STATE', nowMs: 0 }), /종료/);
});

test('catalog failure is propagated before the owner roster is read', () => {
  const f = fixture();
  const failure = new Error('catalog unavailable');
  let reads = 0;
  assert.throws(
    () =>
      createBattleRuntime(
        {
          ...f.pets,
          listSpecies() {
            throw failure;
          },
          listOwnedPets() {
            reads++;
            return [];
          },
        },
        f.options,
      ),
    (error: unknown) => error === failure,
  );
  assert.equal(reads, 0);
});

test('closing the runtime twice prevents further owner reads', async () => {
  const f = fixture();
  let reads = 0;
  const runtime = createBattleRuntime(
    {
      ...f.pets,
      listOwnedPets() {
        reads++;
        return f.pets.listOwnedPets();
      },
    },
    f.options,
  );
  await runtime.execute({ type: 'GET_STATE', nowMs: 0 });
  const before = reads;
  runtime.close();
  runtime.close();
  await assert.rejects(runtime.execute({ type: 'GET_STATE', nowMs: 1 }), /종료/);
  assert.equal(reads, before);
});
