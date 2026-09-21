import type { SqliteMigration } from '../sqlite-file.ts';

/**
 * AI 도구 토큰 사용량.
 *
 * 통계와 내역 두 테이블이다. 통계는 도구마다 한 행이라 조회가 행 수와 무관하고, 내역은
 * 추가만 하는 원장이라 "언제 얼마가 들어왔나"를 잃지 않는다. 둘은 항상 한 트랜잭션에서
 * 함께 바뀌므로 `token_stats.observed`는 같은 도구의 `token_history.observed` 합과 같다.
 *
 * `dedupe_key`의 `UNIQUE`가 중복 적재를 **데이터베이스가** 막게 만든다. 응용 코드에서
 * 조회한 뒤 삽입하면 두 문장 사이에 끼어든 같은 인입을 놓친다.
 *
 * 모든 수량이 `>= 0`이라 음수가 구조적으로 불가능하다. 사용량은 누적만 하고 차감하지
 * 않는다 — 소비할 수 있는 잔액은 재화 도메인의 것이다.
 *
 * 상한을 거는 이유: `better-sqlite3`는 JS 안전 정수를 넘는 값을 거부하지 않고 조용히
 * 받는다. 그대로 두면 정밀도가 깨진 값이 오류 없이 저장되고 이후 합계가 어긋난다.
 */
export const TOKEN_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'token',
    version: 1,
    name: 'create token stats and history',
    up(database) {
      database.exec(`
        CREATE TABLE token_stats (
          provider TEXT PRIMARY KEY NOT NULL,
          observed INTEGER NOT NULL DEFAULT 0
            CHECK (typeof(observed) = 'integer' AND observed BETWEEN 0 AND 9007199254740991),
          reward INTEGER NOT NULL DEFAULT 0
            CHECK (typeof(reward) = 'integer' AND reward BETWEEN 0 AND 9007199254740991),
          updated_at TEXT
        );

        CREATE TABLE token_history (
          entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          observed INTEGER NOT NULL
            CHECK (typeof(observed) = 'integer' AND observed BETWEEN 0 AND 9007199254740991),
          reward INTEGER NOT NULL
            CHECK (typeof(reward) = 'integer' AND reward BETWEEN 0 AND 9007199254740991),
          dedupe_key TEXT NOT NULL UNIQUE,
          occurred_at TEXT NOT NULL
        );

        CREATE INDEX token_history_provider ON token_history (provider, occurred_at);
        CREATE INDEX token_history_recent ON token_history (entry_id DESC);
      `);
    },
  },
];
