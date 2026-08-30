# Design guide entrypoint

## Evidence

- Request: make Codex and Claude Code read `design.md`; `design-kr.md` is for
  human reading only.
- Affected canonical file: `AGENTS.md`, imported by the pointer-only
  `CLAUDE.md`.
- Baseline reproduction: a search for a mandatory `design.md` instruction in
  `AGENTS.md` returned no match.

## Root cause

Missing instruction: the common entrypoint named implementation and harness
guidance but did not name the visual design guide.

## Pruning

- Canonical owner: `AGENTS.md`.
- Smallest change: one conditional pointer to `design.md`.
- `design-kr.md` remains outside agent instructions to avoid duplicate sources.

## Approval

Approved by the requester on 2026-08-30: add the `design.md` instruction to
`AGENTS.md` only; do not reference `design-kr.md`.

## RED

```bash
grep -F -q -- "Before creating or changing UI, visual, or interaction design, read \`design.md\`." AGENTS.md
```

returned no match before the change.

## GREEN

The same command matches the added instruction after the change.

## Contract verification

`bash .harness/tests/verify-contract.sh` verifies the required entrypoint
instruction.

## CHANGELOG.md

Recorded under `Unreleased / Changed`; canonical files changed are `AGENTS.md`
and `.harness/tests/verify-contract.sh`.

## Completion

Complete when the focused GREEN check and contract verification pass.
