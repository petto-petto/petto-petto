/** App assembly only: shared PetClient → battle package → Rust. No owner writes or SQL. */
import type { IpcMain } from 'electron';
import type { PetClient } from '@pet/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PetBattleIntegration,
  BATTLE_CHANNELS,
  spawnBattleSidecar,
  type BattleCommand,
  type BattleGrowthRules,
  type BattleState,
} from '@pet/battle';

export function createBattleRuntime(
  pets: PetClient,
  options: {
    binaryPath: string;
    petAssetsDir: string;
    rules: BattleGrowthRules;
  },
) {
  // Fail before starting a child process if the shared catalog cannot be read.
  const species = pets.listSpecies();
  const { client, sidecar } = spawnBattleSidecar(options.binaryPath);
  const integration = new PetBattleIntegration(pets, client, options.rules);
  const assets = new Map<string, NonNullable<BattleState['petSprites']>[string]>();
  // Species identities come from the public client, never from renderer path input.
  return {
    close: () => sidecar.close(),
    async execute(command: BattleCommand) {
      const result = await integration.execute(command);
      const petSprites: NonNullable<BattleState['petSprites']> = {};
      for (const pet of result.state.roster) {
        const entry = species.find((s) => s.sprite === pet.sprite && s.rarity === pet.rarity);
        if (!entry || !/^[a-z0-9_]+$/.test(entry.sprite) || !/^\d+$/.test(entry.speciesId)) {
          throw new Error(`공통 펫 에셋 식별자를 확인할 수 없습니다: ${pet.sprite}`);
        }
        const stage = pet.evolutionStage + 1;
        const key = `${entry.speciesId}:${stage}`;
        let sprite = assets.get(key);
        if (!sprite) {
          const load = (motion: 'idle' | 'attack') => {
            const base = join(
              options.petAssetsDir,
              entry.rarity.toLowerCase(),
              entry.sprite,
              `stage${stage}`,
              `pet_${entry.speciesId}_s${stage}_${motion}`,
            );
            const meta = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { frameCount: number };
            if (!Number.isInteger(meta.frameCount) || meta.frameCount < 1)
              throw new Error('펫 프레임 메타가 올바르지 않습니다');
            return { asset: pathToFileURL(`${base}.png`).href, frameCount: meta.frameCount };
          };
          sprite = { idle: load('idle'), attack: load('attack') };
          assets.set(key, sprite);
        }
        petSprites[pet.petId] = sprite;
      }
      return { ...result, state: { ...result.state, petSprites } };
    },
  };
}

export function mountBattle(
  pets: PetClient,
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  options: Parameters<typeof createBattleRuntime>[1] & { isBattleSender(id: number): boolean },
): () => void {
  let runtime: ReturnType<typeof createBattleRuntime> | undefined;
  ipc.handle(BATTLE_CHANNELS.command, (event, command: BattleCommand) => {
    if (!options.isBattleSender(event.sender.id))
      throw new Error('전투 창에서만 요청할 수 있습니다');
    runtime ??= createBattleRuntime(pets, options);
    return runtime.execute(command);
  });
  return () => {
    ipc.removeHandler(BATTLE_CHANNELS.command);
    runtime?.close();
  };
}
