# Friction loop

Use this record when repeated friction or a request to improve shared harness
behavior appears. The canonical Skill is
[`harness-improve`](../../.claude/skills/harness-improve/SKILL.md); this file
is the compact evidence record, not a second set of instructions.

Record one entry with:

- **Evidence:** exact request, recurrence, affected files, and reproducible baseline.
- **Root cause:** root cause classification plus the evidence that supports it.
- **Pruning:** pruning review, canonical owner, removed duplication/sediment/no-ops, and the smallest change.
- **Approval:** the user's decision and the approved boundary.
- **RED:** failing behavior or contract command and its output.
- **GREEN:** the same command's passing output.
- **Contract verification:** contract verification from fresh `bash .harness/tests/verify-contract.sh` output.
- **CHANGELOG.md:** entry location and changed canonical files.
- **Completion:** completion is observable only with every remaining gap or blocker.

No record is complete without Evidence, approval, RED, GREEN, contract
verification, and a CHANGELOG.md update.
