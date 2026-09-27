const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

/** 세 도구의 기본 로그 위치를 만든 가짜 홈. */
function fakeHome(name, providers = ['claude_code', 'codex', 'gemini_cli']) {
  const home = mkdtempSync(join(tmpdir(), `petto-ccusage-${name}-`));
  const dirs = {
    claude_code: ['.claude', 'projects'],
    codex: ['.codex', 'sessions'],
    gemini_cli: ['.gemini', 'tmp'],
  };
  for (const provider of providers) mkdirSync(join(home, ...dirs[provider]), { recursive: true });
  return home;
}

const EMPTY = JSON.stringify({ daily: [], totals: { totalTokens: 0 } });

async function load() {
  const { CcusageCollector, resolveCcusageBinary } =
    await import('../dist/main/usage/ccusage-collector.js');
  const { snapshotTotal } = await import('@pet/meta');
  return { CcusageCollector, resolveCcusageBinary, snapshotTotal };
}

/** 호출을 기록하고 정해 둔 출력을 돌려주는 실행기. */
function recordingRunner(outputs = {}) {
  const calls = [];
  const run = async (args, env) => {
    calls.push({ args, env });
    const output = outputs[args[0]];
    if (output instanceof Error) throw output;
    return output ?? EMPTY;
  };
  return { calls, run };
}

function collector(CcusageCollector, home, run, overrides = {}) {
  return new CcusageCollector({
    home,
    binaryPath: '/fake/ccusage',
    timezone: 'Asia/Seoul',
    run,
    log: () => {},
    ...overrides,
  });
}

function kindOf(run) {
  try {
    run();
    return 'ok';
  } catch (error) {
    return error.kind;
  }
}

test('기본 로그 위치가 없는 소스는 ccusage 를 실행하지 않고 not_found 다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('missing', ['claude_code']);
  try {
    const runner = recordingRunner();
    const target = collector(CcusageCollector, home, runner.run);

    await target.refresh(['claude_code', 'codex', 'gemini_cli']);

    assert.deepEqual(
      runner.calls.map((call) => call.args[0]),
      ['claude'],
    );
    assert.equal(
      kindOf(() => target.collect('claude_code')),
      'ok',
    );
    assert.equal(
      kindOf(() => target.collect('codex')),
      'not_found',
    );
    assert.equal(
      kindOf(() => target.collect('gemini_cli')),
      'not_found',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('네트워크 없이, 비용 없이, 로컬 시간대와 고정된 로그 위치로 실행한다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('args');
  // 사용자 환경의 위치 변경 값이 있어도 감지 위치와 같은 곳을 읽어야 한다.
  const saved = { ...process.env };
  process.env.CLAUDE_CONFIG_DIR = '/elsewhere/claude';
  process.env.GEMINI_DATA_DIR = '/elsewhere/gemini';
  process.env.CODEX_HOME = '/elsewhere/codex';
  try {
    const runner = recordingRunner();
    await collector(CcusageCollector, home, runner.run).refresh(['codex']);

    const [call] = runner.calls;
    assert.deepEqual(call.args, [
      'codex',
      'daily',
      '--json',
      '--offline',
      '--no-cost',
      '--timezone',
      'Asia/Seoul',
    ]);
    assert.equal(call.env.CODEX_HOME, join(home, '.codex'));
    assert.equal(call.env.CLAUDE_CONFIG_DIR, undefined);
    assert.equal(call.env.GEMINI_DATA_DIR, undefined);
    assert.equal(call.env.HOME, home);
  } finally {
    for (const key of ['CLAUDE_CONFIG_DIR', 'GEMINI_DATA_DIR', 'CODEX_HOME']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude Code 는 두 기본 위치(~/.claude, ~/.config/claude) 중 있는 곳만 읽는다', async () => {
  const { CcusageCollector } = await load();
  const cases = [
    { name: 'legacy', dirs: [['.claude']] },
    { name: 'xdg', dirs: [['.config', 'claude']] },
    { name: 'both', dirs: [['.claude'], ['.config', 'claude']] },
  ];
  for (const { name, dirs } of cases) {
    const home = mkdtempSync(join(tmpdir(), `petto-ccusage-claude-${name}-`));
    try {
      for (const dir of dirs) mkdirSync(join(home, ...dir, 'projects'), { recursive: true });
      const runner = recordingRunner();
      const target = collector(CcusageCollector, home, runner.run);

      await target.refresh(['claude_code']);

      assert.equal(
        kindOf(() => target.collect('claude_code')),
        'ok',
        name,
      );
      assert.equal(
        runner.calls[0].env.CLAUDE_CONFIG_DIR,
        dirs.map((dir) => join(home, ...dir)).join(','),
        name,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test('실행 실패·JSON 깨짐은 execution_failed, 스키마 불일치는 unsupported_schema, 다른 소스는 멀쩡하다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('failure');
  try {
    const runner = recordingRunner({
      claude: new Error('timeout'),
      codex: '{not json',
      gemini: JSON.stringify({ daily: {} }),
    });
    const target = collector(CcusageCollector, home, runner.run);

    await target.refresh(['claude_code', 'codex', 'gemini_cli']);

    assert.equal(
      kindOf(() => target.collect('claude_code')),
      'execution_failed',
    );
    assert.equal(
      kindOf(() => target.collect('codex')),
      'execution_failed',
    );
    assert.equal(
      kindOf(() => target.collect('gemini_cli')),
      'unsupported_schema',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('현재 플랫폼용 바이너리가 없으면 실행하지 않고 execution_failed 다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('nobinary');
  try {
    const runner = recordingRunner();
    const target = collector(CcusageCollector, home, runner.run, { binaryPath: undefined });

    await target.refresh(['claude_code']);

    assert.equal(runner.calls.length, 0);
    assert.equal(
      kindOf(() => target.collect('claude_code')),
      'execution_failed',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('refresh 하지 않은 소스는 실행하지 않는다 — 꺼진 소스는 요청 목록에서 빠진다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('disabled');
  try {
    const runner = recordingRunner();
    await collector(CcusageCollector, home, runner.run).refresh(['claude_code', 'gemini_cli']);

    assert.deepEqual(
      runner.calls.map((call) => call.args[0]),
      ['claude', 'gemini'],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('8.3: 실행 중에 같은 소스를 다시 요청하면 새로 실행하지 않고 합류한다', async () => {
  const { CcusageCollector } = await load();
  const home = fakeHome('join');
  try {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let calls = 0;
    const run = async () => {
      calls += 1;
      await gate;
      return EMPTY;
    };
    const target = collector(CcusageCollector, home, run);

    const first = target.refresh(['claude_code']);
    const second = target.refresh(['claude_code']);
    release();
    await Promise.all([first, second]);

    assert.equal(calls, 1);

    // 끝난 뒤의 요청은 새로 실행한다.
    await target.refresh(['claude_code']);
    assert.equal(calls, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ---------- 실제 바이너리 ---------- */

function writeClaudeLog(projectsDir, id, usage) {
  const dir = join(projectsDir, '-tmp-project');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.jsonl`),
    JSON.stringify({
      timestamp: '2026-09-27T01:00:00.000Z',
      sessionId: `session-${id}`,
      requestId: `req-${id}`,
      type: 'assistant',
      message: { id: `msg-${id}`, model: 'claude-opus-5', usage },
    }),
  );
}

function writeSyntheticLogs(home) {
  const codexDir = join(home, '.codex', 'sessions', '2026', '09', '27');
  mkdirSync(codexDir, { recursive: true });
  const usage = {
    input_tokens: 1000,
    cached_input_tokens: 300,
    output_tokens: 200,
    reasoning_output_tokens: 50,
    total_tokens: 1200,
  };
  writeFileSync(
    join(codexDir, 'rollout-2026-09-27T10-00-00-test.jsonl'),
    [
      {
        timestamp: '2026-09-27T01:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'test-session', timestamp: '2026-09-27T01:00:00.000Z', cwd: '/tmp' },
      },
      {
        timestamp: '2026-09-27T01:00:01.000Z',
        type: 'turn_context',
        payload: { cwd: '/tmp', model: 'gpt-5-codex' },
      },
      {
        timestamp: '2026-09-27T01:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 272000 },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  );

  const geminiDir = join(home, '.gemini', 'tmp', 'abc123', 'chats');
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(
    join(geminiDir, 'session-2026-09-27T01-00-test.json'),
    JSON.stringify({
      sessionId: 'test-gem',
      projectHash: 'abc123',
      startTime: '2026-09-27T01:00:00.000Z',
      lastUpdated: '2026-09-27T01:00:05.000Z',
      messages: [
        { id: 'm1', timestamp: '2026-09-27T01:00:00.000Z', type: 'user', content: 'hi' },
        {
          id: 'm2',
          timestamp: '2026-09-27T01:00:05.000Z',
          type: 'gemini',
          content: 'hello',
          model: 'gemini-2.5-pro',
          tokens: { input: 1000, output: 200, cached: 300, thoughts: 50, tool: 0, total: 1250 },
        },
      ],
    }),
  );

  // Claude Code 는 버전에 따라 두 기본 위치에 나눠 남긴다. 둘 다 읽어야 한다.
  writeClaudeLog(join(home, '.claude', 'projects'), 'legacy', {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_input_tokens: 30,
    cache_read_input_tokens: 40,
  });
  writeClaudeLog(join(home, '.config', 'claude', 'projects'), 'xdg', {
    input_tokens: 1000,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
}

test('실제 ccusage 바이너리: 세 도구의 합성 로그가 규칙대로 변환된다', async () => {
  const { CcusageCollector, resolveCcusageBinary, snapshotTotal } = await load();
  const binaryPath = resolveCcusageBinary();
  assert.ok(binaryPath, '현재 플랫폼용 ccusage 바이너리가 설치돼 있어야 한다');

  const home = fakeHome('real');
  try {
    writeSyntheticLogs(home);
    const target = new CcusageCollector({ home, binaryPath, timezone: 'Asia/Seoul' });

    await target.refresh(['claude_code', 'codex', 'gemini_cli']);

    assert.equal(snapshotTotal(target.collect('claude_code')), 100 + 1000);
    assert.equal(snapshotTotal(target.collect('codex')), 1200);
    assert.equal(snapshotTotal(target.collect('gemini_cli')), 1250);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
