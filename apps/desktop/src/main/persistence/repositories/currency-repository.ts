import { SqliteFileDatabase } from '../sqlite-file.ts';

/** 원장 한 줄. 저장 형식이므로 `entry_id`는 숫자다. */
export interface CurrencyLedgerRow {
  entryId: number;
  reason: string;
  delta: number;
  occurredAt: string;
}

export interface CurrencyTotalsRow {
  earned: number;
  spent: number;
  balance: number;
}

/**
 * 재화 원장 접근. 규칙은 없고 SQL만 있다.
 *
 * 환산 비율이나 "무엇에 지급하는가" 같은 정책은 여기 두지 않는다 — 저장소는 시키는 대로
 * 넣고 물어보는 대로 꺼낸다.
 */
export class CurrencyRepository {
  readonly #database: SqliteFileDatabase;

  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }

  /**
   * 지급을 기록한다. 이미 있는 멱등 키면 아무것도 넣지 않고 `false`.
   *
   * 판정을 `INSERT OR IGNORE`에 맡긴다. 조회한 뒤 삽입하면 두 문장 사이에 끼어든 같은 키의
   * 지급을 막지 못한다.
   */
  recordGrant(dedupeKey: string, amount: number, reason: string, occurredAt: string): boolean {
    const result = this.#database
      .prepare<[string, number, string, string]>(
        `INSERT OR IGNORE INTO currency_ledger (dedupe_key, delta, reason, occurred_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(dedupeKey, amount, reason, occurredAt);
    return result.changes > 0;
  }

  /** 소비를 기록한다. 멱등 키가 없어 같은 이유로 여러 번 쓸 수 있다. */
  recordSpend(amount: number, reason: string, occurredAt: string): void {
    this.#database
      .prepare<[number, string, string]>(
        `INSERT INTO currency_ledger (dedupe_key, delta, reason, occurred_at)
         VALUES (NULL, ?, ?, ?)`,
      )
      .run(-Math.abs(amount), reason, occurredAt);
  }

  /** 이미 지급한 키의 금액. 없으면 `undefined`. */
  grantedAmount(dedupeKey: string): number | undefined {
    const row = this.#database
      .prepare<[string], { delta: number }>(
        'SELECT delta FROM currency_ledger WHERE dedupe_key = ?',
      )
      .get(dedupeKey);
    return row?.delta;
  }

  balance(): number {
    const row = this.#database
      .prepare<[], { balance: number }>(
        'SELECT COALESCE(SUM(delta), 0) AS balance FROM currency_ledger',
      )
      .get();
    return row?.balance ?? 0;
  }

  totals(): CurrencyTotalsRow {
    const row = this.#database
      .prepare<[], { earned: number; spent: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN delta > 0 THEN delta END), 0) AS earned,
           COALESCE(SUM(CASE WHEN delta < 0 THEN -delta END), 0) AS spent
         FROM currency_ledger`,
      )
      .get();
    const earned = row?.earned ?? 0;
    const spent = row?.spent ?? 0;
    return { earned, spent, balance: earned - spent };
  }

  /** 최근 항목. `entry_id` 내림차순이라 같은 시각에 들어온 항목도 순서가 정해진다. */
  recent(limit: number): CurrencyLedgerRow[] {
    return this.#database
      .prepare<[number], CurrencyLedgerRow>(
        `SELECT entry_id AS entryId, reason, delta, occurred_at AS occurredAt
         FROM currency_ledger
         ORDER BY entry_id DESC
         LIMIT ?`,
      )
      .all(Math.max(0, Math.trunc(limit)));
  }
}
