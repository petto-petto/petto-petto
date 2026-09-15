# Two scoring metrics, one of them rejected

## Evidence

- Request: after a background review the requester asked which parts of the Skill
  to improve, then picked two of the twelve items — the hue metric and the
  highlight metric.
- Baseline: both approved backgrounds scored 97/100, losing three points on
  "하이라이트 L>=0.75 면적 >= 2%" (measured 1.0% and 1.3%). The hue item scored
  full marks on an image the requester had rejected as "너무 초록".

## What the measurements said

Before writing either metric, seven images were measured — the Skill's three
reference examples, `bg_001`, the rejected render, and both approved renders.

| | hue dominance (widest 60 deg window) | contrast hue (>= 90 deg away) | p98 - p2 luminance |
| --- | --- | --- | --- |
| reference forest | 85.7% | 0.0% | 0.835 |
| reference interior | 87.2% | 0.0% | 0.815 |
| rejected render | 52.4% | 29.6% | 0.747 |
| approved render | 52.5% | 0.6% | 0.651 |

The reference images the whole Skill is calibrated against are far more
hue-dominant than the render the requester rejected, and the rejected render
carries more contrast hue than the approved one. **Both proposed hue metrics run
backwards against the evidence.** They were dropped, and `references/quality.md`
now records them as rejected with this table, so the same proposal is not made
again.

The luminance column separates cleanly, and it says the existing absolute
threshold was the defect: bright-pixel share across the references runs
4.1-34.9%, which is not a bar, it is noise.

## Root cause

The Skill states the rule correctly — `references/color.md` says "단일 초록
금지" — but the metric meant to enforce it counted distinct 20-degree hue bins.
Green, yellow-green and teal fall in different bins, so a monochrome-green frame
scored full marks. The rule lived in prose and the number measured something
else.

The real signal was in the palette, not the render: `accent` is the ramp
`color.md` assigns to widening the hue range, and in `forest` (32 deg), `sky`
(43 deg), `interior` (8 deg) and `jungle` (60 deg) it sits inside the dominant
family. A scene built from those presets has no non-dominant hue anywhere.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- The hue finding became a **preset diagnostic**, not an image gate — it is a
  property of the palette, and it is actionable at the moment a preset is chosen.
  `bg_palette.py show` prints it; nothing fails closed on it, because three
  shipped presets would fail and their colours are not being changed.
- The tone finding became a straight replacement inside the existing scoring
  item, keeping the point value.

## Approval

Requested by the requester on 2026-09-03: "P1의 1·4번부터 스킬 수정 진행해줘",
after a written plan listing twelve candidate improvements.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 with
assertions for `accent_contrast`, `dynamic_range`, and the rejected-metric record.

## GREEN

Passed after `bgcore.py`, `bg_palette.py`, `bg_score.py`, `references/color.md`
and `references/quality.md` landed in both Skill trees.

## Contract verification

`bash .harness/tests/verify-contract.sh` passes. Run it without the project venv
on `PATH`; the Skill's fail-closed Pillow assertion is defeated by a shell that
can import Pillow.

## Effect

Both petroom backgrounds return to 100/100 — the three points were the false
penalty on a deliberately dark image, not a real defect.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, both metrics are asserted
mechanically, and every required check passes.
