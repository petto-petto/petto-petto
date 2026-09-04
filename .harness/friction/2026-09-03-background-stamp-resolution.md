# Background stamp resolution on large canvases

## Evidence

- Request: build a 960x360 pet-room background; the requester reviewed the first
  renders and reported that each component's detail quality looked poor.
- Baseline: `bg_check.py` PASS and `bg_score.py` 100/100 on the same image, so
  neither gate saw the defect. The gates measure structure and palette, not the
  internal resolution of a stamp.
- Reproduction: `rock` is 9x6 and `mushroom` is 5x5. At the scaffold's `scale`
  of 3-4 for a 360px-tall canvas they render as 3-4px blocks. Raising `scale`
  makes the blocks larger, never the form more detailed.

## Root cause

Missing asset, not wrong instruction. The stamp library was calibrated for the
280x120 reference canvas. `quality.md` §5 already tells the author to scale
stamps up with the canvas, and following it faithfully is what produces the
blocks — there was no higher-resolution stamp to reach for instead.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- Smallest change: four high-resolution variants of the props that actually
  appear at size (`rock_mossy`, `mushroom_cluster`, `log_mossy`, `bush_leafy`),
  plus one section in `references/stamps.md` stating when to use them. The
  small originals stay — size gradient (depth cue 4) needs both.
- The stamp list has one home (`references/stamps.md` table); the new files are
  recorded there rather than in `SKILL.md`.

## Approval

Approved by the requester on 2026-09-03, choosing "Skill에 고해상도 스탬프 추가"
over finishing with the existing stamps.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 after the
new required-stamp assertions and the `references/stamps.md` documentation
assertions were added, and before the stamps existed.

## GREEN

`bash .harness/tests/verify-background-generator-skill.sh` passed after the four
stamps landed in both Skill trees, `references/stamps.md` documented them, and
the pinned inventory count moved from 67 to 71.

## Contract verification

`bash .harness/tests/verify-contract.sh` passed.

## CHANGELOG.md

Recorded under `Unreleased / Added`.

## Completion

Complete: both Skill trees are byte-identical, the new stamps and their usage
rule are asserted mechanically, and both required checks pass.
