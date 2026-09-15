import type { SqliteMigration } from '../sqlite-file.ts';

/**
 * 재화 원장.
 *
 * 잔액을 따로 저장하지 않고 `delta` 합으로 구한다. 두 값을 함께 들고 있으면 둘이
 * 어긋나는 순간이 생기고, 그때 어느 쪽이 진실인지 정할 방법이 없다.
 *
 * `dedupe_key`의 `UNIQUE`가 멱등성을 **데이터베이스가** 보장하게 만든다. 지급 중복 방지를
 * 응용 코드의 조회-후-삽입으로 하면 그 사이에 끼어드는 두 번째 지급을 막지 못한다.
 * SQLite의 `UNIQUE`는 여러 개의 `NULL`을 허용하므로, 멱등 키가 없는 소비 항목은 서로
 * 충돌하지 않는다.
 */
export const CURRENCY_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'currency',
    version: 1,
    name: 'create currency ledger',
    up(database) {
      database.exec(`
        CREATE TABLE currency_ledger (
          entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
          dedupe_key TEXT UNIQUE,
          reason TEXT NOT NULL,
          delta INTEGER NOT NULL,
          occurred_at TEXT NOT NULL
        );

        CREATE INDEX currency_ledger_recent ON currency_ledger (entry_id DESC);
        CREATE INDEX currency_ledger_occurred_at ON currency_ledger (occurred_at);
      `);
    },
  },
];
