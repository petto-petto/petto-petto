const Database = require('better-sqlite3');
const { existsSync, mkdirSync, renameSync } = require('node:fs');
const { dirname } = require('node:path');

/**
 * SQLite 파일과 버전 마이그레이션을 담당하는 범용 인프라 계층.
 *
 * 도메인 테이블·SQL은 이 모듈에 두지 않는다. 다른 feature는 자기 migration과 repository를
 * 전달해 같은 파일 수명주기, WAL, 트랜잭션, 손상 파일 격리 정책을 재사용할 수 있다.
 */
class SqliteFileDatabase {
  #filePath;
  #migrations;
  #database = null;

  constructor({ filePath, migrations = [] }) {
    this.#filePath = filePath;
    this.#migrations = migrations;
  }

  open() {
    if (this.#database) return;
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const existedBeforeOpen = existsSync(this.#filePath);
    try {
      this.#openVerified();
    } catch (error) {
      this.close();
      // SQL migration·권한 설정 오류는 코드/환경 문제이지 파일 손상이 아니다. 정상 DB를
      // quarantine하면 원인을 숨기고 데이터만 잃을 수 있으므로, SQLite 무결성 오류만 격리한다.
      if (!existedBeforeOpen || !isDatabaseCorruption(error)) throw error;
      this.#quarantine(error);
      this.#openVerified();
    }
  }

  close() {
    if (!this.#database) return;
    this.#database.close();
    this.#database = null;
  }

  prepare(sql) {
    return this.#requireDatabase().prepare(sql);
  }

  exec(sql) {
    return this.#requireDatabase().exec(sql);
  }

  /** 주어진 함수 전체를 SQLite 트랜잭션으로 실행한다. */
  transaction(work) {
    const transaction = this.#requireDatabase().transaction(work);
    return transaction();
  }

  /** feature별 migration을 추가 적용한다. 같은 version은 한 번만 실행된다. */
  applyMigrations(migrations) {
    const database = this.#requireDatabase();
    const ordered = [...migrations].sort((left, right) => left.version - right.version);
    for (const migration of ordered) {
      if (!Number.isInteger(migration.version) || migration.version < 1) {
        throw new Error(`유효하지 않은 SQLite migration version: ${migration.version}`);
      }
      const applied = database
        .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
        .get(migration.version);
      if (applied) continue;
      database.transaction(() => {
        migration.up(database);
        database
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
      })();
    }
  }

  #openVerified() {
    const database = new Database(this.#filePath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    const quickCheck = database.pragma('quick_check(1)', { simple: true });
    if (quickCheck !== 'ok') {
      database.close();
      throw new Error(`SQLite 무결성 검사 실패: ${quickCheck}`);
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    this.#database = database;
    this.applyMigrations(this.#migrations);
  }

  #quarantine(error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${this.#filePath}.corrupt-${stamp}`;
    renameSync(this.#filePath, target);
    console.warn(`[DB] 손상된 SQLite 파일을 ${target}로 이동했습니다: ${String(error)}`);
  }

  #requireDatabase() {
    if (!this.#database) throw new Error('SQLite 데이터베이스가 열려 있지 않습니다.');
    return this.#database;
  }
}

function isDatabaseCorruption(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /file is not a database|database disk image is malformed|malformed database schema|무결성 검사 실패/i.test(
    message,
  );
}

module.exports = { SqliteFileDatabase };
