# Feature Contract Rules

Read this rule before reading or writing data that another feature owns.

Feature packages own their internals. Only the seams between them are shared, and this
rule governs the seams.

## The chain

```
call site  →  Port (one per table)  →  Port implementation  →  persistence layer
```

**The consumer builds the whole chain.** A screen that needs a number from another
feature's table gets its author to write the Port, write the implementation, and call
the shared database. Nobody waits on anybody: the owner is not blocked writing an API
for a caller they cannot see, and the caller is not blocked waiting for it.

Where each link lives:

| Link | Home | Why there |
|---|---|---|
| Port interface | the consumer's package, `src/ports/` | it describes what the consumer needs, not everything the table can do |
| Implementation | `apps/desktop/src/main/` | only the app reaches the database |
| Repository | `apps/desktop/src/main/persistence/repositories/` | SQL lives in one place per feature |

The consumer's package never imports another feature package and never imports the
database driver. It declares an interface; the app injects something that satisfies it.

## Rules

- **One Port per table.** Its methods are the reads and writes this consumer needs.
  Resist adding a method "while we're here" — an unused method is a promise nobody
  checks.
- **A Port implementation holds no rules.** It turns rows into the shape the call site
  wants. A calculation that would still be true without a database belongs in a domain
  package.
- **Only the owning feature creates or alters its table.** Need a column that does not
  exist yet? Ask the owner. Do not add it under their migration scope — scopes collide
  and the owner's next migration then fights yours.
- **Never query another feature's table from a call site.** A raw query outside a Port
  spreads that table's schema through the codebase, and the owner cannot change it
  without breaking code they cannot find.
- **A Port throws on failure.** It does not return `null` or a zero. A caller handed
  `0` cannot tell "no rows" from "read failed", so it renders the wrong thing with no
  way to detect it.
- **Facts that exist only at one moment must be stored by the owner.** A table holding
  current state cannot answer "was the best streak ever 10?" or "were both parents
  COMMON at the time?". If a consumer needs history, that is a column request to the
  owner, not something the consumer can derive.

## Persistence

One `petto.sqlite`, one migration scope per feature, one repository per feature. The
procedure — scopes, versions, registration, lifecycle — is in
[`apps/desktop/src/main/persistence/README.md`](../../apps/desktop/src/main/persistence/README.md).
Read it before adding a table.

## Worked example

`meta` shows a coin balance it does not own. The whole chain, consumer-built:

```ts
// packages/pet-meta/src/ports/  — the interface. No driver, no SQL.
export interface CurrencyPort {
  balance(): Coin;
  grantOnce(rewardKey: string, amount: Coin, reason: string): GrantOutcome;
}
```

```ts
// apps/desktop/src/main/persistence/repositories/  — SQL only, no rules.
recordGrant(dedupeKey: string, amount: number, reason: string, at: string): boolean {
  const result = this.#database
    .prepare('INSERT OR IGNORE INTO currency_ledger (dedupe_key, delta, reason, occurred_at) VALUES (?, ?, ?, ?)')
    .run(dedupeKey, amount, reason, at);
  return result.changes > 0;
}
```

```ts
// apps/desktop/src/main/  — the implementation. Shapes rows, translates failure.
export class SqliteCurrencyPort implements CurrencyPort {
  balance(): Coin {
    try {
      return this.#repository.balance();
    } catch (error) {
      throw new PortError(`잔액을 불러오지 못했어요 (${String(error)})`);
    }
  }
}
```

The app constructs the implementation and hands it to `meta`. `pet-meta` compiles
without `better-sqlite3` and its rules stay testable without a database.

Two details in that example are the contract, not decoration. The balance is
`SUM(delta)` rather than a stored column, because two numbers that must agree
eventually disagree and then neither is trusted. Idempotency is a `UNIQUE` key plus
`INSERT OR IGNORE`, because reading before inserting cannot stop a second insert that
lands between the two statements.
