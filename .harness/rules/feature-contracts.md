# Feature Contract Rules

Read this rule before reading or writing data that belongs to another domain.

Feature packages own their internals. Only the seams between them are shared, and this
rule governs the seams.

## The chain

```
call site  →  Port  →  Port implementation  →  Repository  →  persistence layer
```

**The feature doing the work declares the Port.** When your feature needs another
domain's data, you declare the interface for what you read and write, and you write its
implementation and repository over the tables `petto.sqlite` already declares. You do
not hand the domain's author a request and wait for them to publish it.

**Reuse before declaring.** If a Port for that domain already exists, import its type
and call it. `PetClient` and `TokenClient` in `packages/pet-client/` are the existing
ones. Narrow it with `Pick` when you need one method; add a method to it when it lacks
one. A second interface over the same table is a second contract, and the two drift the
first time one of them changes.

Where each link lives:

| Link | Home |
|---|---|
| Port interface and data types | `packages/pet-client/` when more than one feature calls it; otherwise the calling package's `src/ports/` |
| Implementation | `apps/desktop/src/main/clients/`, or an adapter beside `main.ts` for a Port one feature declared — only the app reaches the database |
| Repository | `apps/desktop/src/main/persistence/repositories/` |
| Assembly | `apps/desktop/src/main/main.ts` builds the instance once and hands it out |
| Call site | the calling package, depending on the Port for types only |

A feature package never imports another feature's package or the database driver. A
Port is types only, so importing it opens no connection.

## Rules

- **One Port per domain.** Split by the domain the data belongs to — pet, token, gacha
  — not by caller and not by table. Its methods cover what that domain's callers need,
  even when the domain spans several tables.
- **Read what the database declares.** A Port is built over tables and columns that
  exist. Do not infer one domain's value from another domain's table: a count derived
  from an unrelated ledger breaks when that ledger's keys or amounts change.
- **A Port implementation holds no rules.** It turns rows into the Port's types. A
  calculation that would still be true without a database belongs in a domain package.
- **Only the owning feature creates or alters its tables.** Building a Port over
  someone's table does not make the table yours. A column added under their migration
  scope collides with their next migration.
- **Never query a table from a call site.** A raw query outside a Port spreads that
  schema through the codebase, and the table cannot change without breaking code nobody
  can find.
- **A read failure throws.** `null`, `[]` and `0` mean a real empty result — no active
  pet, no pets, nothing counted — and never stand in for “could not read”. A caller
  handed `0` for a failure renders the wrong thing with no way to detect it.
- **Mock what no table holds yet.** When the domain is still being built and the table
  or column does not exist, declare the Port for what you need and inject a mock
  implementation. A fact that exists only at one moment counts as missing too: a table
  holding current state cannot answer “was the best streak ever 10?”. Replace the mock
  with the SQLite implementation when the table lands; only the assembly changes. Name
  the mock so that nobody reads its numbers as real.

## Persistence

One `petto.sqlite`, one migration scope per feature, one repository per feature. The
procedure — scopes, versions, registration, lifecycle — is in
[`apps/desktop/src/main/persistence/README.md`](../../apps/desktop/src/main/persistence/README.md).
Read it before adding a table.

## Worked example

`meta` needs three domains. Each one shows a different branch of the rule.

**Pet — a Port exists, so reuse it.**

```ts
// packages/pet-meta — imports the existing type, receives the instance.
import type { PetClient } from '@pet/client';

const active = pets.getActivePet(); // null = nothing selected, not a failure
```

**Token — a Port exists, so narrow it to the methods you call and add the one it lacks.**

```ts
// packages/pet-meta/src/ports/index.ts — no new interface over the token tables.
import type { TokenClient } from '@pet/client';

export type TokenPort = Pick<
  TokenClient,
  'recordUsage' | 'grantOnce' | 'balance' | 'earnedSince'
>;
```

```ts
// packages/pet-client/src/token.ts — `meta` needed today's total, so the method went here.
export interface TokenClient {
  earnedSince(since: string): number;
  // …
}
```

```ts
// apps/desktop/src/main/main.ts — the same instance gacha and combine spend from.
const tokens: TokenClient = new SqliteTokenClient(
  new TokenRepository(database),
  currencyRepository,
);
```

**Gacha — no table holds the draw count yet, so declare the Port and mock it.**

```ts
// packages/pet-meta/src/ports/index.ts — declared by the feature that needs it.
export interface GachaPort {
  drawCount(): number;
  // …
}
```

```ts
// packages/pet-meta/src/testing/fakes.ts — stands in until gacha stores its draws.
export class StubGacha implements GachaPort {
  /* … */
}
```

What each `PetClient` method guarantees is in
[`docs/pet-client-handoff.md`](../../docs/pet-client-handoff.md).
