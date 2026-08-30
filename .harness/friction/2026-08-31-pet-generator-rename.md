# Pet generator Skill rename

## Evidence

- Request: align the Pillow pet generator's name with `background-generator` by
  renaming it to `pet-generator`.
- Baseline: `.claude/skills/pet-generator/SKILL.md` was absent, while separate
  Claude and Codex directories used the previous name.

## Root cause

The Skill name and directory did not follow the generator naming convention,
and the two tool entrypoints duplicated the same files.

## Pruning

- Canonical owner: `.claude/skills/pet-generator/`.
- Smallest change: rename the canonical directory and frontmatter, then replace
  the Codex duplicate with one relative adapter.

## Approval

Approved by the requester on 2026-08-31 to rename the Skill to `pet-generator`.

## RED

`bash .harness/tests/verify-pet-generator-skill.sh` failed because the new
canonical path did not exist.

## GREEN

The same check passes after the rename and adapter conversion.

## Contract verification

`bash .harness/tests/verify-contract.sh` runs the focused check and validates
both the canonical frontmatter and Codex adapter.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete when the focused check, shared contract, and diff check pass.
