# Background ids that collide

## Evidence

- Found while pruning the Skill: the asset tree holds five backgrounds under four
  ids. `bg_002_deep_forest` and `bg_002_moonlit_gacha_grove` both declare
  `id: bg_002`; `bg_003_deep_forest_night` and `bg_003_arcane_combine_cavern`
  both declare `id: bg_003`.
- Consequence: the runtime meta is written as `{id}.json`, so each pair writes
  `bg_002.json` / `bg_003.json`. Anything that resolves a background by id gets
  one of two answers depending on which directory it looked in.
- `bg_scaffold.py` contained no reference to duplicate ids.

## Root cause

`--id` was free text. The Skill told the author to check by hand
("`ls`로 겹침 확인"), which is the kind of instruction that holds until two people
generate backgrounds in the same week.

## Pruning

- The check lives in `bg_scaffold.py`, where the id is chosen, and only runs when
  `--root` is given — that is the flag that tells the scaffold where the asset
  tree is.
- It refuses the collision, names the offending directories, and computes the
  next free `bg_###`, so the fix is one flag away rather than a search.
- It also warns about collisions that already exist, so an author sees the state
  of the tree before adding to it.

## The existing collisions were left alone

Fixing them is not a one-line edit. The directory name embeds the id
(`{id}_{slug}`), as do the meta and every layer PNG, so a rename touches the
directory, six filenames and the scene. More importantly the pet-room work
already depends on the current names —
`packages/pet-room/test/scene.contract.test.ts` asserts
`day.id === 'bg_002'` and `day.directory === 'bg_002_deep_forest'`.

Renaming asset directories that another in-progress workstream resolves by name
is the requester's call, not a side effect of adding a guard. The finding and the
migration steps were reported instead.

## Approval

Requested by the requester on 2026-09-04: "진행해", after the guard was offered.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` exited 1 before
`bg_scaffold.py` carried the check.

## GREEN

Passes; `bash .harness/tests/verify-contract.sh` passes. Verified by hand: a
colliding `--id` is refused with the next free number, and a free `--id` proceeds
while printing the two pre-existing collisions.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete for the Skill. Outstanding for the requester: whether to renumber the
two colliding backgrounds.
