# Shared Rust Harness

This directory holds the runtime-neutral material for the shared Claude Code and Codex Rust harness.

## Structure

- `AGENTS.md` is the common instruction entrypoint.
- `CLAUDE.md` imports only `AGENTS.md` for Claude Code.
- `.claude/skills/` contains the canonical `work` and `harness-improve` Skill bodies.
- `.agents/skills/` contains relative Codex adapters to those canonical Skill directories.
- `rules/`, `roles/`, `references/`, and `friction/` hold shared support material.
- `specs/` contains approved product and harness designs; `plans/` contains implementation plans that reference them.
- `tests/verify-contract.sh` verifies the harness structure, canonical references, and adapter targets.
- `scripts/verify-rust.sh` runs the required Cargo completion gate.

## Using the harness

Claude Code reads `CLAUDE.md`, which imports the shared `AGENTS.md`, and uses the canonical Skills in `.claude/skills/`. Codex reads the same `AGENTS.md` and discovers those exact Skill directories through `.agents/skills/`. Invoke `$work` for implementation work and `$harness-improve` for evidence-based changes to the harness.

Both runtimes run the same checks directly. From the repository root, run:

```bash
bash .harness/tests/verify-contract.sh
bash .harness/scripts/verify-rust.sh
```

The Rust command sequence has one source of truth in `rules/rust.md`; the runner stops at the first failed command.

Product work uses the approved specification under `specs/` as its behavioral source of truth. Implementation plans and tests reference the requirement IDs in that specification instead of duplicating product rules.

## Korean team guides

- [Quick start (`.harness/guides/quick-start.html`)](guides/quick-start.html)
  explains how Claude Code and Codex select the work flow, create conditional
  feature specifications, verify work, and report completion.
- [Concept application (`.harness/guides/concept-application.html`)](guides/concept-application.html)
  explains adopted design concepts, canonical runtime sharing, and the evidence
  boundary.

## Manifest boundary

This harness branch does not track Cargo.toml/Cargo.lock. A clean checkout must
land the existing manifest separately before the Rust gate can run; do not add,
stage, or modify those user-owned files as part of harness work.
