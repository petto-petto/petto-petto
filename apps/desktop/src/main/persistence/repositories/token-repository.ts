import { isProvider } from '@pet/core';
import type { ProviderTokenStats, TokenHistoryEntry, TokenTotals, UsageEntry } from '@pet/client';

import { SqliteFileDatabase } from '../sqlite-file.ts';

const INSERT_HISTORY = `
  INSERT OR IGNORE INTO token_history (provider, observed, reward, dedupe_key, occurred_at)
  VALUES (?, ?, ?, ?, ?)
`;

/** 첫 기록이면 행을 만들고, 있으면 더한다. 읽고 나서 쓰는 두 문장으로 나누지 않는다. */
const UPSERT_STATS = `
  INSERT INTO token_stats (provider, observed, reward, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(provider) DO UPDATE SET
    observed = token_stats.observed + excluded.observed,
    reward = token_stats.reward + excluded.reward,
    updated_at = MAX(COALESCE(token_stats.updated_at, ''), excluded.updated_at)
`;

/** 공용 DB의 토큰 테이블만 접근하는 구체 Repository. 연결 수명주기는 host가 소유한다. */
export class TokenRepository {
  readonly #database: SqliteFileDatabase;

  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }

  /**
   * 통계와 내역을 한 트랜잭션으로 갱신한다.
   *
   * 내역이 들어가지 않았으면(= 이미 본 `dedupeKey`) 통계도 건드리지 않는다. 그래서 둘 중
   * 하나만 반영된 상태가 존재할 수 없다.
   */
  recordUsage(entry: UsageEntry): boolean {
    validateUsageEntry(entry);
    // 검증과 저장이 같은 값을 봐야 한다. 원본을 넣으면 '  k  '와 'k'가 다른 키가 되어
    // 멱등성이 새고, 같은 인입이 공백 차이만으로 두 번 쌓인다.
    const dedupeKey = entry.dedupeKey.trim();
    return this.#database.transaction(() => {
      const inserted = this.#database
        .prepare<[string, number, number, string, string]>(INSERT_HISTORY)
        .run(entry.provider, entry.observed, entry.reward, dedupeKey, entry.occurredAt);
      if (inserted.changes === 0) return false;

      this.#database
        .prepare<[string, number, number, string]>(UPSERT_STATS)
        .run(entry.provider, entry.observed, entry.reward, entry.occurredAt);
      return true;
    });
  }

  statsByProvider(): ProviderTokenStats[] {
    return this.#database
      .prepare<[], ProviderTokenStats>(
        `SELECT provider, observed, reward, updated_at AS updatedAt
         FROM token_stats
         ORDER BY provider`,
      )
      .all();
  }

  totals(): TokenTotals {
    const row = this.#database
      .prepare<[], TokenTotals>(
        `SELECT COALESCE(SUM(observed), 0) AS observed, COALESCE(SUM(reward), 0) AS reward
         FROM token_stats`,
      )
      .get();
    return row ?? { observed: 0, reward: 0 };
  }

  recentHistory(limit: number): TokenHistoryEntry[] {
    return this.#database
      .prepare<[number], TokenHistoryEntry>(
        `SELECT entry_id AS entryId, provider, observed, reward,
                dedupe_key AS dedupeKey, occurred_at AS occurredAt
         FROM token_history
         ORDER BY entry_id DESC
         LIMIT ?`,
      )
      .all(Math.max(0, Math.trunc(limit)));
  }
}

function validateUsageEntry(entry: UsageEntry): void {
  if (!isProvider(entry.provider)) {
    throw new Error(`유효하지 않은 AI 도구입니다: ${String(entry.provider)}`);
  }
  if (!isCount(entry.observed) || !isCount(entry.reward)) {
    throw new Error('토큰 수는 0 이상의 안전한 정수여야 합니다.');
  }
  if (entry.dedupeKey.trim().length === 0) {
    throw new Error('멱등 키는 비어 있을 수 없습니다.');
  }
  if (entry.occurredAt.trim().length === 0) {
    throw new Error('발생 시각은 비어 있을 수 없습니다.');
  }
}

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
