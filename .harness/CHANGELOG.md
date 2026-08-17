# Changelog

## Unreleased

### Added

- Korean quick-start and concept-application guides at
  `.harness/guides/quick-start.md` and
  `.harness/guides/concept-application.md`.
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

### Removed

- Obsolete shared Rust harness plan at
  `.harness/plans/2026-08-10-shared-rust-harness.md`.
