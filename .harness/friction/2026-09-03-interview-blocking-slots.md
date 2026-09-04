# Interview slots that decide what gets baked

## Evidence

- Request: after a written plan of twelve Skill improvements, the requester asked
  for the interview item.
- Baseline: `bg_interview.py` had ten slots totalling 100, all describing a
  single still frame. The petroom brief scored **0% ambiguity** and proceeded.
- Reproduction: that same brief, rescored against the new slot table, leaves
  exactly three slots empty — and they are exactly the three requirements the
  requester raised afterwards.

## What it cost

Each late requirement forced a full re-bake, not a local edit.

| Raised after the fact | Rework |
| --- | --- |
| "화면이 계속 움직이는 것처럼" | a frame-baking tool that did not exist, then 24 frames |
| "낮 버전과 밤 버전 두 본" | a derived preset, and a scene builder taking preset as an argument |
| "너무 밝아서 날아가는 느낌, 조금 더 태워서" | a second derived preset, both backgrounds, both frame sets |

## Root cause

The slot table modelled **how the picture looks** and nothing else. Motion,
variant count and exposure decide **what artifacts are produced**, and no slot
covered them, so a brief could reach 0% ambiguity while leaving the pipeline
undefined.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- Three slots added (8 / 6 / 6) and the existing ten scaled down so the total
  stays 100 — the ambiguity formula depends on that sum, and a contract check now
  asserts it.
- Marked **blocking** rather than given large weights. The three sum to exactly
  20, which is the threshold, so a weight-only change would still have let the
  original brief through. Blocking is also the truthful shape: these are not
  "more detail", they are prerequisites.
- The `assumed` escape hatch already existed for unattended runs and is reused —
  recording a default lifts the block, so nothing is silently decided.

## Approval

Requested by the requester on 2026-09-03: "P2를 진행하고".

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 with
assertions for the three slot keys, their Korean names in both the script and
`references/interview.md`, and a weight-sum check.

## GREEN

Passed after `scripts/bg_interview.py` and `references/interview.md` landed in
both Skill trees.

## Behaviour verified

Three paths, using the real petroom brief:

- slots empty -> `판정: 아직 묻는다` at 20% ambiguity, and `next` surfaces the
  three before anything else
- slots filled -> 0% ambiguity, `판정: 진행 가능`
- slots empty but recorded in `assumed` -> `판정: 진행 가능` at 20%

## Contract verification

`bash .harness/tests/verify-contract.sh` passes. Run it without the project venv
on `PATH`; the Skill's fail-closed Pillow assertion is defeated by a shell that
can import Pillow.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, the slots and the weight sum are
asserted mechanically, and every required check passes.
