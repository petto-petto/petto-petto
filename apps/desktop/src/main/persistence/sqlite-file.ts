import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

/**
 * 데스크톱 host가 소유하는 범용 SQLite 파일 수명주기.
 *
 * feature별 테이블과 SQL은 이 모듈에 두지 않는다. 각 feature는 migration과 repository를
 * 전달해 WAL, 트랜잭션, 손상 파일 격리 정책만 함께 쓴다.
 */
export interface SqliteMigration {
  version: number;
  name: string;
  up(database: Database.Database): void;
}

export interface SqliteFileDatabaseOptions {
  filePath: string;
  migrations?: readonly SqliteMigration[];
}

export class SqliteFileDatabase {
  readonly filePath: string;
  readonly migrations: readonly SqliteMigration[];
  #database: Database.Database | undefined;

  constructor({ filePath, migrations = [] }: SqliteFileDatabaseOptions) {
    this.filePath = filePath;
    this.migrations = migrations;
  }

  open(): void {
    if (this.#database) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const existedBeforeOpen = existsSync(this.filePath);
    try {
      this.#openVerified();
    } catch (error) {
      this.close();
      if (!existedBeforeOpen || !isDatabaseCorruption(error)) throw error;
      this.#quarantine(error);
      this.#openVerified();
    }
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
  }

  prepare(sql: string): Database.Statement {
    return this.#requireDatabase().prepare(sql);
  }

  exec(sql: string): void {
    this.#requireDatabase().exec(sql);
  }

  transaction<T>(work: () => T): T {
    return this.#requireDatabase().transaction(work)();
  }

  applyMigrations(migrations: readonly SqliteMigration[]): void {
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

  #openVerified(): void {
    const database = new Database(this.filePath);
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
    this.applyMigrations(this.migrations);
  }

  #quarantine(error: unknown): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${this.filePath}.corrupt-${stamp}`;
    renameSync(this.filePath, target);
    console.warn(`[DB] 손상된 SQLite 파일을 ${target}로 이동했습니다: ${String(error)}`);
  }

  #requireDatabase(): Database.Database {
    if (!this.#database) throw new Error('SQLite 데이터베이스가 열려 있지 않습니다.');
    return this.#database;
  }
}

function isDatabaseCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /file is not a database|database disk image is malformed|malformed database schema|무결성 검사 실패/i.test(
    message,
  );
}
