import type { BattleClient } from '../client.ts';
import type { BattleCommand, BattleResult } from '../contracts.ts';

export interface BattleRuntime extends BattleClient {
  close(): void;
}

export interface BattleLifecyclePort {
  onQuit(listener: () => void): () => void;
  onWindowClosed(listener: () => void): () => void;
}

export interface BattleIpcRegistry {
  handle(
    channel: string,
    handler: (event: { sender: { id: number } }, command: BattleCommand) => Promise<BattleResult>,
  ): void;
  removeHandler(channel: string): void;
}

export interface BattleHost {
  broadcast(channel: string, payload: unknown): void;
}

export type BattleHandlers = Record<string, (...args: unknown[]) => unknown>;
