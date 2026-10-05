import { BATTLE_CHANNELS } from './handlers.ts';
import { assertBattleClientCommand } from '../app/client-policy.ts';
import type { BattleClient } from '../client.ts';
import type { BattleCommand } from '../contracts.ts';
import type { BattleResult } from '../contracts.ts';
import type { BattleIpcRegistry, BattleLifecyclePort, BattleRuntime } from '../ports/runtime.ts';

interface PendingRuntime {
  controller: AbortController;
  ready: Promise<BattleRuntime>;
}

export function mountBattleIpc(
  ipc: BattleIpcRegistry,
  createRuntime: (signal: AbortSignal) => BattleRuntime | Promise<BattleRuntime>,
  isBattleSender: (id: number) => boolean,
  lifecycle?: BattleLifecyclePort,
): () => void {
  let runtime: BattleRuntime | undefined;
  let pending: PendingRuntime | undefined;
  let disposed = false;
  const subscriptions: Array<() => void> = [];
  const closedError = () => new Error('전투 연결이 종료되었습니다');

  function cancelPending() {
    const previous = pending;
    pending = undefined;
    previous?.controller.abort(closedError());
  }

  function readyRuntime(): BattleRuntime | Promise<BattleRuntime> {
    if (runtime) return runtime;
    if (pending) return pending.ready;
    const controller = new AbortController();
    const created = createRuntime(controller.signal);
    // Preserve existing synchronous factories and their immediate error semantics.
    if (!('then' in created)) {
      runtime = created;
      return runtime;
    }
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(closedError()), { once: true });
    });
    const initialized = created.then((next) => {
      if (disposed || controller.signal.aborted) {
        next.close();
        throw closedError();
      }
      runtime = next;
      return next;
    });
    const ready = Promise.race([initialized, cancelled]).finally(() => {
      if (pending?.controller === controller) pending = undefined;
    });
    pending = { controller, ready };
    return ready;
  }

  ipc.handle(BATTLE_CHANNELS.command, (event, command) => {
    if (disposed) throw closedError();
    if (!isBattleSender(event.sender.id)) throw new Error('전투 창에서만 요청할 수 있습니다');
    try {
      assertBattleClientCommand(command);
    } catch (error) {
      // Keep the existing async command-error contract while rejecting before spawn.
      return Promise.reject(error);
    }
    const ready = readyRuntime();
    if (!('then' in ready)) return ready.execute(command);
    return ready.then((next) => {
      if (disposed || runtime !== next) throw closedError();
      return next.execute(command);
    });
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelPending();
    try {
      ipc.removeHandler(BATTLE_CHANNELS.command);
    } finally {
      try {
        runtime?.close();
      } finally {
        for (const unsubscribe of subscriptions) unsubscribe();
      }
    }
  };
  if (lifecycle) {
    subscriptions.push(lifecycle.onQuit(dispose), lifecycle.onWindowClosed(cancelPending));
  }
  return dispose;
}
