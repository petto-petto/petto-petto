---
name: work
description: Feature work, bug fixes, refactors, Rust changes, or explicit `/work` or `$work`: select a track, implement with evidence, and complete the review loop.
---

# Work

## Entry

Read `AGENTS.md`. Read the applicable rule before changing code; Rust work uses
`.harness/rules/rust.md`. State `lightweight` or `standard` and the request's
success criteria before changing files. Use `standard` for new behavior, public
interfaces, persisted formats, dependencies, or harness changes; use
`lightweight` only for a bounded, understood local change. The selected track,
criteria, and non-goals are recorded in the work result.

## Lightweight track

1. **Explore** — use the [Explorer contract](../../../.harness/roles/explorer.md) to
   identify the affected behavior and evidence. Done when the change surface is
   explicit.
2. **Plan and implement** — use the [Planner](../../../.harness/roles/planner.md)
   and [Implementer](../../../.harness/roles/implementer.md) contracts. For code
   behavior, make the focused test fail before the minimal change. Done when the
   accepted behavior and its test are both present.
3. **Verify and review** — use the [Verifier](../../../.harness/roles/verifier.md)
   for Mechanical and Semantic review, then the [Reviewer](../../../.harness/roles/reviewer.md)
   for Independent Review. Done when each layer has current evidence.
4. **Evolve** — record a reusable lesson or repeated friction; record `none` when
   neither exists. Done when the disposition is explicit.

## Standard track

1. **Interview/Seed** — resolve open questions, assumptions, success criteria,
   and non-goals before exploration. Done when each is answered or explicitly
   deferred with its owner.
2. **Explore and plan** — run the Explorer and Planner contracts to turn the Seed
   into small, testable changes. Done when the plan names its tests and verification.
3. **Implement** — run the Implementer contract one concern at a time; test code
   behavior first. Done when every planned change has its focused evidence.
4. **Verify and review** — run Mechanical, Semantic, and Independent Review in
   that order through the Verifier and Reviewer contracts. Done only when all
   three results are recorded.
5. **Evolve** — recover reusable knowledge or repeated friction, or explicitly
   record `none`. Done when the work result contains that disposition.

## Review evidence

- **Mechanical**: current formatter, build, lint, and test output applicable to
  the change; Rust work runs every command in `.harness/rules/rust.md` in order.
- **Semantic**: compare observed behavior with every stated success criterion and
  report any mismatch.
- **Independent Review**: a reviewer separate from implementation checks the diff
  for regressions, missing cases, and scope drift.

Do not claim completion without fresh command output for every applicable
Mechanical check, the Semantic comparison, and the Independent Review result.
Completion is observable only when the selected track, role outputs, three
review layers, Evolve disposition, changed files, and remaining gaps are all
recorded.
