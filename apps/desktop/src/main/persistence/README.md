# Shared SQLite Persistence Guide

This directory contains the shared local SQLite persistence layer used by the Electron main
process. All features share one `petto.sqlite` file and one `SqliteFileDatabase` instance.

## Directory Structure

```text
persistence/
├── sqlite-file.ts                    # Connection, transactions, integrity checks, and migrations
├── migrations/
│   ├── index.ts                      # Central registry for all feature migrations
│   └── overlay-growth.ts             # Overlay growth table migrations
└── repositories/
    └── pet-growth-repository.ts      # Overlay growth data access
```

Place IPC code that connects renderers to repositories in `../ipc/`. Do not put Electron IPC or
renderer concerns in a repository.

## Adding Persistence for a Feature

### 1. Create the Feature Migrations

Create `migrations/<feature>.ts` and define the tables and indexes owned by that feature.

```ts
import type { SqliteMigration } from '../sqlite-file.ts';

export const BATTLE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    scope: 'battle',
    version: 1,
    name: 'create battle records',
    up(database) {
      database.exec(`
        CREATE TABLE battle_records (
          id TEXT PRIMARY KEY,
          result TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
];
```

### 2. Use a Unique Scope and Sequential Versions

The `scope` identifies a feature. Use lowercase letters, numbers, and hyphens.

```text
overlay-growth
battle
pet-room
collection
```

Start `version` at 1 and increment it within the same scope. Different features may use the same
version number.

```text
overlay-growth / 1
overlay-growth / 2
battle         / 1
pet-room       / 1
```

Never modify the `scope`, `version`, `name`, or SQL of a migration that has been released. Add the
next version under the same scope when the schema needs to change.

### 3. Register Migrations Centrally

Add the migrations to `APP_MIGRATIONS` in `migrations/index.ts`.

```ts
import type { SqliteMigration } from '../sqlite-file.ts';
import { BATTLE_MIGRATIONS } from './battle.ts';
import { OVERLAY_GROWTH_MIGRATIONS } from './overlay-growth.ts';

export const APP_MIGRATIONS: readonly SqliteMigration[] = [
  ...BATTLE_MIGRATIONS,
  ...OVERLAY_GROWTH_MIGRATIONS,
];
```

At startup, `SqliteFileDatabase` receives this list and applies each pending migration in a
transaction.

### 4. Create a Feature Repository

Add feature queries to `repositories/<feature>-repository.ts`. A repository receives the shared
`SqliteFileDatabase` through its constructor.

```ts
import { SqliteFileDatabase } from '../sqlite-file.ts';

export class BattleRepository {
  readonly #database: SqliteFileDatabase;

  constructor(database: SqliteFileDatabase) {
    this.#database = database;
  }

  saveResult(id: string, result: string): void {
    this.#database
      .prepare<[string, string, string]>(
        'INSERT INTO battle_records (id, result, created_at) VALUES (?, ?, ?)',
      )
      .run(id, result, new Date().toISOString());
  }
}
```

A repository must only read and write tables owned by its feature. When one feature needs data
from another, use that feature's repository or an explicit port instead of querying its tables
directly.

### 5. Do Not Manage the Database Lifecycle in a Repository

Do not add `open()` or `close()` methods to a repository. Closing the shared database from one
repository would make it unavailable to every other feature.

Only `../main.ts` owns the database lifecycle.

```ts
appDatabase = new SqliteFileDatabase({
  filePath: join(directory, 'petto.sqlite'),
  migrations: APP_MIGRATIONS,
});
appDatabase.open();

const battleRepository = new BattleRepository(appDatabase);

app.on('before-quit', () => {
  appDatabase?.close();
});
```

Feature code receives the already-open `appDatabase` and must not add another `open()` or `close()`
call.

### 6. Register IPC Separately

When a renderer needs repository access, register only the allowed IPC channels in
`../ipc/<feature>.ts`. Never allow a renderer to submit or execute arbitrary SQL.

## Restrictions

- Do not create a separate `petto.sqlite` connection for each feature.
- Do not call `SqliteFileDatabase.open()` or `close()` from a repository.
- Do not modify or remove a released migration.
- Do not reuse another feature's migration `scope`.
- Do not use `better-sqlite3` directly from a renderer or preload script.
- Do not accept SQL strings or table names from renderer input.
- Do not perform long-running calculations or file operations inside a SQLite transaction.

## Testing and Verification

Changes to SQLite infrastructure or a repository must cover at least the following cases:

- Different scopes using the same version are both applied.
- A migration is not applied again after the application restarts.
- A failed migration rolls back its changes.
- Existing data survives a migration from the legacy schema.
- Repository data survives a close-and-reopen cycle.

Run the desktop SQLite tests:

```bash
npm run test:storage --workspace @pet/desktop
```

Then run the shared verification suite:

```bash
bash .harness/scripts/verify-electron.sh
```

Automated tests must not launch the Electron GUI. Run `npm start` only when manual UI verification
is required.

## Packaging Notes

`better-sqlite3` is a native module. When producing macOS or Windows distributables, rebuild it for
the target Electron version, operating system, and CPU architecture. The current development
command is:

```bash
npm run rebuild:native --workspace @pet/desktop
```

When a packaging tool is introduced, configure it to unpack the `better-sqlite3` native binary
from ASAR.
