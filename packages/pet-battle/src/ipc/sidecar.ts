import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import { RustBattleClient, type JsonLineTransport } from './client.ts';

export interface RustSidecar extends JsonLineTransport {
  close(): void;
}

export function spawnBattleSidecar(binaryPath: string): {
  client: RustBattleClient;
  sidecar: RustSidecar;
} {
  const process = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const sidecar = processTransport(process);
  return { client: new RustBattleClient(sidecar), sidecar };
}

function processTransport(process: ChildProcessWithoutNullStreams): RustSidecar {
  const listeners = new Set<(line: string) => void>();
  const errors = new Set<(error: Error) => void>();
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    for (const listener of errors) listener(error);
  };
  process.on('error', fail);
  process.stdin.on('error', fail);
  process.on('exit', (code, signal) =>
    fail(new Error(`battle sidecar exited (${code ?? signal})`)),
  );
  const lines = createInterface({ input: process.stdout });
  lines.on('line', (line) => {
    for (const listener of listeners) listener(line);
  });
  process.stderr.on('data', (chunk: Buffer) => {
    console.error(`[pet-battle-engine] ${chunk.toString().trimEnd()}`);
  });

  return {
    send(line) {
      if (failure) throw failure;
      process.stdin.write(`${line}\n`);
    },
    onLine(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onError(listener) {
      errors.add(listener);
      if (failure) listener(failure);
      return () => errors.delete(listener);
    },
    close() {
      lines.close();
      process.kill();
      listeners.clear();
      errors.clear();
    },
  };
}
