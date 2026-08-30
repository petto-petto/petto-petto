# Background generator Skill

## Evidence

- Request: make a background generator available as a local Skill.
- Baseline: `.claude/skills/background-generator/SKILL.md` was absent.
- Follow-up request: block all rendering and verification when Pillow is unavailable.
- Baseline reproduction: `python3 -c 'import PIL'` fails, while the Skill still
  instructed the user to install Pillow.
- Follow-up request: replace the compact Skill with the complete background
  generator package.
- Baseline reproduction: the compact Skill contained 4 files, not the package's
  66 source files, references, evaluation data, and stamps.

## Root cause

The project had no local entrypoint for generating a pixel-art background; its
new Skill also lacked an explicit dependency gate and the full creation toolkit.

## Pruning

- Canonical owner: `.claude/skills/background-generator/` and
  `.agents/skills/background-generator/`.
- Smallest change: keep an identical full Skill tree at both discovery paths,
  including every reference and stamp; replace the installation branch with one
  fail-closed Pillow gate, then include every package artifact in both trees.

## Approval

Approved by the requester on 2026-08-30 to add the local Skill.
The requester also approved the Pillow fail-closed boundary.
The requester approved replacing the compact Skill with the full package.

## RED

`test ! -f .claude/skills/background-generator/SKILL.md` passed before the change.
The focused check failed after adding its Pillow-gate assertions and before the
Skill body changed.
It also failed before the package replacement because the required full-package
structure was absent.

## GREEN

`bash .harness/tests/verify-background-generator-skill.sh` passes after the change.

## Contract verification

`bash .harness/tests/verify-contract.sh` runs the Skill check.

## CHANGELOG.md

Recorded under `Unreleased / Added`.

## Completion

Complete when the focused Skill check proves that a Pillow-free Python process
is blocked, the Claude and Codex trees are byte-identical, all package files are
present, and the shared contract check passes.
