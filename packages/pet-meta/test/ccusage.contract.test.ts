/**
 * `ccusage daily --json` 출력 → `SourceSnapshot` 변환 계약.
 *
 * 픽스처는 `ccusage@20.0.24` 바이너리가 실제로 낸 출력이다. Codex·Gemini는 토큰 수를 아는
 * 합성 세션(입력 1000 · 캐시 300 · 출력 200 · 추론 50)으로 만들었다
 * (사양 `.harness/specs/features/2026-09-27-ccusage-collector.md`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CollectError,
  observed,
  parseCcusageDaily,
  rowKey,
  snapshotTotal,
  tokenCounts,
  type SourceSnapshot,
} from '@pet/meta';
import { parseLocalDate, type LocalDate } from '@pet/core';

const date = (value: string): LocalDate => {
  const parsed = parseLocalDate(value);
  if (!parsed) throw new TypeError(value);
  return parsed;
};

const row = (snapshot: SourceSnapshot, day: string, model: string) =>
  snapshot.rows.get(rowKey(date(day), model));

const CLAUDE_OUTPUT = {
  daily: [
    {
      cacheCreationTokens: 135296,
      cacheReadTokens: 3221397,
      date: '2026-09-26',
      inputTokens: 96,
      modelBreakdowns: [
        {
          cacheCreationTokens: 101361,
          cacheReadTokens: 2138872,
          inputTokens: 56,
          modelName: 'claude-opus-5',
          outputTokens: 30775,
        },
        {
          cacheCreationTokens: 33935,
          cacheReadTokens: 1082525,
          inputTokens: 40,
          missingPricing: true,
          modelName: 'claude-opus-5-5',
          outputTokens: 6636,
        },
      ],
      modelsUsed: ['claude-opus-5', 'claude-opus-5-5'],
      outputTokens: 37411,
      totalTokens: 3394200,
    },
  ],
  totals: { totalTokens: 3394200 },
};

const CODEX_OUTPUT = {
  daily: [
    {
      cacheCreationTokens: 0,
      cacheReadTokens: 300,
      date: '2026-09-27',
      inputTokens: 700,
      models: {
        'gpt-5-codex': {
          cacheCreationTokens: 0,
          cacheReadTokens: 300,
          inputTokens: 700,
          isFallback: false,
          outputTokens: 200,
          reasoningOutputTokens: 50,
          totalTokens: 1200,
        },
      },
      outputTokens: 200,
      reasoningOutputTokens: 50,
      totalTokens: 1200,
    },
  ],
  totals: { totalTokens: 1200 },
};

const GEMINI_OUTPUT = {
  daily: [
    {
      cacheCreationTokens: 0,
      cacheReadTokens: 300,
      date: '2026-09-27',
      inputTokens: 700,
      modelBreakdowns: [
        {
          cacheCreationTokens: 0,
          cacheReadTokens: 300,
          inputTokens: 700,
          modelName: 'gemini-2.5-pro',
          outputTokens: 200,
        },
      ],
      modelsUsed: ['gemini-2.5-pro'],
      outputTokens: 200,
      totalTokens: 1250,
    },
  ],
  totals: { totalTokens: 1250 },
};

const EMPTY_OUTPUT = { daily: [], totals: { totalTokens: 0 } };

function assertSchemaError(run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof CollectError);
    assert.equal(error.kind, 'unsupported_schema');
    return true;
  });
}

test('Claude Code: modelBreakdowns 배열이 날짜·모델 행이 된다', () => {
  const snapshot = parseCcusageDaily('claude_code', CLAUDE_OUTPUT);

  assert.equal(snapshot.provider, 'claude_code');
  assert.equal(snapshot.rows.size, 2);
  assert.deepEqual(
    row(snapshot, '2026-09-26', 'claude-opus-5'),
    tokenCounts(56, 30775, 101361, 2138872),
  );
  assert.deepEqual(
    row(snapshot, '2026-09-26', 'claude-opus-5-5'),
    tokenCounts(40, 6636, 33935, 1082525),
  );
  assert.equal(snapshotTotal(snapshot), 3394200);
});

test('Codex: models 객체에서 읽고 이미 출력에 포함된 추론 토큰을 두 번 세지 않는다', () => {
  const snapshot = parseCcusageDaily('codex', CODEX_OUTPUT);

  assert.deepEqual(row(snapshot, '2026-09-27', 'gpt-5-codex'), tokenCounts(700, 200, 0, 300));
  assert.equal(snapshotTotal(snapshot), 1200);
});

test('Gemini CLI: 분해에 없는 추론 토큰을 그날 출력에 더해 totalTokens 와 맞춘다', () => {
  const snapshot = parseCcusageDaily('gemini_cli', GEMINI_OUTPUT);

  assert.deepEqual(row(snapshot, '2026-09-27', 'gemini-2.5-pro'), tokenCounts(700, 250, 0, 300));
  assert.equal(snapshotTotal(snapshot), 1250);
});

test('Gemini CLI: 모델이 여럿이면 관측 토큰 비율로 나누고 나머지는 가장 큰 모델에 준다', () => {
  const output = {
    daily: [
      {
        date: '2026-09-27',
        totalTokens: 441,
        modelBreakdowns: [
          {
            modelName: 'gemini-3-flash',
            inputTokens: 100,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
          {
            modelName: 'gemini-3-pro',
            inputTokens: 200,
            outputTokens: 100,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
        ],
      },
    ],
  };

  const snapshot = parseCcusageDaily('gemini_cli', output);

  // 추론 41 → pro 300/400 = 30.75 → 30, flash 100/400 = 10.25 → 10, 나머지 1 → pro.
  assert.deepEqual(row(snapshot, '2026-09-27', 'gemini-3-pro'), tokenCounts(200, 131, 0, 0));
  assert.deepEqual(row(snapshot, '2026-09-27', 'gemini-3-flash'), tokenCounts(100, 10, 0, 0));
  assert.equal(snapshotTotal(snapshot), 441);
});

test('기록이 없으면 빈 스냅샷이다', () => {
  for (const provider of ['claude_code', 'codex', 'gemini_cli'] as const) {
    const snapshot = parseCcusageDaily(provider, EMPTY_OUTPUT);
    assert.equal(snapshot.rows.size, 0, provider);
  }
});

test('날짜 합이 totalTokens 보다 크면 스키마 불일치다', () => {
  const broken = structuredClone(GEMINI_OUTPUT);
  const day = broken.daily[0];
  assert.ok(day);
  day.totalTokens = 1100;
  assertSchemaError(() => parseCcusageDaily('gemini_cli', broken));
});

test('Claude Code·Codex 는 날짜 합과 totalTokens 가 다르면 스키마 불일치다', () => {
  const claude = structuredClone(CLAUDE_OUTPUT);
  const claudeDay = claude.daily[0];
  assert.ok(claudeDay);
  claudeDay.totalTokens += 1;
  assertSchemaError(() => parseCcusageDaily('claude_code', claude));

  const codex = structuredClone(CODEX_OUTPUT);
  const codexDay = codex.daily[0];
  assert.ok(codexDay);
  codexDay.totalTokens += 1;
  assertSchemaError(() => parseCcusageDaily('codex', codex));
});

test('예상과 다른 모양은 사용자 문구가 있는 스키마 오류로 거부한다', () => {
  const cases: unknown[] = [
    null,
    'text',
    {},
    { daily: {} },
    { daily: [{ date: '2026-13-45', totalTokens: 0, modelBreakdowns: [] }] },
    { daily: [{ date: '2026-09-27', totalTokens: 0 }] },
    {
      daily: [
        {
          date: '2026-09-27',
          totalTokens: 10,
          modelBreakdowns: [
            {
              modelName: 'x',
              inputTokens: -10,
              outputTokens: 20,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
            },
          ],
        },
      ],
    },
    {
      daily: [
        {
          date: '2026-09-27',
          totalTokens: 1.5,
          modelBreakdowns: [
            {
              modelName: 'x',
              inputTokens: 1.5,
              outputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
            },
          ],
        },
      ],
    },
    {
      daily: [
        {
          date: '2026-09-27',
          totalTokens: 1,
          modelBreakdowns: [
            { inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
          ],
        },
      ],
    },
  ];

  for (const value of cases) assertSchemaError(() => parseCcusageDaily('claude_code', value));
});

test('관측 토큰 정의(8.5)는 변환 뒤에도 그대로다', () => {
  const snapshot = parseCcusageDaily('codex', CODEX_OUTPUT);
  const counts = row(snapshot, '2026-09-27', 'gpt-5-codex');
  assert.ok(counts);
  assert.equal(observed(counts), 700 + 200 + 0 + 300);
});
