# Feature Contract Rules

Read this rule before adding or changing any contract between feature packages
under `packages/`.

Feature packages own their internals. Only the seams between them are shared, and
this rule governs the seams.

## Three channels

A feature reaches another feature through exactly one of these.

| Channel | Nature | Compile-time dependency |
|---|---|---|
| **Port** | query or command — the consumer pulls | consumer → producer |
| **Event** | a fact, announced — the emitter does not know who listens | none |
| **Injection** | a value handed over — the app fills it | none |

Sort by grammar: a past-tense sentence ("the pet evolved") is an Event; a
present-state noun ("the current size") is an Injection.

## Ownership

- The **producer** publishes the Port and ships its implementation in the same
  package. The consumer imports the interface and calls it.
- The **consumer** brings the list of what it needs as a requirement. A producer
  does not guess at a consumer's needs.
- Event payloads belong to the emitter. The envelope — event id, timestamp,
  schema version — is vocabulary and belongs in `pet-core`.
- An Injection type belongs to the receiver and names nothing outside it. It is
  not a Port: the receiver would need that value even if no other feature
  existed.

## One arrow per pair

A Port is a dependency arrow. **Between one pair of features, only one direction
may be a Port.** The reverse direction uses an Event or an Injection.

The Port goes to the side that needs **behavior**. The side that needs only
**values** is injected.

When both sides need behavior, the boundary is wrong: a concept between them has
no owner. Name that owner rather than routing around the cycle.

`pet-core` holds vocabulary only. Never move a contract there to break a cycle.
Circular project references fail `tsc --build`, and that failure is the signal
that one of the two arrows should not be a Port.

## Failure

A Port throws on failure. It does not return `null` or a zero. A consumer handed
`0` cannot tell "no data" from "lookup failed", so it renders the wrong thing
with no way to detect it.

## Case: two features need each other

`A` needs behavior from `B`; `B` needs a value that `A` owns. Making both a Port
is a cycle and fails the build. Only `A → B` is a Port.

```ts
// packages/feature-b — does not know feature-a exists
export interface BPort {
  perform(): Result;
}

/** B's own input. The name mentions nothing outside B. */
export interface BOptions {
  mode: 'compact' | 'full';
}

export class BService implements BPort {
  #options: BOptions = { mode: 'full' };

  applyOptions(options: BOptions): void {
    this.#options = options;
  }

  perform(): Result {
    /* … */
  }
}
```

```ts
// apps/desktop — the only place that knows both
const b = new BService();
const a = new AService(b); // A → B is the Port

const push = () => b.applyOptions({ mode: a.settings().mode });
push(); // at startup
a.onSettingsChanged(push); // and on every change
```

Arrows: `feature-a → feature-b`, and `feature-b → nothing`.

When `B` cannot hold a copy of the value, inject a reader — `() => BOptions` —
instead. `B` still never imports `A`.
