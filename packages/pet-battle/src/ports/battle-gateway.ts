import type { BattleCommand, BattleResult } from '../contracts.ts';

/** Commands shared by the in-process engine, app composition, Electron and preview. */
export interface BattleGateway {
  execute(command: BattleCommand): Promise<BattleResult>;
}
