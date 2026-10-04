import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  prepareBattleBinary,
  createBattleBinaryPreparer,
  type BattleBinaryPreparationPorts,
  type BattleBuildRequest,
} from '../src/runtime/prepare.ts';

function portsFixture() {
  const builds: BattleBuildRequest[] = [];
  const checked: string[] = [];
  const ports: BattleBinaryPreparationPorts = {
    async build(request: BattleBuildRequest) {
      builds.push(request);
    },
    async assertExecutable(path: string) {
      checked.push(path);
    },
  };
  return { builds, checked, ports };
}

test('개발 바이너리는 존재하더라도 Cargo 증분 빌드로 소스 변경을 매번 확인한다', async () => {
  const fixture = portsFixture();
  const signal = new AbortController().signal;
  const binary = await prepareBattleBinary({}, signal, fixture.ports);
  const repeated = await prepareBattleBinary({}, signal, fixture.ports);
  assert.equal(repeated, binary);
  assert.match(binary, /pet-battle[/\\]rust[/\\]target[/\\]debug[/\\]pet-battle-engine/);
  assert.equal(fixture.builds.length, 2);
  assert.match(fixture.builds[0]!.manifestPath, /pet-battle[/\\]rust[/\\]Cargo\.toml$/);
  assert.match(fixture.builds[0]!.targetDir, /pet-battle[/\\]rust[/\\]target$/);
  assert.deepEqual(fixture.checked, [binary, binary]);
});

test('명시한 배포 바이너리는 Cargo 없이 실행 파일 확인만 한다', async () => {
  const fixture = portsFixture();
  const binaryPath = '/installed/pet-battle-engine';
  assert.equal(
    await prepareBattleBinary({ binaryPath }, new AbortController().signal, fixture.ports),
    binaryPath,
  );
  assert.deepEqual(fixture.builds, []);
  assert.deepEqual(fixture.checked, [binaryPath]);
});

test('개발 빌드 실패는 전파하고 바이너리 확인이나 성공으로 변환하지 않는다', async () => {
  const fixture = portsFixture();
  const failure = new Error('Cargo not installed');
  fixture.ports.build = async () => {
    throw failure;
  };
  await assert.rejects(
    prepareBattleBinary({}, new AbortController().signal, fixture.ports),
    (error) => error === failure,
  );
  assert.deepEqual(fixture.checked, []);
});

test('성공한 빌드 후 실행 파일 누락도 빈 성공으로 처리하지 않는다', async () => {
  const fixture = portsFixture();
  const failure = new Error('battle binary not executable');
  fixture.ports.assertExecutable = async () => {
    throw failure;
  };
  await assert.rejects(
    prepareBattleBinary({}, new AbortController().signal, fixture.ports),
    (error) => error === failure,
  );
  assert.equal(fixture.builds.length, 1);
});

test('준비 제한 시간은 빌드를 취소하고 진단 가능한 오류를 반환한다', async () => {
  const fixture = portsFixture();
  let receivedSignal: AbortSignal | undefined;
  fixture.ports.build = async ({ signal }: BattleBuildRequest) => {
    receivedSignal = signal;
    await new Promise<void>(() => {});
  };
  await assert.rejects(
    prepareBattleBinary({ timeoutMs: 10 }, new AbortController().signal, fixture.ports),
    /10ms|시간.*초과|timed out/i,
  );
  assert.equal(receivedSignal?.aborted, true);
  assert.deepEqual(fixture.checked, []);
});

test('외부 취소는 준비를 즉시 거부하고 늦은 빌드 이후 실행 파일을 확인하지 않는다', async () => {
  const fixture = portsFixture();
  const controller = new AbortController();
  let finish!: () => void;
  let receivedSignal: AbortSignal | undefined;
  fixture.ports.build = async ({ signal }: BattleBuildRequest) => {
    receivedSignal = signal;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const rejected = assert.rejects(
    prepareBattleBinary({}, controller.signal, fixture.ports),
    /취소|abort/i,
  );
  controller.abort();
  await rejected;
  assert.equal(receivedSignal?.aborted, true);
  finish();
  await Promise.resolve();
  assert.deepEqual(fixture.checked, []);
});

test('이미 취소된 준비는 빌드와 파일 확인 모두 시작하지 않는다', async () => {
  const fixture = portsFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareBattleBinary({}, controller.signal, fixture.ports), /취소|abort/i);
  assert.deepEqual(fixture.builds, []);
  assert.deepEqual(fixture.checked, []);
});

test('개발 준비 실패는 polling 동안 5초 유지하고 이후 새 빌드로 재시도한다', async () => {
  const fixture = portsFixture();
  const failure = new Error('Cargo unavailable');
  let now = 0;
  let builds = 0;
  fixture.ports.build = async () => {
    builds++;
    if (builds === 1) throw failure;
  };
  const preparer = createBattleBinaryPreparer({}, fixture.ports, () => now);
  const signal = new AbortController().signal;
  await assert.rejects(preparer.prepare(signal), (error) => error === failure);
  now = 4999;
  await assert.rejects(preparer.prepare(signal), (error) => error === failure);
  assert.equal(builds, 1);
  now = 5000;
  assert.match(await preparer.prepare(signal), /pet-battle-engine/);
  assert.equal(builds, 2);
});

test('창 닫기에 따른 실패 초기화는 다음 열기에서 즉시 준비를 재시도한다', async () => {
  const fixture = portsFixture();
  let builds = 0;
  fixture.ports.build = async () => {
    builds++;
    if (builds === 1) throw new Error('Cargo unavailable');
  };
  const preparer = createBattleBinaryPreparer({}, fixture.ports, () => 0);
  const signal = new AbortController().signal;
  await assert.rejects(preparer.prepare(signal));
  preparer.resetFailure();
  assert.match(await preparer.prepare(signal), /pet-battle-engine/);
  assert.equal(builds, 2);
});

test('취소된 준비는 재연결 cooldown을 남기지 않는다', async () => {
  const fixture = portsFixture();
  const preparer = createBattleBinaryPreparer({}, fixture.ports, () => 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(preparer.prepare(controller.signal), /취소|abort/i);
  assert.match(await preparer.prepare(new AbortController().signal), /pet-battle-engine/);
  assert.equal(fixture.builds.length, 1);
});

test('기본 파일 어댑터는 누락된 배포 바이너리의 경로와 실행 진단을 반환한다', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'battle-missing-binary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binaryPath = join(root, 'missing-engine');
  await assert.rejects(
    prepareBattleBinary({ binaryPath }, new AbortController().signal),
    (error: unknown) =>
      error instanceof Error && error.message.includes(binaryPath) && /실행/.test(error.message),
  );
});

for (const timeoutMs of [0, -1, 1.5, NaN, Infinity]) {
  test(`잘못된 준비 제한 시간 ${timeoutMs}은 빌드 전에 거부한다`, async () => {
    const fixture = portsFixture();
    await assert.rejects(
      prepareBattleBinary({ timeoutMs }, new AbortController().signal, fixture.ports),
      RangeError,
    );
    assert.deepEqual(fixture.builds, []);
    assert.deepEqual(fixture.checked, []);
  });
}
