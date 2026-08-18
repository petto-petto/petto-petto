# Changelog

## Unreleased

### Added

- Korean quick-start and concept-application guides at
  `.harness/guides/quick-start.html` and
  `.harness/guides/concept-application.html`.
- Conditional Specifier branch for new or changed features with a missing or
  ambiguous specification. Approved feature specifications in
  `.harness/specs/features/` are standard-track Seeds; Explorer, Planner,
  Implementer, Verifier, and Reviewer remain the five core roles. RED and GREEN
  evidence is retained in the Specifier fixture scenario and contract checks:
  `verify-work-skill.sh` was RED with 18 missing-Specifier assertions, then
  `verify-work-skill.sh` and `verify-contract.sh` were GREEN.
- Common Rust harness entrypoints, rules, embedded writing references, and contract verification.
- Canonical `work` Skill, runtime-neutral role contracts, and reproducible work-scenario evidence.
- Task 2: executable `work` Skill behavior verification.
- Canonical `harness-improve` Skill, friction evidence record, and reproducible evidence-driven harness evolution checks.
- Task 4: Codex Skill adapters and the shared fail-fast Rust verification runner.
- Hardened canonical Skill frontmatter and the harness-improve response protocol
  contract; the behavior probe now supports a fixture override for mutation checks.
- This harness branch does not track Cargo.toml/Cargo.lock; a clean checkout must
  land the existing manifest separately before the Rust gate can run.

### Fixed

- Korean guides now point verification and feature workflow readers to their
  canonical owners; the contract rejects tracked Markdown plans from the index.
- Feature-spec triggers are evaluated before track selection, so user-visible
  behavior, domain rules, public interfaces, persisted formats, and ambiguous
  requests cannot bypass the standard Specifier gate through lightweight work.
- Korean guides distinguish Claude Code slash invocation from Codex `$` Skill
  mentions, state the two-stage Specifier condition, and map Interview, Seed,
  Execute, Evaluate, and Evolve to the canonical workflow.
- The contract rejects every index-tracked feature specification except
  `README.md` and dated `YYYY-MM-DD-<feature-name>.md` files, including
  index-only entries. Specifier and the feature template now assign product
  `what`/`why` to the specification and technical `how` to planning.

### Removed

- Obsolete shared Rust harness plan at
  `.harness/plans/2026-08-10-shared-rust-harness.md`.
