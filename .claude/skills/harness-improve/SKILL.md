---
name: harness-improve
description: Evidence: use for explicit $harness-improve or /harness-improve requests and implicit changes to shared rules, Skills, roles, verification, or repeated friction; evolve the harness only with approval.
---

# Harness Improve

## Read first

Before changing a shared-harness file, read
`.harness/references/writing-great-skills/SKILL.md` and then
`.harness/references/writing-great-skills/GLOSSARY.md` in full. Read the
applicable canonical rule, current contract, and
`.harness/friction/README.md` before proposing a change. **Evidence** is the
leading word: no rule is added from a hunch.

## Evidence and classification

1. Capture fresh, repository-owned **Evidence**: the exact request or repeated
   friction, affected canonical files, current behavior, and a reproducible
   baseline scenario or command result. Do not alter rules, Skills, roles, or
   verification before this record exists. Done when a reader can reproduce the
   problem without relying on the proposed fix.
2. Classify the root cause as a missing or unclear instruction, ownership gap,
   duplicate or absent entrypoint, missing mechanical check, stale guidance, or
   another evidenced cause. Keep the baseline response unmodified. Done when
   the classification names evidence that distinguishes it from the alternatives.

## Prune, propose, and approve

1. **Prune** before adding: locate the single source of truth, remove duplicate,
   stale, sedimentary, or no-op guidance, and reject changes that only restate
   existing behavior. Prefer the smallest change that fixes the classified
   cause. Done when the proposal states the canonical owner and every retained
   instruction changes observable behavior.
2. Present the evidence, root cause, pruning result, smallest change, affected
   checks, and completion criteria to the user. Obtain explicit user approval
   before changing shared-harness behavior; until then, perform read-only
   investigation only. Done when approval or a recorded refusal fixes the
   change boundary.

## RED, GREEN, and completion

1. Add or extend an executable contract or behavior check for the approved
   change, run it, and record the expected RED failure. Then make the smallest
   canonical change and preserve adapters as pointers rather than duplicate
   instructions. Done when the RED failure proves the missing behavior.
2. Run the same check GREEN, then run
   `bash .harness/tests/verify-contract.sh`. Record fresh output, update
   `.harness/CHANGELOG.md`, and record the outcome using the friction loop.
   Done only when the scenario, contract, CHANGELOG, changed canonical files,
   remaining gaps, and observable completion evidence are all recorded. Do not
   claim completion when a required check is blocked or fails.
