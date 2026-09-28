# Feature Contract Rules

Read this rule before reading or writing data that another feature owns, or before
exposing your own feature's data to others.

Feature packages own their internals. Only the seams between them are shared, and this
rule governs the seams.

## The chain

```
call site  →  Port  →  Port implementation  →  Repository  →  persistence layer
```

**The owning feature declares the Port.** The feature that owns a table also publishes
the interface for reading and writing it, ships the implementation, and writes the
repository. A consumer imports the interface type, receives an instance, and calls it.

The owner knows its tables, its invariants, and what can safely change. A consumer that
declares its own interface for someone else's data guesses at all three, and two
consumers guessing differently split one table into two contracts.

Where each link lives:

| Link | Home | Written by |
|---|---|---|
| Port interface and data types | the owner's contract package, e.g. `packages/pet-client/` | owner |
| Implementation | `apps/desktop/src/main/clients/` — only the app reaches the database | owner |
| Repository | `apps/desktop/src/main/persistence/repositories/` | owner |
| Assembly | `apps/desktop/src/main/main.ts` builds the instance once and hands it out | owner |
| Call site | the consumer's package, depending on the contract package for types only | consumer |

A consumer's package never imports another feature's implementation or the database
driver. The contract package contains types only, so importing it opens no connection.

## Rules

- **One Port per owning domain.** Its methods cover what that domain's consumers need,
  even when the domain spans several tables.
- **Consumers bring requirements; owners decide the shape.** Tell the owner what you
  read, where you show it, and how often. The owner turns that into methods.
- **A Port implementation holds no rules.** It turns rows into the published types. A
  calculation that would still be true without a database belongs in a domain package.
- **Only the owning feature creates or alters its tables.** Need a column that does not
  exist? Ask the owner. Do not add it under their migration scope — scopes collide and
  the owner's next migration then fights yours.
- **Never query another feature's table from a call site.** A raw query outside the
  owner's Port spreads that schema through the codebase, and the owner cannot change it
  without breaking code they cannot find.
- **A read failure throws.** `null`, `[]` and `0` mean a real empty result — no active
  pet, no pets, nothing counted — and never stand in for “could not read”. A caller
  handed `0` for a failure renders the wrong thing with no way to detect it.
- **Facts that exist only at one moment must be stored by the owner.** A table holding
  current state cannot answer “was the best streak ever 10?” or “were both parents
  COMMON at the time?”. That is a column request to the owner, not something a consumer
  can derive.

## Persistence

One `petto.sqlite`, one migration scope per feature, one repository per feature. The
procedure — scopes, versions, registration, lifecycle — is in
[`apps/desktop/src/main/persistence/README.md`](../../apps/desktop/src/main/persistence/README.md).
Read it before adding a table.

## Worked example

The pet domain is the reference. Its owner published everything; `meta` only calls it.

```ts
// packages/pet-client/src/index.ts — owner. Types only, no driver.
export interface PetClient {
  getActivePet(): OwnedPet | null; // null = nothing selected, not a failure
  countOwnedSpecies(): number;
  // …
}
```

```ts
// apps/desktop/src/main/clients/sqlite-pet-client.ts — owner. No rules, delegates.
export class SqlitePetClient implements PetClient {
  getActivePet(): OwnedPet | null {
    return this.#repository.getActivePet();
  }
}
```

```ts
// apps/desktop/src/main/main.ts — assembled once over the shared database.
const pets: PetClient = new SqlitePetClient(new PetRepository(appDatabase));
```

```ts
// packages/pet-meta — consumer. Imports the type, receives the instance.
import type { PetClient } from '@pet/client';

const active = pets.getActivePet();
```

The procedure for adopting it, and what each method guarantees, is in the owner's
handoff: [`docs/pet-client-handoff.md`](../../docs/pet-client-handoff.md).
