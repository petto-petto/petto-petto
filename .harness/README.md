# Shared Electron Harness

This directory holds the runtime-neutral material for the shared Claude Code and Codex Electron harness.

## Structure

- `AGENTS.md` is the common instruction entrypoint.
- `CLAUDE.md` imports only `AGENTS.md` for Claude Code.
- `.claude/skills/` contains the canonical `work` and `harness-improve` Skill bodies.
- `.agents/skills/` contains relative Codex adapters to those canonical Skill directories.
- `rules/`, `roles/`, `references/`, and `friction/` hold shared support material.
- `specs/` contains approved product and harness designs; `plans/` contains implementation plans that reference them.
- `tests/verify-contract.sh` verifies the harness structure, canonical references, and adapter targets.
- `scripts/verify-electron.sh` runs the required npm completion gate.

## Using the harness

Claude Code reads `CLAUDE.md`, which imports the shared `AGENTS.md`, and uses the canonical Skills in `.claude/skills/`. Codex reads the same `AGENTS.md` and discovers those exact Skill directories through `.agents/skills/`. Invoke `$work` for implementation work and `$harness-improve` for evidence-based changes to the harness.

Both runtimes run the same checks directly. From the repository root, run:

```bash
bash .harness/tests/verify-contract.sh
bash .harness/scripts/verify-electron.sh
```

The npm command sequence has one source of truth in `rules/electron.md`; the runner stops at the first failed command.

Product work uses the approved specification under `specs/` as its behavioral source of truth. Implementation plans and tests reference the requirement IDs in that specification instead of duplicating product rules.

Product specification filenames use stable, content-focused names without date prefixes. Dates belong in version history and change records rather than the canonical product-specification path.

## Korean team guides

- [Quick start (`.harness/guides/quick-start.html`)](guides/quick-start.html)
  explains how Claude Code and Codex select the work flow, create conditional
  feature specifications, verify work, and report completion.
- [Concept application (`.harness/guides/concept-application.html`)](guides/concept-application.html)
  explains adopted design concepts, canonical runtime sharing, and the evidence
  boundary.
- [Meta product overview (`.harness/guides/meta-product-overview.html`)](guides/meta-product-overview.html)
  gives teammates a short visual briefing on the approved information,
  settings, achievements, collection, and reward design.

## Manifest boundary

Harness work does not modify package.json or package-lock.json. Those are
product-owned files; a clean checkout runs `npm install` before the Electron gate
can run, and the lockfile is committed so every teammate installs the same versions.
