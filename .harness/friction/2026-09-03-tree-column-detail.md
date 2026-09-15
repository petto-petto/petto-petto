# tree_column detail on the largest object

## Evidence

- Request: after two rounds of background review the requester said each
  component still looked short on detail, and asked for a single tree to be
  built and reviewed in isolation until the detail was right, then for that
  standard to be folded back into the Skill.
- Baseline: `bg_check.py` PASS and `bg_score.py` 100/100 on the background that
  contained the old trees. Neither gate measures the internal detail of an
  object, so both stayed green while the trunk read as a smooth extruded shape.
- Reproduction: `op_tree_column` drew three signals — a sine centreline,
  cylinder banding, and thin vertical grooves. Rendered alone at 132x360 the
  trunk used 7 colours and had a glassy silhouette.

## Root cause

Insufficient instruction, not a wrong one. `references/ops.md` framed those
three signals as what makes a trunk read as a tree, which is true and was
written against the "utility pole" failure. It was silently also read as the
finished bar. Nothing said that the object spanning the whole canvas needs more
than the minimum.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- Smallest change: extend the existing `tree_column` rather than add a second
  tree op, so the scenes and `bg_check.py`'s `w` reading keep working. Old
  parameters (`hollows`, `grooves`, `base`/`lit`/`dark`) still resolve.
- One home per meaning: parameters in `references/ops.md`, symptoms in
  `references/troubleshooting.md`. Neither list is repeated in `SKILL.md`.

## Review loop

Four rounds with the requester, each on a rendered image rather than a
description. Rejected on the way: moss drawn as smooth lobes (read as leaves
stuck on), plate bark with aligned courses (read as a brick wall), twin trunks
without convergence (read as two parallel poles), and accent-lit lichen (the
already-named "파란 열매"). The approved set is A `fissure`, B `plate`,
D twin trunks, all on the dark tone the requester picked; C `lenticel` (birch)
was built and kept as a parameter but not selected for this scene.

## Approval

Approved by the requester on 2026-09-03: "A, B, D 좋다", after confirming the
dark tone and asking for the ivy.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 after the
bark-style and tree-parameter assertions were added and before the renderer and
`references/ops.md` carried them.

## GREEN

`bash .harness/tests/verify-background-generator-skill.sh` passed after
`op_tree_column` and both reference documents landed in the two Skill trees.

## Contract verification

`bash .harness/tests/verify-contract.sh` passed.

## Downstream

`bg_002_deep_forest` and `bg_003_deep_forest_night` were re-rendered with the
new trees and their 12 animation frames re-baked. `bg_check.py` PASS on both;
`bg_score.py` 100/100 and 97/100, unchanged from before the tree work.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, the bark styles and ivy are
asserted mechanically, and every required check passes.
