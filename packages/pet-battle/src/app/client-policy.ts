import type { BattleClientCommand } from '../client.ts';
import type { BattleCommand } from '../contracts.ts';

// Exhaustive against the public contract: adding/removing a client command requires
// updating this policy. Internal engine command additions never become public implicitly.
const allowed: Record<BattleClientCommand['type'], true> = {
  GET_STATE: true,
  TOGGLE_BATTLE: true,
  SET_BATTLE_RUNNING: true,
  OVERLAY_CLICK: true,
  TOGGLE_MENU: true,
  PREVIEW_PET: true,
  PREVIEW_ENEMY: true,
  CYCLE_ENEMY_SIZE: true,
  CYCLE_ENEMY_COLOR: true,
  CYCLE_ENEMY_HP: true,
  SET_DISPLAY_OPACITY: true,
  CYCLE_PET_ASSET: true,
  CYCLE_ATTACK_EFFECT: true,
  TOGGLE_REDUCED_MOTION: true,
};

/** Check command ownership at both host IPC and direct integration entrypoints. */
export function assertBattleClientCommand(
  command: BattleCommand,
): asserts command is BattleClientCommand {
  if (!command || typeof command !== 'object' || !Object.hasOwn(allowed, command.type)) {
    throw new Error('전투 화면에서 성장·명부 변경은 허용하지 않습니다.');
  }
}
