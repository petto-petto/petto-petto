# Content-focused product specification filename evidence record

## Evidence

- Exact request: 프로덕트 기획서의 날짜 접두사를 제거하고 내용 중심의 문서 이름으로 변경한다.
- Affected canonical files: `.harness/specs/meta-info-settings-achievements-design.md`, `.harness/README.md`, `.harness/tests/verify-contract.sh`, `.harness/CHANGELOG.md`.
- Baseline: the canonical meta product specification was named `.harness/specs/2026-08-20-meta-info-settings-achievements-design.md`, so its stable identity changed with a creation date rather than its product content.
- Reproduction: `test -f .harness/specs/meta-info-settings-achievements-design.md` exited non-zero before the change.

## Root cause

The cause was an unclear product-specification filename convention plus a contract that directly required the dated path. It was not a missing product requirement or implementation plan.

## Pruning

- Canonical owner: `.harness/README.md` owns routing and naming guidance; the specification remains the single source of product behavior.
- Removed sediment: the date prefix from the live meta specification path.
- Retained historical evidence: the earlier friction record keeps the old path in its exact baseline and RED output because those observations occurred before this rename.
- Smallest change: rename one product specification, update its executable path assertions, and state one product-specification naming rule.

## Approval

The user explicitly requested a content-focused document name without a date prefix. The approved boundary covers product specification filenames; it does not rename dated implementation plans, harness-design history, or friction records.

## RED

After the contract was changed to require the approved path, `bash .harness/tests/verify-contract.sh` returned exit one with twelve failures: the new specification path and its ten content anchors were missing, and the README naming rule was absent.

## GREEN

After the rename and README update, the same command returned exit zero:

```text
Work Skill verification passed.
Harness-improve Skill verification passed.
Contract verification passed.
```

## Contract verification

`.harness/tests/verify-contract.sh` requires the content-focused specification path, its existing product anchors, and the README filename rule. The final contract run returned exit zero.

## CHANGELOG.md

`.harness/CHANGELOG.md` records the stable path and naming convention. The changed canonical files are the specification, README, contract verifier, and CHANGELOG.

## Completion

- The live product specification exists only at the content-focused path.
- Current routing and executable checks contain no dated path for the live product specification.
- The prior evidence record retains the dated path only as historical evidence.
- Remaining gap: other dated files are harness history or implementation artifacts and are outside the approved product-specification rename boundary.
