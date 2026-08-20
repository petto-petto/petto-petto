# Meta product specification evidence record

## Evidence

- Exact request: `정보`, `셋팅`, `업적`의 초기 MVP 기획을 더 상세하게 만들고 현재 하네스에 최종 기획서로 추가한다.
- Affected canonical files: `.harness/specs/2026-08-20-meta-info-settings-achievements-design.md`, `.harness/tests/verify-contract.sh`, `.harness/README.md`, `.harness/CHANGELOG.md`.
- Baseline: the current harness had no canonical product specification for these three screens or their collection and achievement contracts.
- Reproduction: `test -f .harness/specs/2026-08-20-meta-info-settings-achievements-design.md` exited non-zero before the change.

## Root cause

The cause was an absent canonical product-specification entrypoint. The earlier product draft lived outside the current harness and retained unresolved MVP, collection, naming, notification, and data-lifecycle decisions. This was not a missing Rust rule, Skill, role, or runtime adapter.

## Pruning

- Canonical owner: one approved product specification under `.harness/specs/`.
- Rejected duplication: three screen-specific specifications and a premature separate technical contract.
- Smallest change: one specification with stable requirement IDs, one contract assertion block, README routing, and one CHANGELOG entry.
- Retained implementation freedom: storage technology, Rust module names, animation timing, copy polish, and packaging internals remain outside the product contract.

## Approval

The user approved the single-spec structure and all three presented design sections: screen behavior, collection/data rules, and achievement/reward/event contracts. The approved boundary includes full MVP achievements, three bundled usage sources, macOS and Windows, and the explicit exclusions recorded in the specification.

## RED

Command:

```text
bash .harness/tests/verify-contract.sh
```

Observed result before the specification existed:

```text
FAIL: missing file: .harness/specs/2026-08-20-meta-info-settings-achievements-design.md
FAIL: cannot inspect missing file: .harness/specs/2026-08-20-meta-info-settings-achievements-design.md
Contract verification failed: 11 assertion(s).
```

All eleven failures were the missing specification and its ten required content anchors.

## GREEN

The same command after the canonical document was added returned exit zero:

```text
Work Skill verification passed.
Harness-improve Skill verification passed.
Contract verification passed.
```

## Contract verification

`.harness/tests/verify-contract.sh` now requires the canonical meta specification, its core screen and collection sections, and the `INFO`, `SET`, `COLLECT`, and `ACH` requirement families. The final contract run returned exit zero.

## CHANGELOG.md

`.harness/CHANGELOG.md` records the approved meta product specification and its contract assertions. `.harness/README.md` routes product work from approved specifications to implementation plans through requirement IDs.

## Completion

- Specification placeholder scan: no `TBD`, `TODO`, unresolved marker, or approval placeholder.
- Achievement table: 22 unique IDs.
- Acceptance criteria: 40 unique requirement IDs.
- Shell syntax check: exit zero.
- `git diff --check`: exit zero.
- Remaining evidence boundary: the external collaborative planning page was not accessible in this session; the current specification is grounded in the supplied local MVP document and the user's explicit decisions in this design review.
