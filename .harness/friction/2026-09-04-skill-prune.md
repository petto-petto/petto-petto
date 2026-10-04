# Pruning the background Skill

## Evidence

- Request: the Skill body had grown bloated and carried unnecessary guidance;
  duplicated context should become references, and the result should read as an
  outline.
- Baseline: `SKILL.md` 509 lines against 1,257 lines of `references/`. Section
  weights: the gate section 60 lines, preset selection 55, the user-confirmation
  loop 53, the report template 32, the score table 32.

## Duplication, measured

Every gate metric appeared in both places, under a sentence that named the other
one as the source: "기준값과 출처는 references/quality.md. 아래는 요약이다" —
followed by the full table.

| owned by | restated in SKILL.md |
| --- | --- |
| `references/quality.md` | every threshold, 44 lines of tables |
| `bg_final.py --help` | the five final conditions, verbatim |
| `bg_visual.py form` | the seven visual-review items and their weights |
| `bg_score.py` output | the 100-point breakdown |
| `presets.json` | the preset table |
| the file's own body | 13 of 19 "안 하는 것" entries, several with a §-reference back to the section they restate |

## What duplication had already cost

The preset table listed `cozy_study` and `interior` as `layout: interior`, while
`presets.json` records `layout: ground` for both. Two sources had drifted apart
and neither was obviously wrong to a reader. `bg_scaffold.py` reads the field, so
correcting the data changes scaffold output; the discrepancy is reported rather
than silently resolved.

## Pruning

- The gate tables, score breakdown, visual items and final conditions were
  deleted, not summarised. `bg_check.py` prints each check's name and measured
  value, so nothing needs to be memorised from the document.
- `bg_palette.py list` gained a `layout` column — the one piece of information the
  deleted preset table held that the data was not surfacing.
- The three interview sections merged into one; the five verification sections
  became two.
- The prohibition list kept only rules stated nowhere else — five of nineteen.
- Two mechanical guards now hold the line: a 240-line cap, and a check that the
  file does not restate thresholds owned by `references/`.

## The compression introduced two regressions, caught by smoke-testing

Every command and pointer in the rewritten file was executed rather than eyeballed.

- `bg_elements.py template` lost its required `--structure` argument.
- The compressed pointer index dropped the `references/` prefix, leaving seven
  filenames without a location.

Both were fixed before the change landed. Rewriting a procedure document without
running what it says is how a shorter file becomes a wrong one.

## Approval

Requested by the requester on 2026-09-04.

## RED

`bash .harness/tests/verify-background-generator-skill.sh` reported
`SKILL.md is 509 lines` before the rewrite.

## GREEN

Passes from both a clean shell and one carrying the project venv;
`bash .harness/tests/verify-contract.sh` passes. All eleven referenced files
exist and ten of eleven quoted commands ran unchanged, the eleventh after its fix.

## CHANGELOG.md

Recorded under `Unreleased / Changed`.

## Completion

Complete: 509 to 239 lines, both Skill trees byte-identical, and the anti-sprawl
and anti-duplication guards asserted mechanically.

## Redone after the work was lost

The first prune was never committed, and the branch moved. `SKILL.md` came back
at 509 lines while the friction record survived — which is the only reason the
rewrite was cheap the second time. The record carried the measurements, the
ownership table, and the two regressions to watch for; redoing the work meant
re-applying decisions, not re-making them. Uncommitted harness work is one
branch switch away from gone.

The two mechanical guards were absent as well, so they were re-added first and
confirmed to fail on the un-pruned file (`SKILL.md is 509 lines`) before the
rewrite began. Both were then negative-tested by reintroducing the fault they
exist to catch.

## Smoke-testing found a crash the prune did not cause

Running all sixteen commands the Skill quotes surfaced a defect in shipped code:
`bg_interview.py next` raised `UnboundLocalError` whenever ambiguity exceeded the
threshold, because the blocking-slot lookup had been placed inside the
low-ambiguity branch. The command exists to answer "what do I ask next", so it
failed in precisely the situation it is for, and the same control flow told the
caller to start drawing when a blocking slot was empty.

The lookup is now unconditional and an AST assertion pins it. The lesson is not
about the prune: **the commands a document quotes are the document.** Reading
them proves nothing; only running them does.

A second, smaller cost was self-inflicted. The tree-comparison loop failed
through `set -e` with no message, so a mismatched file produced a bare exit 1.
It now names the file.
