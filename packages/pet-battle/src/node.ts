/** Node composition entrypoint. Importing it never spawns a process or opens a database. */
import type { PetClient } from '@pet/client';
import type { RoomSelectionClient } from '@pet/room';
import { readFileSync } from 'node:fs';
import { FileBattleSpriteAdapter } from './adapters/file-sprites.ts';
import { PetBattleIntegration } from './integration/pet-client.ts';
import type { BattleGrowthRules } from './integration/owned-pet-gateway.ts';
import { SpriteBattleGateway } from './integration/sprite-gateway.ts';
import {
  mountBattleIpc,
  type BattleIpcRegistry,
  type BattleLifecyclePort,
  type BattleRuntime,
} from './ipc/host.ts';
import { spawnBattleSidecar } from './ipc/sidecar.ts';
import { createBattleBinaryPreparer } from './runtime/prepare.ts';
import { ElectronBattleEngine } from './domain/engine.ts';

export { FileBattleSpriteAdapter } from './adapters/file-sprites.ts';
export {
  mountBattleIpc,
  type BattleIpcRegistry,
  type BattleLifecyclePort,
  type BattleRuntime,
} from './ipc/host.ts';

export interface BattleRuntimeOptions {
  /** Optional owner-provided room selection; never changes room or common storage. */
  selection?: RoomSelectionClient;
  petAssetsDir: string;
  /** The growth owner supplies this curve; battle does not define pet growth. */
  levelXpCosts: readonly number[];
  /** Optional legacy sidecar override. Omit to run the engine inside Electron/Node. */
  binaryPath?: string;
}

export function createBattleRuntime(
  pets: Pick<PetClient, 'listSpecies' | 'getActivePet' | 'listOwnedPets'>,
  options: BattleRuntimeOptions,
): BattleRuntime {
  // Owner/catalog and configuration failures must occur before spawning a child.
  const species = pets.listSpecies();
  const config = JSON.parse(
    readFileSync(new URL('../battle-rules.json', import.meta.url), 'utf8'),
  ) as Pick<BattleGrowthRules, 'intervalLevels'>;
  const rules: BattleGrowthRules = {
    intervalLevels: config.intervalLevels,
    levelXpCosts: [...options.levelXpCosts],
  };
  const sprites = new FileBattleSpriteAdapter(options.petAssetsDir, species);
  const legacy =
    options.binaryPath === undefined ? undefined : spawnBattleSidecar(options.binaryPath);
  const engine = legacy?.client ?? new ElectronBattleEngine();
  let closed = false;
  const gateway = new SpriteBattleGateway(
    new PetBattleIntegration(
      pets,
      {
        execute(command) {
          if (closed) return Promise.reject(new Error('전투 연결이 종료되었습니다'));
          return engine.execute(command);
        },
      },
      rules,
      options.selection,
    ),
    sprites,
  );
  return {
    execute(command) {
      if (closed) return Promise.reject(new Error('전투 연결이 종료되었습니다'));
      return gateway.execute(command);
    },
    close() {
      if (closed) return;
      closed = true;
      legacy?.client.dispose();
      legacy?.sidecar.close();
    },
  };
}

export function mountBattle(
  pets: Pick<PetClient, 'listSpecies' | 'getActivePet' | 'listOwnedPets'>,
  ipc: BattleIpcRegistry,
  options: BattleRuntimeOptions & {
    isBattleSender(id: number): boolean;
    lifecycle?: BattleLifecyclePort;
    preparationTimeoutMs?: number;
  },
): () => void {
  if (options.binaryPath === undefined) {
    return mountBattleIpc(
      ipc,
      () => createBattleRuntime(pets, options),
      options.isBattleSender,
      options.lifecycle,
    );
  }
  const preparer = createBattleBinaryPreparer({
    ...(options.binaryPath === undefined ? {} : { binaryPath: options.binaryPath }),
    ...(options.preparationTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.preparationTimeoutMs }),
  });
  const hostLifecycle = options.lifecycle;
  const lifecycle: BattleLifecyclePort | undefined = hostLifecycle && {
    onQuit: (listener) => hostLifecycle.onQuit(listener),
    onWindowClosed: (listener) =>
      hostLifecycle.onWindowClosed(() => {
        preparer.resetFailure();
        listener();
      }),
  };
  return mountBattleIpc(
    ipc,
    async (signal) => {
      const binaryPath = await preparer.prepare(signal);
      signal.throwIfAborted();
      return createBattleRuntime(pets, { ...options, binaryPath });
    },
    options.isBattleSender,
    lifecycle,
  );
}
