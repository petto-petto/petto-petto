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

1. **Scope confirmation** — identify the affected behavior and change boundary.
   Done when the local scope and success criterion are explicit.
2. **Minimal implementation** — make the smallest in-scope change; for code
   behavior, establish a focused failing test first. Done when that test proves
   the accepted behavior.
3. **Mechanical verification** — run each applicable project check and retain its
   fresh output. Done when every applicable command has a result.
4. **Diff review** — inspect the changed files for scope drift and unintended
   edits. Done when the reviewed diff and any remaining gap are recorded.

## Standard track

1. **Interview/Seed** — resolve open questions, assumptions, success criteria,
   and non-goals before exploration. Done when each is answered or explicitly
   deferred with its owner.
2. **Explore and plan** — run the [Explorer](../../../.harness/roles/explorer.md)
   and [Planner](../../../.harness/roles/planner.md) contracts to turn the Seed
   into small, testable changes. Done when the plan names its tests and verification.
3. **Implement** — run the [Implementer](../../../.harness/roles/implementer.md)
   contract one concern at a time; test code behavior first. Done when every
   planned change has its focused evidence.
4. **Verify and review** — run Mechanical, Semantic, and Independent Review in
   that order through the [Verifier](../../../.harness/roles/verifier.md) and
   [Reviewer](../../../.harness/roles/reviewer.md) contracts. Done only when all
   three results are recorded.
5. **Evolve** — recover reusable knowledge or repeated friction, or explicitly
   record `none`. Done when the work result contains that disposition.

## Completion

Lightweight completion is observable only when the selected track, scope,
focused evidence, fresh Mechanical output, diff-review result, changed files,
and remaining gaps are recorded.

Standard completion is observable only when the selected track, Interview/Seed,
five role outputs, three review results, Evolve disposition, changed files, and
remaining gaps are recorded. Do not claim it without fresh command output for
every applicable Mechanical check.
