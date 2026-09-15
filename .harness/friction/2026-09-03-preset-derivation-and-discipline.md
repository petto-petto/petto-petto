# Deriving a burned preset, and four pieces of discipline

## Evidence

- Request: continue the Skill upgrade plan — item P3-7 (preset derivation), then
  the P4 group (four documentation and environment items).
- Baseline: `bg_preset_new.py` could only generate from keywords or anchors. Its
  anchor ladder is forced to 0.84/0.63/0.44/0.20, so a dark palette was not
  reachable at all; both `forest_night` and `petroom_grove` were produced by
  hand-editing luminance after the tool ran.

## P3-7 — what the measurements forced

The first two designs were wrong, and the renders said so.

| derivation | near layer dL (limit 0.10) | verdict |
| --- | --- | --- |
| source `jungle`, unburned | 0.139 | PASS |
| gamma 1.84 curve, burn 0.7 | 0.071 | FAIL — layer separation |
| gamma 0.86 curve, burn 0.7 | 0.104 | FAIL — luminance bins 6/10 |
| per-ramp bands + depth ladder, burn 0.7 | 0.118 | PASS, 100/100 |
| hand-tuned `petroom_grove` | 0.120 | PASS, 100/100 |

Two gates pull opposite ways. Raising gamma compresses the shadow end, so the
ground and trunks — which live in the low steps — collapse together and layer
separation breaks. Lowering gamma expands the shadows, which empties the bottom
luminance bin and breaks bin coverage. **No single curve satisfies both**, which
is why the working version maps a luminance band per ramp and then re-imposes
the depth ladder explicitly.

Three traps are now encoded in the tool rather than relearned each time:

1. Lowering HLS lightness alone keeps saturation, so pale colours turn vivid —
   the misty sky became fluorescent green. Scale RGB instead.
2. An achromatic source has no hue to keep. `#FFFFFF` also sits at L = 1.0, where
   reconstruction returns white regardless of the inherited hue, so it must drop
   below the ceiling first. Missing that produced a grey step, then a pink one.
3. Uniform compression destroys layer separation, as measured above.

The tool now predicts the separation before writing, so `--burn 0.9` reports a
thin `mid->wood` gap instead of failing at render time.

## P4 — four small items

- **Isolated component review** (`SKILL.md` §5-A). Reviewing a whole background
  makes it hard to say which component is weak. The loop that worked was: render
  the one op alone, fix what is pointed at, then offer three or four variants and
  port the chosen one.
- **Tooling location** (`SKILL.md` §6). The system cleared the `/private/tmp`
  scratchpad mid-task and took the lab scripts with it; only the repository
  copies survived. Derived-output tools must also read `scene.json` alone, so the
  scene stays the single source.
- **RNG discipline** (`references/ops.md`). An opt-in parameter whose disabled
  path draws extra random numbers moves layers the change never touched. This
  cost several rounds during the foliage port.
- **Pillow gate environment** (`verify-background-generator-skill.sh`). The
  fail-closed assertion reported a failure whenever the *checking shell* could
  import Pillow, so the result depended on whether the project venv was on
  `PATH`. It now builds its own clean environment with `env -i` and verifies
  identically from either shell.

## Approval

Requested by the requester on 2026-09-03: "1순위 부터 시작해", then "p4묶음까지".

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 for each
group before its change — first on `--from`/`--burn`/`derive`/docs, then on the
three P4 documentation strings.

## GREEN

Passes from both a clean shell and one with the project venv on `PATH` — the
point of the Pillow fix. `bash .harness/tests/verify-contract.sh` passes in both
as well.

## Regression

`bg_002` and `bg_003` still render `bg_check` PASS and `bg_score` 100/100.

## Note

`bash .harness/scripts/verify-electron.sh` currently fails on five unformatted
files under `packages/pet-room/` and `apps/desktop/src/main/collection.ts`. These
are untracked, belong to the pet-room view work happening separately, and were
left alone. `npx prettier --check tools/` — the paths this work touched — passes.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: both Skill trees are byte-identical, every new behaviour is asserted
mechanically, and the Skill and contract checks pass from either environment.
