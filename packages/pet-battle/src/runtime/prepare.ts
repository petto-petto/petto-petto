import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCargoBuild } from './cargo.ts';

export interface BattleBuildRequest {
  manifestPath: string;
  targetDir: string;
  signal: AbortSignal;
}

export interface BattleBinaryPreparationPorts {
  build(request: BattleBuildRequest): Promise<void>;
  assertExecutable(binaryPath: string): Promise<void>;
}

interface PreparationOptions {
  binaryPath?: string;
  timeoutMs?: number;
}

const defaultPorts: BattleBinaryPreparationPorts = {
  build: runCargoBuild,
  async assertExecutable(binaryPath) {
    try {
      await access(binaryPath, constants.X_OK);
    } catch (cause) {
      throw new Error(`전투 엔진 실행 파일이 없거나 실행할 수 없습니다: ${binaryPath}`, { cause });
    }
  },
};

function cancelledError(): Error {
  return new Error('전투 엔진 준비가 취소되었습니다');
}

/** Source builds always ask Cargo to check staleness; installed binaries never compile. */
export async function prepareBattleBinary(
  options: PreparationOptions,
  signal: AbortSignal,
  ports: BattleBinaryPreparationPorts = defaultPorts,
): Promise<string> {
  if (signal.aborted) throw cancelledError();
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('전투 엔진 준비 제한 시간은 양의 정수여야 합니다');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(cancelledError());
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error(`전투 엔진 준비 시간이 초과되었습니다 (${timeoutMs}ms)`)),
    timeoutMs,
  );
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const binaryPath =
    options.binaryPath ??
    fileURLToPath(
      new URL(
        `../../rust/target/debug/pet-battle-engine${process.platform === 'win32' ? '.exe' : ''}`,
        import.meta.url,
      ),
    );
  const prepare = async () => {
    if (options.binaryPath === undefined) {
      await ports.build({
        manifestPath: fileURLToPath(new URL('../../rust/Cargo.toml', import.meta.url)),
        targetDir: fileURLToPath(new URL('../../rust/target', import.meta.url)),
        signal: controller.signal,
      });
    }
    controller.signal.throwIfAborted();
    await ports.assertExecutable(binaryPath);
    controller.signal.throwIfAborted();
    return binaryPath;
  };
  try {
    return await Promise.race([prepare(), cancelled]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Avoid rebuilding on each renderer poll; closing/reopening explicitly clears the failure. */
export function createBattleBinaryPreparer(
  options: PreparationOptions,
  ports: BattleBinaryPreparationPorts = defaultPorts,
  now: () => number = Date.now,
): { prepare(signal: AbortSignal): Promise<string>; resetFailure(): void } {
  let failure: { error: unknown; retryAt: number } | undefined;
  let generation = 0;
  return {
    async prepare(signal) {
      if (signal.aborted) throw cancelledError();
      if (failure && now() < failure.retryAt) throw failure.error;
      const startedGeneration = generation;
      try {
        const binaryPath = await prepareBattleBinary(options, signal, ports);
        if (startedGeneration === generation) failure = undefined;
        return binaryPath;
      } catch (error) {
        if (!signal.aborted && startedGeneration === generation) {
          failure = { error, retryAt: now() + 5000 };
        }
        throw error;
      }
    },
    resetFailure() {
      generation++;
      failure = undefined;
    },
  };
}
