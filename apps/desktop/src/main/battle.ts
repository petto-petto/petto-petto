import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ipcMain } from 'electron';
import type { PetClient } from '@pet/client';
import {
  BATTLE_CHANNELS,
  OwnedPetBattleGateway,
  spawnBattleSidecar,
  type BattleCommand,
  type BattleGrowthRules,
} from '@pet/battle';
import { LEVEL_MAX, requiredXp } from '@pet/main-overlay/growth';
import { getBattleWindow } from './windows.ts';

export function mountBattle(pets: PetClient): () => void {
  const root = dirname(fileURLToPath(import.meta.resolve('@pet/battle/package.json')));
  const config: unknown = JSON.parse(readFileSync(join(root, 'battle-rules.json'), 'utf8'));
  if (!config || typeof config !== 'object' || !('intervalLevels' in config))
    throw new Error('전투 간격 설정이 없습니다.');
  const intervals = config.intervalLevels;
  if (!intervals || typeof intervals !== 'object')
    throw new Error('전투 간격 설정이 올바르지 않습니다.');
  const get = (rarity: 'COMMON' | 'RARE' | 'EPIC') => {
    const n = (intervals as Record<string, unknown>)[rarity];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100)
      throw new Error(`전투 간격 오류: ${rarity}`);
    return n;
  };
  const rules: BattleGrowthRules = {
    levelXpCosts: Array.from({ length: LEVEL_MAX }, (_, i) => requiredXp(i + 1)),
    intervalLevels: { COMMON: get('COMMON'), RARE: get('RARE'), EPIC: get('EPIC') },
  };
  let engine: ReturnType<typeof spawnBattleSidecar> | undefined;
  let gateway: OwnedPetBattleGateway | undefined;
  ipcMain.handle(BATTLE_CHANNELS.command, async (event, command: BattleCommand) => {
    if (event.sender !== getBattleWindow()?.webContents)
      throw new Error('전투 창에서만 접근할 수 있습니다.');
    if (!gateway) {
      const binary = join(
        root,
        'rust',
        'target',
        'debug',
        process.platform === 'win32' ? 'pet-battle-engine.exe' : 'pet-battle-engine',
      );
      if (!existsSync(binary))
        throw new Error('전투 엔진 빌드가 필요합니다: npm run build:rust --workspace @pet/battle');
      engine = spawnBattleSidecar(binary);
      gateway = new OwnedPetBattleGateway(pets, engine.client, rules);
    }
    try {
      return await gateway.execute(command);
    } catch (error) {
      if (engine?.client.closed) {
        engine.client.dispose();
        engine.sidecar.close();
        engine = undefined;
        gateway = undefined;
      }
      throw error;
    }
  });
  return () => {
    ipcMain.removeHandler(BATTLE_CHANNELS.command);
    engine?.client.dispose();
    engine?.sidecar.close();
  };
}
