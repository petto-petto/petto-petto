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
  scope: string;
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
  readonly #migrations: readonly SqliteMigration[];
  #database: Database.Database | undefined;

  constructor({ filePath, migrations = [] }: SqliteFileDatabaseOptions) {
    this.filePath = filePath;
    this.#migrations = migrations;
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

  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Database.Statement<BindParameters, Result> {
    return this.#requireDatabase().prepare<BindParameters, Result>(sql);
  }

  exec(sql: string): void {
    this.#requireDatabase().exec(sql);
  }

  transaction<T>(work: () => T): T {
    return this.#requireDatabase().transaction(work)();
  }

  #applyMigrations(migrations: readonly SqliteMigration[]): void {
    const database = this.#requireDatabase();
    const keys = new Set<string>();
    for (const migration of migrations) {
      if (!/^[a-z][a-z0-9-]*$/.test(migration.scope)) {
        throw new Error(`유효하지 않은 SQLite migration scope: ${migration.scope}`);
      }
      if (!Number.isInteger(migration.version) || migration.version < 1) {
        throw new Error(`유효하지 않은 SQLite migration version: ${migration.version}`);
      }
      if (migration.name.trim().length === 0) {
        throw new Error('SQLite migration name은 비어 있을 수 없습니다.');
      }
      const key = `${migration.scope}/${migration.version}`;
      if (keys.has(key)) throw new Error(`중복된 SQLite migration: ${key}`);
      keys.add(key);
    }

    const ordered = [...migrations].sort(
      (left, right) => left.scope.localeCompare(right.scope) || left.version - right.version,
    );
    for (const migration of ordered) {
      const applied = database
        .prepare<[string, number], { name: string }>(
          'SELECT name FROM schema_migrations WHERE scope = ? AND version = ?',
        )
        .get(migration.scope, migration.version);
      if (applied) {
        if (applied.name !== migration.name) {
          throw new Error(
            `변경된 SQLite migration: ${migration.scope}/${migration.version} (${applied.name} -> ${migration.name})`,
          );
        }
        continue;
      }

      const legacy = database
        .prepare<[number, string], { applied_at: string }>(
          `
          SELECT applied_at
          FROM schema_migrations
          WHERE scope = 'legacy' AND version = ? AND name = ?
        `,
        )
        .get(migration.version, migration.name);
      if (legacy) {
        database.transaction(() => {
          database
            .prepare(
              'INSERT INTO schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)',
            )
            .run(migration.scope, migration.version, migration.name, legacy.applied_at);
          database
            .prepare(
              "DELETE FROM schema_migrations WHERE scope = 'legacy' AND version = ? AND name = ?",
            )
            .run(migration.version, migration.name);
        })();
        continue;
      }

      database.transaction(() => {
        migration.up(database);
        database
          .prepare(
            'INSERT INTO schema_migrations (scope, version, name, applied_at) VALUES (?, ?, ?, ?)',
          )
          .run(migration.scope, migration.version, migration.name, new Date().toISOString());
      })();
    }
  }

  #openVerified(): void {
    const database = new Database(this.filePath);
    this.#database = database;
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    const quickCheck = database.pragma('quick_check(1)', { simple: true });
    if (quickCheck !== 'ok') {
      throw new Error(`SQLite 무결성 검사 실패: ${quickCheck}`);
    }
    ensureMigrationTable(database);
    this.#applyMigrations(this.#migrations);
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

interface MigrationTableColumn {
  name: string;
}

function ensureMigrationTable(database: Database.Database): void {
  const exists = database
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (!exists) {
    createMigrationTable(database);
    return;
  }

  const columns = database
    .prepare<[], MigrationTableColumn>('PRAGMA table_info(schema_migrations)')
    .all();
  if (columns.some((column) => column.name === 'scope')) return;

  database.transaction(() => {
    database.exec('ALTER TABLE schema_migrations RENAME TO schema_migrations_legacy');
    createMigrationTable(database);
    database.exec(`
      INSERT INTO schema_migrations (scope, version, name, applied_at)
      SELECT 'legacy', version, name, applied_at
      FROM schema_migrations_legacy;
      DROP TABLE schema_migrations_legacy;
    `);
  })();
}

function createMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version)
    )
  `);
}

function isDatabaseCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /file is not a database|database disk image is malformed|malformed database schema|무결성 검사 실패/i.test(
    message,
  );
}
