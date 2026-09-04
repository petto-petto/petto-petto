import type { BattleCommand, BattleGateway } from '../contracts.ts';

export const BATTLE_CHANNELS = {
  command: 'battle:command',
  state: 'battle:state',
  stateChanged: 'battle:state-changed',
} as const;

export interface BattleHost {
  broadcast(channel: string, payload: unknown): void;
}

export type BattleHandlers = Record<string, (...args: unknown[]) => unknown>;

function commandFrom(value: unknown): BattleCommand {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new TypeError('battle command must be a tagged object');
  }
  return value as BattleCommand;
}

export function battleHandlers(gateway: BattleGateway, host: BattleHost): BattleHandlers {
  const state = () => gateway.execute({ type: 'GET_STATE', nowMs: Date.now() });
  return {
    [BATTLE_CHANNELS.command]: async (rawCommand) => {
      const result = await gateway.execute(commandFrom(rawCommand));
      host.broadcast(BATTLE_CHANNELS.stateChanged, result);
      return result;
    },
    [BATTLE_CHANNELS.state]: state,
    [BATTLE_CHANNELS.stateChanged]: state,
  };
}
