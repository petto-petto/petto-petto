import { execFileSync, spawn, type ExecFileException } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { BattleBuildRequest } from './prepare.ts';

/** Internal process seam: callers cannot choose a command or invoke a shell. */
export type CargoExecutor = (
  file: 'cargo',
  args: readonly string[],
  options: {
    signal: AbortSignal;
    shell: false;
    windowsHide: true;
    encoding: 'utf8';
    maxBuffer: number;
  },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => void;

const executeCargo: CargoExecutor = (file, args, options, callback) => {
  const { signal } = options;
  if (signal.aborted) {
    queueMicrotask(() => callback(new Error('전투 엔진 빌드가 취소되었습니다'), '', ''));
    return;
  }
  const windows = process.platform === 'win32';
  let cleanup: Promise<void> | undefined;
  let failure: ExecFileException | null = null;
  const output = {
    stdout: { chunks: [] as Buffer[], length: 0 },
    stderr: { chunks: [] as Buffer[], length: 0 },
  };
  // A new POSIX group confines cancellation to this build, never the desktop's group.
  const child = spawn(file, args, {
    detached: !windows,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const abort = () => {
    if (cleanup) return;
    const pid = child.pid;
    if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return;
    try {
      // before-quit cannot await timers: terminate the owned tree inside this callback.
      if (windows) {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'pipe',
          timeout: 5000,
        });
        cleanup = Promise.resolve();
      } else {
        signalProcessGroup(pid, 'SIGKILL');
        cleanup = waitForProcessGroupExit(pid);
      }
    } catch (error) {
      cleanup = Promise.reject(error);
    }
    // The close callback owns propagation, which may follow the cleanup promise.
    void cleanup.catch(() => undefined);
  };
  for (const stream of ['stdout', 'stderr'] as const) {
    child[stream].on('data', (chunk: Buffer) => {
      const sink = output[stream];
      const available = Math.max(0, options.maxBuffer - sink.length);
      if (available > 0) sink.chunks.push(chunk.subarray(0, available));
      sink.length += chunk.length;
      if (sink.length > options.maxBuffer && !failure) {
        failure = new Error(`Cargo ${stream} output exceeded ${options.maxBuffer} bytes`);
        failure.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        abort();
      }
    });
  }
  child.once('error', (error) => {
    failure = error;
  });
  child.once('close', (code, exitSignal) => {
    signal.removeEventListener('abort', abort);
    if (!failure && (code !== 0 || exitSignal !== null)) {
      failure = new Error(`Command failed: ${file} ${args.join(' ')}`);
      if (code !== null) failure.code = code;
      if (exitSignal !== null) failure.signal = exitSignal;
    }
    void (async () => {
      const stdout = Buffer.concat(output.stdout.chunks).toString(options.encoding);
      const stderr = Buffer.concat(output.stderr.chunks).toString(options.encoding);
      try {
        await cleanup;
        callback(failure, stdout, stderr);
      } catch (cause) {
        const cleanupFailure: ExecFileException = new Error(
          '전투 엔진 취소 후 자식 프로세스 정리에 실패했습니다',
          { cause },
        );
        cleanupFailure.code = 'ECLEANUP';
        callback(cleanupFailure, stdout, stderr);
      }
    })();
  });
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
};

function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGroupExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2000;
  let probeFailure: unknown;
  while (true) {
    try {
      if (!signalProcessGroup(pid, 0)) return;
      probeFailure = undefined;
    } catch (error) {
      // Darwin can briefly deny signal-0 probes while a killed group is being reaped.
      // Retry only observation: failure to send SIGKILL still propagates immediately.
      if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) throw error;
      probeFailure = error;
    }
    if (Date.now() >= deadline)
      throw new Error('Cargo 프로세스 그룹 종료 확인 시간이 초과되었습니다', {
        cause: probeFailure,
      });
    await delay(10);
  }
}

export function runCargoBuild(
  request: BattleBuildRequest,
  execute: CargoExecutor = executeCargo,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execute(
      'cargo',
      [
        'build',
        '--manifest-path',
        request.manifestPath,
        '--bin',
        'pet-battle-engine',
        '--target-dir',
        request.targetDir,
      ],
      {
        signal: request.signal,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (error?.code === 'ECLEANUP') {
          reject(error);
        } else if (request.signal.aborted) {
          reject(new Error('전투 엔진 빌드가 취소되었습니다', { cause: error }));
        } else if (!error) {
          resolve();
        } else if (error.code === 'ENOENT') {
          reject(
            new Error('전투 엔진 준비에 필요한 Cargo를 찾을 수 없습니다. Rust를 설치해 주세요.', {
              cause: error,
            }),
          );
        } else {
          const diagnostic = stderr.trim().slice(-16_384) || error.message;
          reject(
            new Error(
              `전투 엔진 빌드 실패 (${error.code ?? error.signal ?? 'unknown'}): ${diagnostic}`,
              {
                cause: error,
              },
            ),
          );
        }
      },
    );
  });
}
