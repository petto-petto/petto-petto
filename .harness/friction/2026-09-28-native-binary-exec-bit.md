# Optional-dependency native binary installed without the execute bit

## Evidence

- Request: run the bundled `ccusage@20.0.24` binary directly from the app,
  bypassing its Node launcher (spec `2026-09-27-ccusage-collector.md`, 8.1).
- Baseline: `node_modules/@ccusage/ccusage-darwin-arm64/bin/ccusage` was
  installed as `-rw-r--r--`; `execFile` failed with `spawn ... EACCES`.
- Reproduction: `npm install` in the repository, then `ls -la` on the binary.
  The package's own launcher (`ccusage/src/cli.js`) calls `chmodSync(path, 0o755)`
  before spawning, which is why the CLI works while a direct spawn does not.
- Detection: the fake-runner unit tests passed; only the real-binary integration
  test in `apps/desktop/test/ccusage-collector.test.cjs` failed.

## Root cause

Missing behavior in the new collector, caught by its integration test. Not a
harness gap: the rule to test changed behavior already produced the evidence.

## Pruning

- Canonical owner: `apps/desktop/src/main/usage/ccusage-collector.ts`
  (`ensureExecutable`, with the reason in its comment).
- Smallest change: record only. A harness rule would restate what the code
  comment and the integration test already hold.

## Approval

Approved by the requester on 2026-09-28 as a friction record only.

## RED

`npm run test:storage --workspace @pet/desktop` → `not ok 7 - 실제 ccusage 바이너리:
세 도구의 합성 로그가 규칙대로 변환된다` (`CollectError: 집계 오류`, log: `EACCES`).

## GREEN

Same command after `ensureExecutable` → the collector tests pass and the binary
is `-rwxr-xr-x`.

## Contract verification

`bash .harness/tests/verify-contract.sh` → `Contract verification passed.`

## CHANGELOG.md

Recorded under `Unreleased / Added`.

## Completion

Recorded. Lesson for future native tools: keep a real-binary integration test
alongside fake-runner tests.
