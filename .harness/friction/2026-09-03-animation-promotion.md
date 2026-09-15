# Promoting animation into the Skill

## Evidence

- Request: continue the upgrade plan at priority 2 — move frame baking into the
  Skill, along with the two gaps found while planning it.
- Baseline: `bg_interview.py` asks for 움직이는 요소 as a *blocking* slot, but the
  Skill had no tool to act on the answer. Baking lived in
  `tools/backgrounds/bake_frames.py`, outside the Skill.
- Two further gaps: `bg_check.py`, `bg_score.py` and `bg_final.py` contained zero
  references to `frames` or `animation`, and the baker hardcoded `specks`/`glow`
  as the moving ops.

## Root cause

The interview change (P2) created an obligation the Skill could not meet. Moving
a working script would have closed the location gap only — with no gate, a broken
frame set passes silently, and with a hardcoded mover list, waves or swaying
leaves need a code edit rather than a scene edit.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- `tools/backgrounds/bake_frames.py` was **deleted**, not left beside the Skill
  copy. Two sources for one behaviour is the duplication this harness prunes;
  `tools/backgrounds/README.md` now points at the Skill.
- Movement is declared per op (`"animate": true`), with a warning-and-proceed
  fallback for scenes written before the flag existed.
- All movers must resolve to a single layer, matching what the runtime does.

## Gate, negative-tested

The gate is worth having only if it fails on real breakage, so each case was
induced:

| induced fault | reported |
| --- | --- |
| one frame file deleted | 프레임 파일 존재 |
| one frame resized to 480x180 | 프레임 캔버스 일치, 교체 대상과 크기 일치 |
| all twelve frames made identical | 프레임이 서로 다름 (1/12) |
| `animation.layer` set to a name no layer has | 레이어가 실재 |

## The contract is still unvalidated

Nothing reads the `animation` block yet; the pet-room view is being built
separately. `references/layers.md` says so in the document itself, and says that
a first consumer finding it insufficient — needing per-layer scroll offsets to
combine parallax with frame swapping, for instance — is a defect in the contract
to be fixed here, not worked around in the renderer.

## Approval

Requested by the requester on 2026-09-03: "2순위".

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 with
assertions for `scripts/bg_animate.py` in both trees, the `animate` flag, the
`SKILL.md` step, `animation` handling in `bg_check.py`, and the layers.md
contract including its unvalidated marking.

## GREEN

Passes from both a clean shell and one carrying the project venv. The pinned file
inventory moved from 71 to 72. `bash .harness/tests/verify-contract.sh` passes.

## Regression

Both backgrounds were re-baked through the new tool with `animate` declared in
their scenes: `bg_check` PASS and `bg_score` 100/100 on each.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, the tool and its gate are asserted
mechanically, the gate is negative-tested, and the duplicate copy is gone.
