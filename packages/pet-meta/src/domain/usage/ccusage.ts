/**
 * 고정 버전 `ccusage`의 `daily --json` 출력을 `SourceSnapshot`으로 바꾸는 어댑터.
 * 기획서 8.1의 "버전이 고정된 JSON 어댑터"가 이 파일이다.
 *
 * ## 도구마다 모양이 다르다 (`ccusage@20.0.24`에서 확인)
 *
 * - Claude Code·Gemini CLI: `daily[].modelBreakdowns[]` 배열. 모델명은 `modelName`.
 * - Codex: `daily[].models` 객체. 키가 모델명이다. `inputTokens`는 캐시를 뺀 입력이고
 *   `outputTokens`에 추론이 이미 들어 있으므로 `reasoningOutputTokens`는 읽지 않는다.
 *   합성 세션(입력 1000 · 캐시 300 · 출력 200 · 추론 50)이 700/300/200, 합 1200으로 나왔다.
 * - Gemini CLI: 추론(thoughts) 토큰이 모델별 분해에 없고 날짜의 `totalTokens`에만 있다.
 *   같은 합성 세션이 필드 합 1200, `totalTokens` 1250으로 나왔다. 그래서 차이를 그날 모델들의
 *   출력에 나눠 더한다. 빼 버리면 추론을 많이 하는 모델일수록 사용량이 적게 잡힌다.
 *
 * 어느 도구든 변환 뒤 날짜별 관측 토큰 합은 그날 `totalTokens`와 같아야 한다. 맞지 않으면
 * ccusage 출력의 의미가 바뀐 것이므로 추측하지 않고 `unsupported_schema`로 멈춘다.
 */

import { parseLocalDate, type LocalDate, type Provider } from '@pet/core';

import { CollectError, rowKey, type SnapshotRows, type SourceSnapshot } from './collector.ts';
import { addTokens, observed, tokenCounts, type TokenCounts } from './tokens.ts';

interface ModelUsage {
  model: string;
  counts: TokenCounts;
}

const schemaError = (): CollectError => new CollectError('unsupported_schema');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function count(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw schemaError();
  return value;
}

function countsOf(source: Record<string, unknown>): TokenCounts {
  return tokenCounts(
    count(source, 'inputTokens'),
    count(source, 'outputTokens'),
    count(source, 'cacheCreationTokens'),
    count(source, 'cacheReadTokens'),
  );
}

function breakdownArray(day: Record<string, unknown>): ModelUsage[] {
  const breakdowns = day['modelBreakdowns'];
  if (!Array.isArray(breakdowns)) throw schemaError();
  return breakdowns.map((entry: unknown) => {
    if (!isRecord(entry)) throw schemaError();
    const model = entry['modelName'];
    if (typeof model !== 'string' || model === '') throw schemaError();
    return { model, counts: countsOf(entry) };
  });
}

function breakdownObject(day: Record<string, unknown>): ModelUsage[] {
  const models = day['models'];
  if (!isRecord(models)) throw schemaError();
  return Object.entries(models).map(([model, entry]) => {
    if (model === '' || !isRecord(entry)) throw schemaError();
    return { model, counts: countsOf(entry) };
  });
}

/**
 * 추론 토큰을 모델별 관측 토큰 비율로 나눠 출력에 더한다.
 *
 * 내림으로 나눈 뒤 남는 몇 토큰은 관측 토큰이 가장 큰 모델에 준다. 그래야 날짜 합이
 * `totalTokens`와 정확히 같다. 동률이면 앞의 모델이다 — 입력 순서가 같으면 결과도 같다.
 */
function distributeReasoning(usages: ModelUsage[], reasoning: number): ModelUsage[] {
  const base = usages.reduce((sum, usage) => sum + observed(usage.counts), 0);
  if (reasoning === 0) return usages;
  if (usages.length === 0) throw schemaError();

  const shares = usages.map((usage) =>
    base === 0 ? 0 : Math.floor((reasoning * observed(usage.counts)) / base),
  );
  let largest = 0;
  usages.forEach((usage, index) => {
    const current = usages[largest];
    if (current && observed(usage.counts) > observed(current.counts)) largest = index;
  });
  const distributed = shares.reduce((sum, share) => sum + share, 0);
  shares[largest] = (shares[largest] ?? 0) + (reasoning - distributed);

  return usages.map((usage, index) => ({
    model: usage.model,
    counts: { ...usage.counts, output: usage.counts.output + (shares[index] ?? 0) },
  }));
}

function parseDay(provider: Provider, day: unknown): { date: LocalDate; usages: ModelUsage[] } {
  if (!isRecord(day)) throw schemaError();

  const rawDate = day['date'];
  const date = typeof rawDate === 'string' ? parseLocalDate(rawDate) : undefined;
  if (date === undefined) throw schemaError();

  const total = count(day, 'totalTokens');
  const usages = provider === 'codex' ? breakdownObject(day) : breakdownArray(day);
  const sum = usages.reduce((acc, usage) => acc + observed(usage.counts), 0);
  const gap = total - sum;

  if (gap < 0) throw schemaError();
  if (gap > 0 && provider !== 'gemini_cli') throw schemaError();

  return { date, usages: distributeReasoning(usages, gap) };
}

/** `ccusage <도구> daily --json` 출력 하나를 누적 스냅샷으로 바꾼다. 실패하면 `CollectError`. */
export function parseCcusageDaily(provider: Provider, output: unknown): SourceSnapshot {
  if (!isRecord(output) || !Array.isArray(output['daily'])) throw schemaError();

  const rows: SnapshotRows = new Map();
  for (const entry of output['daily']) {
    const { date, usages } = parseDay(provider, entry);
    for (const usage of usages) {
      const key = rowKey(date, usage.model);
      const existing = rows.get(key);
      rows.set(key, existing ? addTokens(existing, usage.counts) : usage.counts);
    }
  }
  return { provider, rows };
}
