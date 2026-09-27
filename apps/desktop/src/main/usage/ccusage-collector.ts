/**
 * 번들된 고정 버전 `ccusage`를 실행하는 실제 수집기. 기획서 8.1의 "수집 컴포넌트"다.
 *
 * `ccusage@20`의 npm 패키지는 플랫폼별 네이티브 바이너리를 찾아 실행하는 Node 런처일 뿐이다.
 * 앱은 런처를 건너뛰고 바이너리를 직접 실행한다 — 사용자의 Node 설치에 기대지 않기
 * 위해서다. 바이너리는 optional dependency로 설치 시점에 들어오고, 실행 중에는 아무것도
 * 내려받지 않는다(`--offline`).
 *
 * 규칙은 여기 없다. JSON의 의미는 `@pet/meta`의 `parseCcusageDaily`가, 기준점과 멱등성은
 * 파이프라인이 안다. 이 파일은 "언제 무엇을 실행하고 실패를 어떻게 분류하나"만 안다.
 */

import { execFile } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Provider } from '@pet/core';
import {
  CollectError,
  defaultLogDirectories,
  parseCcusageDaily,
  type SourceSnapshot,
  type UsageCollector,
} from '@pet/meta';

/** 인자를 받아 표준 출력을 돌려준다. 비정상 종료·타임아웃이면 reject. */
export type CcusageRunner = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;

export interface CcusageCollectorOptions {
  /** 사용자 홈. 기본 로그 위치 판정과 ccusage의 `HOME`에 같이 쓴다. */
  home: string;
  /** 네이티브 바이너리 경로. 현재 플랫폼용이 설치되지 않았으면 `undefined`. */
  binaryPath: string | undefined;
  /** IANA 시간대. 날짜 분류를 시스템 로컬 날짜로 고정한다(기획서 8.7). */
  timezone: string;
  run?: CcusageRunner;
  exists?: (path: string) => boolean;
  log?: (message: string) => void;
}

const SUBCOMMANDS: Record<Provider, string> = {
  claude_code: 'claude',
  codex: 'codex',
  gemini_cli: 'gemini',
};

/** 1분 주기보다 충분히 짧아야 한다. 넘기면 그 소스만 `집계 오류`로 두고 다음 주기에 다시 한다. */
const RUN_TIMEOUT_MS = 10_000;

/** 로그가 큰 사용자도 담을 만큼. 넘기면 실행 실패로 분류된다. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** 현재 플랫폼용 ccusage 네이티브 바이너리. 없으면 `undefined`. */
export function resolveCcusageBinary(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  const executable = platform === 'win32' ? 'bin/ccusage.exe' : 'bin/ccusage';
  try {
    return createRequire(import.meta.url).resolve(
      `@ccusage/ccusage-${platform}-${arch}/${executable}`,
    );
  } catch {
    return undefined;
  }
}

/**
 * 바이너리에 실행 권한을 준다.
 *
 * npm은 optional dependency의 바이너리를 실행 비트 없이 풀어 놓을 수 있다(macOS에서
 * `-rw-r--r--`로 설치되는 것을 확인했다). ccusage의 Node 런처가 실행 직전에 `chmod 755`를
 * 해 주는데, 앱은 런처를 건너뛰므로 같은 일을 직접 한다.
 */
function ensureExecutable(binaryPath: string): void {
  if (process.platform === 'win32') return;
  if ((statSync(binaryPath).mode & 0o111) !== 0) return;
  chmodSync(binaryPath, 0o755);
}

function execFileRunner(binaryPath: string): CcusageRunner {
  let checked = false;
  return (args, env) =>
    new Promise((resolve, reject) => {
      if (!checked) {
        try {
          ensureExecutable(binaryPath);
          checked = true;
        } catch (error) {
          reject(error);
          return;
        }
      }
      execFile(
        binaryPath,
        [...args],
        { env, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
}

export class CcusageCollector implements UsageCollector {
  readonly #home: string;
  readonly #binaryPath: string | undefined;
  readonly #timezone: string;
  readonly #run: CcusageRunner | undefined;
  readonly #exists: (path: string) => boolean;
  readonly #log: (message: string) => void;

  readonly #results = new Map<Provider, SourceSnapshot | CollectError>();
  /** 진행 중인 실행. 같은 소스의 요청이 겹치면 새로 실행하지 않고 여기에 합류한다(8.3). */
  readonly #inFlight = new Map<Provider, Promise<void>>();

  constructor(options: CcusageCollectorOptions) {
    this.#home = options.home;
    this.#binaryPath = options.binaryPath;
    this.#timezone = options.timezone;
    this.#run =
      options.run ??
      (options.binaryPath === undefined ? undefined : execFileRunner(options.binaryPath));
    this.#exists = options.exists ?? existsSync;
    this.#log = options.log ?? ((message) => console.log(message));
  }

  async refresh(providers: readonly Provider[]): Promise<void> {
    await Promise.all(providers.map((provider) => this.#refreshOne(provider)));
  }

  collect(provider: Provider): SourceSnapshot {
    const result = this.#results.get(provider) ?? new CollectError('not_found');
    if (result instanceof CollectError) throw result;
    // 파이프라인이 스냅샷을 기준점으로 보관하므로 복사해서 넘긴다.
    return { provider, rows: new Map(result.rows) };
  }

  #refreshOne(provider: Provider): Promise<void> {
    const running = this.#inFlight.get(provider);
    if (running) return running;

    const task = this.#load(provider)
      .then((result) => {
        this.#results.set(provider, result);
      })
      .finally(() => {
        this.#inFlight.delete(provider);
      });
    this.#inFlight.set(provider, task);
    return task;
  }

  /** 던지지 않는다. 실패도 결과로 돌려줘야 소스 하나가 다른 소스를 막지 않는다. */
  async #load(provider: Provider): Promise<SourceSnapshot | CollectError> {
    // ccusage는 로그 폴더가 없어도 빈 결과로 성공한다. 감지는 앱이 직접 판정한다.
    const found = this.#existingLogDirectories(provider);
    if (found.length === 0) return new CollectError('not_found');

    if (this.#binaryPath === undefined || this.#run === undefined) {
      this.#log(`[USAGE] ${process.platform}-${process.arch}용 ccusage 바이너리가 없습니다`);
      return new CollectError('execution_failed');
    }

    let stdout: string;
    try {
      stdout = await this.#run(this.#args(provider), this.#env(provider, found));
    } catch (error) {
      this.#log(`[USAGE] ccusage ${SUBCOMMANDS[provider]} 실행 실패 — ${String(error)}`);
      return new CollectError('execution_failed');
    }

    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      this.#log(`[USAGE] ccusage ${SUBCOMMANDS[provider]} 출력이 JSON이 아닙니다`);
      return new CollectError('execution_failed');
    }

    try {
      return parseCcusageDaily(provider, output);
    } catch (error) {
      if (error instanceof CollectError) return error;
      this.#log(`[USAGE] ccusage ${SUBCOMMANDS[provider]} 변환 실패 — ${String(error)}`);
      return new CollectError('execution_failed');
    }
  }

  #args(provider: Provider): string[] {
    return [
      SUBCOMMANDS[provider],
      'daily',
      '--json',
      '--offline',
      '--no-cost',
      '--timezone',
      this.#timezone,
    ];
  }

  /** 기본 로그 위치 중 실제로 있는 곳. 위치 표는 `@pet/meta`의 것 하나뿐이다. */
  #existingLogDirectories(provider: Provider): string[] {
    return defaultLogDirectories(provider)
      .map((segments) => join(this.#home, ...segments))
      .filter((path) => this.#exists(path));
  }

  /**
   * 로그 위치를 기본 위치로 고정한다.
   *
   * ccusage는 `CODEX_HOME`·`CLAUDE_CONFIG_DIR`·`GEMINI_DATA_DIR`로 읽을 곳을 바꾼다. 앱의
   * 감지는 기본 위치만 보므로(기획서 2.2) 이 값들을 따르면 "감지됨인데 다른 곳의 기록"이
   * 생긴다. 앞의 둘은 감지한 기본 위치로 덮어쓰고(`CLAUDE_CONFIG_DIR`은 쉼표로 여러 폴더를
   * 받는다), 마지막은 지워서 ccusage 기본값(`~/.gemini`)을 쓰게 한다.
   */
  #env(provider: Provider, found: readonly string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: this.#home,
      USERPROFILE: this.#home,
      CODEX_HOME: join(this.#home, '.codex'),
    };
    delete env['GEMINI_DATA_DIR'];
    delete env['CLAUDE_CONFIG_DIR'];
    // `CLAUDE_CONFIG_DIR`은 `projects`를 담은 설정 폴더를 쉼표로 여러 개 받는다.
    if (provider === 'claude_code') env['CLAUDE_CONFIG_DIR'] = found.map(dirname).join(',');
    return env;
  }
}
