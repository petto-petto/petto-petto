import type { BattleCommand, BattleResult } from './contracts.ts';

/** Consumer commands only. Pet selection, growth writes and engine sync are owner operations. */
export type BattleClientCommand = Extract<
  BattleCommand,
  {
    type:
      | 'GET_STATE'
      | 'TOGGLE_BATTLE'
      | 'SET_BATTLE_RUNNING'
      | 'OVERLAY_CLICK'
      | 'TOGGLE_MENU'
      | 'PREVIEW_PET'
      | 'PREVIEW_ENEMY'
      | 'CYCLE_ENEMY_SIZE'
      | 'CYCLE_ENEMY_COLOR'
      | 'CYCLE_ENEMY_HP'
      | 'SET_DISPLAY_OPACITY'
      | 'CYCLE_PET_ASSET'
      | 'CYCLE_ATTACK_EFFECT'
      | 'TOGGLE_REDUCED_MOTION';
  }
>;

/** Public battle-owned Port. Hosts supply the implementation; consumers never access storage. */
export interface BattleClient {
  execute(command: BattleClientCommand): Promise<BattleResult>;
}
