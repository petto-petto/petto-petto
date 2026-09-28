# Feature contract rules

## Evidence

- Request: put the team's Port convention into the harness and manage it there —
  abstracted, summarised, one worked case. Plus a Korean twin for teammates.
- Repeated friction: three separate questions in one session asked the same
  thing — who owns a Port, whether two-way Ports are a cycle, and which channels
  exist besides Port and Event. Each was answered in conversation only, so the
  answer never reached the repository or the other four feature owners.
- Affected canonical files: `AGENTS.md`, `.harness/rules/`,
  `.harness/tests/verify-contract.sh`, `.harness/README.md`,
  `.harness/CHANGELOG.md`.
- Baseline reproduction:

  ```bash
  git grep -n -iE "생산자가 공표|Port는 한 방향" -- AGENTS.md .harness/rules
  ```

  returned no match. The convention existed only in a comment inside
  `packages/pet-meta/src/ports/index.ts`, which another feature owner has no
  reason to open.

- Contract baseline before the change: `bash .harness/tests/verify-contract.sh`
  exited 0, so every failure recorded below belongs to this change.

## Root cause

Missing instruction. Not an ownership gap: `.harness/rules/` already owns rules
and `electron.md` established the pattern. The rule document itself was absent.

## Pruning

- Canonical owner: `.harness/rules/feature-contracts.md`.
- No duplication with `electron.md`, which governs layer separation inside the
  Electron app rather than contracts between feature packages.
- Dropped from the source draft because it is point-in-time material that would
  become sediment inside a rule: one feature's fourteen concrete requirements,
  the per-domain implementation status table, and real source paths. Those stay
  in the feature's own requirements document.
- Reduced to one worked case (two features needing each other) with abstract
  `A`/`B` names, so the rule teaches the shape rather than this week's code.
- `.harness/guides/feature-contracts-kr.html` is the human reading of the rule.
  It adds no instruction the rule does not carry; the rule stays the single
  source of truth.

## Approval

Approved by the requester on 2026-09-03: write the harness rule in English to
match `electron.md` and `skill-authoring.md`, and add one Korean guide for
teammates.

## RED

```bash
bash .harness/tests/verify-contract.sh
```

```text
FAIL: missing file: .harness/rules/feature-contracts.md
FAIL: missing file: .harness/guides/feature-contracts-kr.html
FAIL: README is missing Korean guide pointer: .harness/guides/feature-contracts-kr.html
FAIL: AGENTS.md is missing required guidance: .harness/rules/feature-contracts.md
```

Exit code 1.

## GREEN

The same command after adding the rule, the guide, the `AGENTS.md` pointer, and
the README pointer: no `FAIL` lines, exit code 0.

## Contract verification

`bash .harness/tests/verify-contract.sh` ends with `Contract verification
passed.` and exits 0.

## CHANGELOG.md

Recorded under `## Unreleased` / `### Added`. Changed canonical files:
`.harness/rules/feature-contracts.md` (new),
`.harness/guides/feature-contracts-kr.html` (new), `AGENTS.md`,
`.harness/README.md`, `.harness/tests/verify-contract.sh`.

## Completion

The rule exists, `AGENTS.md` points at it, the Korean guide is listed in
`.harness/README.md`, and the contract check enforces all four.

Remaining gaps, deliberately out of this change because they need team agreement
and touch other owners' packages:

- Seven of the eight event payload types are still declared by the consumer in
  `packages/pet-meta/src/events/index.ts` rather than by their emitters.
- The event envelope has not been moved to `pet-core`.
- `CollectionPort` is still consumer-declared with an adapter in
  `apps/desktop/src/main/collection.ts`.


---

# 2026-09-09 — Event 채널을 버리고 테이블 단위 Port 로 좁힘

## Evidence

- Team decision on 2026-09-09: drop the Event channel and the producer-publishes rule.
  The agreed shape is `call site → Port (one per table) → Port implementation →
  persistence layer`, and **the consumer builds all of it**.
- The rule committed on 2026-09-03 now teaches the opposite on two points: it presents
  Event as one of three channels, and it says the producer publishes the Port.
- That rule sits in open PR #12. A teammate reading it would build an event bus the
  team has decided against.
- Baseline: `bash .harness/tests/verify-contract.sh` exited 0 with the stale rule in
  place — nothing mechanically noticed that the rule had gone wrong.

## Root cause

Stale guidance. The instruction was correct when written and the decision moved. No
check pinned the rule's content, only its existence and its pointers.

## Pruning

- Canonical owner unchanged: `.harness/rules/feature-contracts.md`.
- Removed: the three-channel table, the Event ownership section, the injection
  walkthrough, and the one-arrow-per-pair rule. All of it described a model the team
  no longer uses; keeping any of it as "for reference" would be sediment.
- Kept and re-grounded: throw on failure, one owner per table, and the point that
  moment-only facts must be stored by the owner — that last one survives the change
  because it is now a **column** request rather than an event request.
- The worked example is the currency chain that already ships, so the rule teaches from
  running code rather than a sketch.

## Approval

Approved by the requester on 2026-09-09: rewrite the rule for the new structure, in
English, with the Korean guide following it.

## RED

```bash
bash .harness/tests/verify-contract.sh
```

```text
FAIL: feature-contracts.md must state that the consumer builds call site, Port, implementation, and persistence call
FAIL: feature-contracts.md must not describe the retired Event channel
```

Exit code 1.

## GREEN

The same command after the rewrite: no `FAIL` lines, exit code 0.

## Contract verification

`bash .harness/tests/verify-contract.sh` ends with `Contract verification passed.`

## CHANGELOG.md

Recorded under `## Unreleased`. Changed canonical files:
`.harness/rules/feature-contracts.md`, `.harness/guides/feature-contracts-kr.html`,
`.harness/README.md`, `.harness/tests/verify-contract.sh`.

## Completion

This time the check pins the rule's **content**, not just its existence, so a later
drift back to the retired model fails the contract run.

Remaining gaps, blocked on the owners rather than on this change:

- `gacha` and `battle` store nothing, so their Ports have no table to read.
- `collection` keeps pets in `room-state.json`, not a table.
- `overlay-growth` and `collection` disagree about pet identity and level, so a
  `GrowthPort` cannot be pointed at `pet_profiles` yet.


---

# 2026-09-17 — Port 인터페이스를 가진 쪽에 둔다

## Evidence

- Request, verbatim: “하네스에서 ‘Port 인터페이스는 쓰는 쪽 패키지에 둔다’라는게 가진 쪽에서 Port인
  Interface를 두는 걸로 하겠습니다.”
- The rule said “Port interface — the consumer's package, `src/ports/`” and “The consumer builds the
  whole chain.”
- The repository's only real precedent contradicts it: the pet owner published `PetClient` in
  `packages/pet-client`, shipped `SqlitePetClient` and `PetRepository`, and `meta` adopted it by
  importing the type (commit `afb4b99`).
- Baseline: `bash .harness/tests/verify-contract.sh` exited 0 — the check pinned the stale sentence
  instead of catching it.

## Root cause

Stale guidance. The team followed the owner-published shape in practice; the rule kept the earlier
consumer-owned wording.

## Pruning

- Canonical owner unchanged: `.harness/rules/feature-contracts.md`.
- Replaced the consumer-built chain with the owner-published chain and a “written by” column.
- Two sentences contradicted the new worked example and were reconciled rather than left as
  sediment: “one Port per table” → “one Port per owning domain”, and “does not return `null` or a
  zero” → “a read failure throws; `null`, `[]` and `0` are real empty results”.
- Replaced the currency worked example with the pet one. Currency has no owner, so its chain was
  consumer-built and can no longer illustrate the rule.
- Assumption recorded for the requester: the decision named where the **interface** lives. That the
  owner also writes the implementation and repository is taken from the `PetClient` precedent.

## Approval

Given by the requester on 2026-09-17 in the request above.

## RED

```text
FAIL: feature-contracts.md must state that the feature owning the data declares the Port interface
FAIL: feature-contracts.md must not keep the retired consumer-owned Port rule
```

Exit code 1.

## GREEN

The same command after the rewrite: no `FAIL` lines, exit code 0.

## Contract verification

`bash .harness/tests/verify-contract.sh` ends with `Contract verification passed.`

## CHANGELOG.md

Recorded under `## Unreleased` / `### Changed`. Changed canonical files:
`.harness/rules/feature-contracts.md`, `.harness/guides/feature-contracts-kr.html`,
`.harness/README.md`, `.harness/tests/verify-contract.sh`.

## Completion

The check now fails if the consumer-owned rule returns.

Remaining gaps:

- `meta` still declares `CurrencyPort` in `packages/pet-meta/src/ports/`. Currency has no owner, so
  under this rule it waits for one.
- `meta` still declares `CollectionPort` (trophy placement and room's `pet:overlay` channel). Trophy
  has no owner domain either.
