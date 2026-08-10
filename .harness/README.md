# Shared Rust Harness

This directory holds the runtime-neutral material for the shared Claude Code and Codex Rust harness.

## Structure

- `AGENTS.md` is the common instruction entrypoint.
- `CLAUDE.md` imports only `AGENTS.md` for Claude Code.
- `.claude/skills/` contains the canonical `work` and `harness-improve` Skill bodies.
- `.agents/skills/` contains relative Codex adapters to those canonical Skill directories.
- `rules/`, `roles/`, `references/`, and `friction/` hold shared support material.
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
