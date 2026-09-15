# Catching stamp over-enlargement

## Evidence

- Request: continue the upgrade plan at priority 3.
- Baseline: `references/stamps.md` already carried the rule — use the
  high-resolution variant on large canvases — but nothing enforced it. The
  original complaint that started this work ("각 컴포넌트 세부 묘사의 퀄리티가
  떨어져보여") traced to `rock` at 9x6 and `mushroom` at 5x5 rendered at scale 4.

## Choosing the metric

Two candidate metrics were measured against the existing backgrounds before
either was written.

| candidate | why rejected |
| --- | --- |
| `scale` alone | `bg_001` uses scale 4 on `window_snow` (46x28) and looks right; the scaffold itself emits scale 3 at 960x360 |
| detail per screen pixel | equals 1/scale², so it says the same thing as scale alone |

Neither separates the accepted work from the rejected. What does separate them is
**how much drawing backs the area**: `window_snow` at scale 4 has 46px of form in
a 184px slot, while `rock` at scale 4 has 9px of form in a 36px slot. So the
check fires on a *small* source enlarged a lot — and only when a
higher-resolution variant already exists, which makes the report actionable.

Variants are found by name: `<base>_*` whose longest side is at least 1.5x the
base. That resolves `rock -> rock_mossy`, `mushroom -> mushroom_cluster`,
`log -> log_mossy`, `bush -> bush_leafy`, and `picture -> picture_wide`. The 14px
source cap keeps `window -> window_snow` out, where the two are different
subjects rather than two resolutions of one.

## Gate, negative-tested

Raising `mushroom` to `scale: [3, 4]` in a passing scene reports
`mushroom(5px) x4 -> 고해상도 변형 mushroom_cluster(16px)` and fails.

## A finding, not a fix

`bg_001_cozy_study` fails the new check: it uses `picture` (9px) at scale 3 while
`picture_wide` (16px) exists. Inspecting that region confirms the check is right —
the small frame reads as a dark square with an indistinct shape, while the
neighbouring wide frames show a legible landscape.

**It was left alone.** `bg_001` is an approved asset from earlier work, and
changing someone's approved background is the requester's call, not a side effect
of adding a gate. `verify-contract.sh` does not run `bg_check` over the asset
tree, so nothing in the harness breaks; the finding is reported instead.

## Approval

Requested by the requester on 2026-09-03: "응 이어서해".

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 before
`bg_check.py` carried the check.

## GREEN

Passes from both shells; `bash .harness/tests/verify-contract.sh` passes.
`bg_002` and `bg_003` still report `bg_check` PASS.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete for the Skill: the rule is enforced, negative-tested, and documented in
`references/stamps.md`. Outstanding for the requester: whether to change
`bg_001`.
