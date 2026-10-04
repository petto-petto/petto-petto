import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runCargoBuild, type CargoExecutor } from '../src/runtime/cargo.ts';

function fixture(t: TestContext, script: string) {
  const root = mkdtempSync(join(tmpdir(), 'battle-cargo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scriptPath = join(root, 'cargo-fixture.cjs');
  writeFileSync(scriptPath, script);
  let child: ChildProcess | undefined;
  const execute: CargoExecutor = (file, args, options, callback) => {
    assert.equal(file, 'cargo');
    assert.deepEqual(args, [
      'build',
      '--manifest-path',
      join(root, 'Cargo.toml'),
      '--bin',
      'pet-battle-engine',
      '--target-dir',
      join(root, 'target'),
    ]);
    assert.equal(options.shell, false);
    child = execFile(process.execPath, [scriptPath, ...args], options, callback);
  };
  t.after(() => child?.kill());
  return {
    request: {
      manifestPath: join(root, 'Cargo.toml'),
      targetDir: join(root, 'target'),
      signal: new AbortController().signal,
    },
    execute,
    child: () => child,
    root,
  };
}

test('Cargo 어댑터는 고정 argv와 shell:false로 비동기 자식 빌드를 실행한다', async (t) => {
  const build = fixture(t, "process.stdout.write('finished');");
  await runCargoBuild(build.request, build.execute);
  assert.equal(build.child()?.exitCode, 0);
});

test('Cargo 비정상 종료는 stderr 원인과 종료 코드를 포함한다', async (t) => {
  const build = fixture(t, "process.stderr.write('fixture compile diagnostic'); process.exit(23);");
  await assert.rejects(
    runCargoBuild(build.request, build.execute),
    /23[\s\S]*fixture compile diagnostic/,
  );
});

test('Cargo 미설치는 컴파일 오류와 구분되는 설치 진단을 반환한다', async (t) => {
  const build = fixture(t, '');
  const missing: CargoExecutor = (_file, args, options, callback) => {
    execFile(join(build.root, 'missing-cargo'), args, options, callback);
  };
  await assert.rejects(
    runCargoBuild(build.request, missing),
    /Cargo[\s\S]*설치|Cargo[\s\S]*not found/i,
  );
});

test('Cargo 준비 취소는 실행 중인 실제 자식 프로세스에 전달된다', async (t) => {
  const build = fixture(t, 'setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const rejected = assert.rejects(
    runCargoBuild({ ...build.request, signal: controller.signal }, build.execute),
    /취소|abort/i,
  );
  controller.abort();
  await rejected;
  assert.equal(build.child()?.killed, true);
});

test('기본 실행 포트도 PATH의 Cargo를 shell 없이 찾아 실행한다', async (t) => {
  const build = fixture(t, '');
  writeFileSync(join(build.root, 'cargo'), `#!${process.execPath}\nprocess.exit(0);\n`, {
    mode: 0o700,
  });
  const previousPath = process.env.PATH;
  process.env.PATH = build.root;
  try {
    await runCargoBuild(build.request);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test('stderr 없는 Cargo 종료도 프로세스 오류 메시지를 보존한다', async (t) => {
  const build = fixture(t, 'process.exit(17);');
  await assert.rejects(runCargoBuild(build.request, build.execute), /17[\s\S]*Command failed/);
});

test('시그널로 종료된 Cargo는 시그널 원인을 진단에 포함한다', async (t) => {
  const build = fixture(t, "process.kill(process.pid, 'SIGTERM');");
  await assert.rejects(runCargoBuild(build.request, build.execute), /SIGTERM/);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + 3000;
  while (!existsSync(path) && Date.now() < deadline) await delay(10);
  assert.equal(existsSync(path), true, 'temporary descendant must start before cancellation');
  const pid = Number(readFileSync(path, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  return pid;
}

for (const ignoresTermination of [false, true]) {
  test(`Cargo 취소는 SIGTERM 무시=${ignoresTermination}인 후손까지 정리한 뒤 오류를 반환한다`, async (t) => {
    const build = fixture(t, '');
    const parentPidPath = join(build.root, 'cargo.pid');
    const descendantPidPath = join(build.root, 'build-script.pid');
    const descendantScript = [
      "const fs = require('node:fs');",
      `process.on('SIGTERM', () => { ${ignoresTermination ? '' : 'setTimeout(() => process.exit(0), 100);'} });`,
      `fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    writeFileSync(
      join(build.root, 'cargo'),
      [
        `#!${process.execPath}`,
        `require('node:fs').writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));`,
        `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      { mode: 0o700 },
    );
    const previousPath = process.env.PATH;
    const createdPids: number[] = [];
    t.after(() => {
      for (const pid of createdPids) {
        if (isAlive(pid)) process.kill(pid, 'SIGKILL');
      }
    });
    const controller = new AbortController();
    process.env.PATH = build.root;
    try {
      const rejected = assert.rejects(
        runCargoBuild({ ...build.request, signal: controller.signal }),
        /취소|abort/i,
      );
      const parentPid = await waitForPid(parentPidPath);
      createdPids.push(parentPid);
      const descendantPid = await waitForPid(descendantPidPath);
      createdPids.push(descendantPid);
      assert.equal(isAlive(descendantPid), true);
      controller.abort();
      await rejected;
      assert.equal(
        isAlive(descendantPid),
        false,
        'Cargo descendant must be gone before cancellation settles',
      );
      assert.equal(
        isAlive(parentPid),
        false,
        'Cargo parent must be gone when cancellation settles',
      );
    } finally {
      controller.abort();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
}

async function withDefaultCargo(
  t: TestContext,
  script: string | undefined,
  action: (request: ReturnType<typeof fixture>['request']) => Promise<void>,
) {
  const build = fixture(t, '');
  if (script !== undefined) {
    writeFileSync(join(build.root, 'cargo'), `#!${process.execPath}\n${script}\n`, { mode: 0o700 });
  }
  const previousPath = process.env.PATH;
  process.env.PATH = build.root;
  try {
    await action(build.request);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

test('기본 Cargo 실행기도 spawn 실패를 설치 오류로 반환한다', async (t) => {
  await withDefaultCargo(t, undefined, async (request) => {
    await assert.rejects(runCargoBuild(request), /Cargo[\s\S]*설치/);
  });
});

test('기본 Cargo 실행기는 stdout과 stderr를 수집하고 비정상 종료를 보존한다', async (t) => {
  await withDefaultCargo(
    t,
    "process.stdout.write('build progress'); process.stderr.write('compile failed'); process.exit(31);",
    async (request) => {
      await assert.rejects(runCargoBuild(request), /31[\s\S]*compile failed/);
    },
  );
});

test('기본 Cargo 실행기는 출력 제한을 초과한 빌드도 트리 종료 후 거부한다', async (t) => {
  await withDefaultCargo(
    t,
    "process.stdout.write('x'.repeat(1100000)); setInterval(() => {}, 1000);",
    async (request) => {
      await assert.rejects(runCargoBuild(request), /MAXBUFFER[\s\S]*exceeded/);
    },
  );
});

test('기본 Cargo 실행기는 시작 전 취소면 프로세스를 생성하지 않는다', async (t) => {
  await withDefaultCargo(t, undefined, async (request) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(runCargoBuild({ ...request, signal: controller.signal }), /취소/);
  });
});

test('취소 직후 호스트가 즉시 종료해도 Cargo와 후손이 남지 않는다', async (t) => {
  const build = fixture(t, '');
  const parentPidPath = join(build.root, 'cargo.pid');
  const descendantPidPath = join(build.root, 'build-script.pid');
  const descendantScript = [
    "process.on('SIGTERM', () => {});",
    `require('node:fs').writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  writeFileSync(
    join(build.root, 'cargo'),
    [
      `#!${process.execPath}`,
      `require('node:fs').writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));`,
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
    { mode: 0o700 },
  );
  const createdPids: number[] = [];
  t.after(() => {
    for (const pid of createdPids) {
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
  });
  const harness = [
    `import { runCargoBuild } from ${JSON.stringify(new URL('../src/runtime/cargo.ts', import.meta.url).href)};`,
    "import { existsSync } from 'node:fs';",
    "import { setTimeout as delay } from 'node:timers/promises';",
    'const controller = new AbortController();',
    `void runCargoBuild({ manifestPath: ${JSON.stringify(build.request.manifestPath)}, targetDir: ${JSON.stringify(build.request.targetDir)}, signal: controller.signal }).catch(() => {});`,
    `while (!existsSync(${JSON.stringify(descendantPidPath)})) await delay(10);`,
    'controller.abort();',
    'process.exit(0);',
  ].join('\n');
  const exited = new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', harness],
      { env: { ...process.env, PATH: build.root }, timeout: 5000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  createdPids.push(await waitForPid(parentPidPath));
  createdPids.push(await waitForPid(descendantPidPath));
  await exited;
  const deadline = Date.now() + 1000;
  while (createdPids.some(isAlive) && Date.now() < deadline) await delay(10);
  assert.deepEqual(createdPids.filter(isAlive), [], 'host exit must not abandon build processes');
});

for (const permanentPermissionError of [false, true]) {
  test(`종료 확인 EPERM 영구=${permanentPermissionError}은 제한 시간 안에서만 재시도한다`, async (t) => {
    await withDefaultCargo(
      t,
      [
        "const manifest = process.argv[process.argv.indexOf('--manifest-path') + 1];",
        "require('node:fs').writeFileSync(manifest + '.pid', String(process.pid));",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      async (request) => {
        const controller = new AbortController();
        const outcome = runCargoBuild({ ...request, signal: controller.signal }).then(
          () => assert.fail('cancelled Cargo must not succeed'),
          (error: unknown) => error,
        );
        const ownPid = await waitForPid(`${request.manifestPath}.pid`);
        const originalKill = process.kill.bind(process);
        let probes = 0;
        const permissionError = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
        t.mock.method(process, 'kill', (pid: number, signal?: string | number) => {
          if (pid === -ownPid && signal === 0) {
            probes++;
            if (permanentPermissionError || probes <= 2) throw permissionError;
          }
          return originalKill(pid, signal);
        });
        t.after(() => {
          if (isAlive(ownPid)) originalKill(ownPid, 'SIGKILL');
        });
        const started = Date.now();
        controller.abort();
        const error = await outcome;
        assert.ok(error instanceof Error);
        assert.ok(probes >= 2, 'an EPERM exit probe must be retried');
        if (permanentPermissionError) {
          assert.equal('code' in error && error.code, 'ECLEANUP');
          assert.ok(error.cause instanceof Error);
          assert.match(error.cause.message, /시간.*초과/);
          assert.equal(error.cause.cause, permissionError);
          assert.ok(
            Date.now() - started >= 1900,
            'permanent EPERM must reach the cleanup deadline',
          );
        } else {
          assert.match(error.message, /빌드가 취소/);
          assert.equal('code' in error && error.code === 'ECLEANUP', false);
        }
        assert.equal(isAlive(ownPid), false, 'the real owned process must still be terminated');
      },
    );
  });
}
