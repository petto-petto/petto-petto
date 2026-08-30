# Background generator runtime path

## Evidence

- Request: explicitly state the Electron asset output path in the background-generator Skill.
- Baseline: the Skill prescribed `assets/backgrounds/`, while Electron loads its renderer from `apps/desktop/renderer/` and existing runtime backgrounds live under `apps/desktop/renderer/assets/backgrounds/`.
- Reproduction: the focused contract did not require the Electron path; after adding the assertion, it failed because the Skill text did not contain that path.

## Root cause

Unclear instruction: the shared Skill named a generic output directory rather than the desktop renderer's runtime asset directory.

## Pruning

- Canonical owner: `.claude/skills/background-generator/SKILL.md`, mirrored byte-for-byte to `.agents/skills/background-generator/`.
- Smallest change: replace the generic path in the ID lookup, render command, and storage section; add one focused assertion. No second path is retained.

## Approval

Approved by the requester on 2026-08-31 to state the file storage location in the Skill.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` failed after its new Electron-path assertion and before the Skill body was updated.

## GREEN

`bash .harness/tests/verify-background-generator-skill.sh` passed after the
canonical and mirrored Skill updates.

## Contract verification

`bash .harness/tests/verify-contract.sh` passed after the focused check.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: the canonical and Codex-mirrored Skill trees are byte-identical, the
Electron runtime output path is asserted mechanically, and both required checks
pass.
