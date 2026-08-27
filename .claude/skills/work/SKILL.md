---
name: work
description: "Feature work, bug fixes, refactors, Electron changes, or explicit `/work` or `$work`: select a track, implement with evidence, and complete the review loop."
---

# Work

## Entry

Read `AGENTS.md`. Read the applicable rule before changing code; Electron work uses
`.harness/rules/electron.md`. Before selecting a track, inspect
[`.harness/specs/features/`](../../../.harness/specs/features/) when the request
has any feature-spec trigger:

- new or changed user-visible behavior
- domain rules
- public interfaces
- persisted formats
- ambiguous feature requests

If any trigger applies, choose `standard`; its Interview/Seed phase uses an
existing approved feature specification or runs Specifier when that
specification is missing or ambiguous. Otherwise, use `standard` for
dependencies or harness changes and `lightweight` only for a bounded,
understood local change. State `lightweight` or `standard` and the request's
success criteria before changing files. Record the selected track, criteria,
and non-goals in the work result.

For Electron work, run `bash .harness/scripts/verify-electron.sh` as the shared
Mechanical completion entrypoint. The Electron rule owns the gate's command detail.

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

1. **Interview/Seed** — for work sent here by the Entry feature-spec gate, use
   an existing approved feature specification as the Seed. When the feature
   specification is missing or ambiguous, run the
   [Specifier](../../../.harness/roles/specifier.md) before Explorer; run
   Specifier only for that missing-or-ambiguous branch, wait for requester
   approval, report its proposed `Draft` path, then record the approved
   feature-spec path as the Seed. Until approval, state that
   `Explorer → Planner → Implementer → Verifier → Reviewer` is blocked. For
   other standard work, resolve open questions, assumptions, success criteria,
   and non-goals before exploration. Done when each is answered or explicitly
   deferred with its owner, and applicable feature work has an approved Seed.
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
