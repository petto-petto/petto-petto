# Shared Rust Harness

This directory holds runtime-neutral rules, references, contract checks, and later workflow support for the shared Claude Code and Codex harness.

- `rules/` contains the Rust and Skill-authoring rules.
- `references/writing-great-skills/` preserves the supplied writing references byte-for-byte.
- `tests/verify-contract.sh` checks the shared structure while the harness is assembled.

Canonical agent instructions live in `AGENTS.md`; canonical Skills will live in `.claude/skills/`. Runtime-specific discovery paths are adapters, not duplicate instructions.
