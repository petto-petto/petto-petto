/** Node composition entrypoint. Importing it never spawns a process or opens a database. */
import type { PetClient } from '@pet/client';
import type { RoomSelectionClient } from '@pet/room';
import { readFileSync } from 'node:fs';
import { FileBattleSpriteAdapter } from './adapters/file-sprites.ts';
import { PetBattleIntegration } from './app/pet-client.ts';
import type { BattleGrowthRules } from './app/owned-pet-gateway.ts';
import { SpriteBattleGateway } from './app/sprite-gateway.ts';
import {
  mountBattleIpc,
  type BattleIpcRegistry,
  type BattleLifecyclePort,
  type BattleRuntime,
} from './app/ipc.ts';
import { ElectronBattleEngine } from './domain/engine.ts';

export { FileBattleSpriteAdapter } from './adapters/file-sprites.ts';
export {
  mountBattleIpc,
  type BattleIpcRegistry,
  type BattleLifecyclePort,
  type BattleRuntime,
} from './app/ipc.ts';

export interface BattleRuntimeOptions {
  /** Optional owner-provided room selection; never changes room or common storage. */
  selection?: RoomSelectionClient;
  petAssetsDir: string;
  /** The growth owner supplies this curve; battle does not define pet growth. */
  levelXpCosts: readonly number[];
}

export function createBattleRuntime(
  pets: Pick<PetClient, 'listSpecies' | 'getActivePet' | 'listOwnedPets'>,
  options: BattleRuntimeOptions,
): BattleRuntime {
  // Validate the owner catalog and configuration before creating the engine.
  const species = pets.listSpecies();
  const config = JSON.parse(
    readFileSync(new URL('../battle-rules.json', import.meta.url), 'utf8'),
  ) as Pick<BattleGrowthRules, 'intervalLevels'>;
  const rules: BattleGrowthRules = {
    intervalLevels: config.intervalLevels,
    levelXpCosts: [...options.levelXpCosts],
  };
  const sprites = new FileBattleSpriteAdapter(options.petAssetsDir, species);
  const engine = new ElectronBattleEngine();
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
    },
  };
}

export function mountBattle(
  pets: Pick<PetClient, 'listSpecies' | 'getActivePet' | 'listOwnedPets'>,
  ipc: BattleIpcRegistry,
  options: BattleRuntimeOptions & {
    isBattleSender(id: number): boolean;
    lifecycle?: BattleLifecyclePort;
  },
): () => void {
  return mountBattleIpc(
    ipc,
    () => createBattleRuntime(pets, options),
    options.isBattleSender,
    options.lifecycle,
  );
}
