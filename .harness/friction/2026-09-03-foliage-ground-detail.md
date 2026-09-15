# Foliage and ground detail, and the sky that pays for it

## Evidence

- Request: after the tree work the requester asked for the same treatment on the
  two largest remaining masses — `foliage` and `ground_plane` — and, on seeing
  the result, that the whole image be burned down because it looked washed out.
- Baseline: `bg_check.py` PASS on both backgrounds, light-direction consistency
  76% against a 75% limit.
- Reproduction: `op_foliage` tiled perfect circles on a jittered grid and gave
  every lobe its own rim light; `op_ground_plane` drew full-width bands, an
  evenly spaced vertical comb, and a straight `rect` grass line.

## Root cause

Two separate ones.

- **Detail**: the rim light was applied per lobe rather than per mass. A single
  light source lights only the lobes facing it; giving every lobe its own rim is
  what reads as broccoli.
- **Tone**: `jungle`'s sky ramp tops out at `#FFFFFF` and its far ramp at
  `#D0EDD8`, so the mist band blew out at 960x360.

## Pruning

- Canonical owner: `.claude/skills/background-generator/`, mirrored
  byte-for-byte to `.agents/skills/background-generator/`.
- Smallest change: extend the two existing ops rather than add new ones, and
  make every new behaviour opt-in behind `crest` so existing scenes are
  untouched. Tone is a new preset key, not an edit to `jungle`.
- One home per meaning: parameters in `references/ops.md`, symptoms in
  `references/troubleshooting.md`, the gate conflict in
  `references/gate_conflicts.md`.

## The constraint that cost the most

Applying the canopy mode to the **far** layer breaks the light-consistency gate.
The far foliage's upper edge is the sky's lower boundary; moving it splits the
sky into fragments, and a fragmented misty sky has no left-right light direction,
so the per-window test lands on dither noise (measured 28%, 41%, 57% across
runs). Two attempted fixes made it worse and are recorded as such: adding an
upper-left `glow` to the sky (13% — the glow is a different ramp, so the bright
pixels leave the sky mass) and steepening the sky gradient (28% — fragments that
had been skipped as uniform became testable). The resolution is structural: the
canopy mode is opt-in, and the far layer does not opt in.

A second trap: the first port changed the order and count of `random` draws in
the disabled path, so the same seed produced a different lobe layout and moved
the far canopy line anyway. The disabled path must draw no extra numbers.

## Review loop

Rejected on the way: radial leaf spikes (read as a saw), a per-lobe outer shadow
ring (read as stippling), a linear light gradient across the box (one bright
half), rectangular soil patches (glitch), large smooth soil ellipses (lily pads),
and pebbles drawn from the `far` ramp (the already-named 파란 열매).

## Interruption

The scratchpad under `/private/tmp` was cleared mid-task by the system, taking
the lab scripts with it. The repository copies survived. The labs now live in
`tools/backgrounds/` and `bake_frames.py` reads `scene.json` directly instead of
depending on a builder script.

## Verification

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 with the new
assertions before the change and passed after. `bash .harness/tests/verify-contract.sh`
and `bash .harness/scripts/verify-electron.sh` pass. Both backgrounds re-render
from the Skill alone with `bg_check.py` PASS and `bg_score.py` 97/100.

Run the contract check without the project venv on `PATH` — the Skill's
fail-closed Pillow assertion is defeated by a shell that can import Pillow.

## CHANGELOG.md

Recorded under `Unreleased / Added` and `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, the new parameters and the sixth
gate conflict are asserted mechanically, and every required check passes.
