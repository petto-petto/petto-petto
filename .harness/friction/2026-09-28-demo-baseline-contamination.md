# Demo collector baselines left in development databases

## Evidence

- Request: switch meta usage collection from the demo `FixtureCollector` to the
  real `ccusage` collector.
- Baseline: every earlier app run stored the demo collector's 12-week fixture as
  collection baselines in `meta_source` / `meta_source_baseline_row` inside the
  shared `petto.sqlite`.
- Risk when the same database is reused in real mode: a real total below the demo
  baseline marks every source `rebased`; a higher total is computed row by row
  against demo rows and credits fabricated tokens, coins, and achievements.
- Scope: development databases only. Real users never ran the demo collector.

## Root cause

Ownership gap between modes: demo and real collectors share one persisted
baseline with no marker saying which collector produced it.

## Pruning

- Canonical owner: the meta feature (`packages/pet-meta`) and its persistence.
- Smallest change: record only, plus a PR note telling teammates to clear their
  local database or keep `META_DEMO_USAGE=1`. A migration that detects demo
  baselines would add a persisted-format rule for a development-only condition.

## Approval

Approved by the requester on 2026-09-28 as a friction record only; the requester
chose to reset their own local database.

## RED

Reasoning from `packages/pet-meta/src/domain/usage/pipeline.ts`
(`runSingleSource`: `currentTotal < baseline.totalObserved` → `rebased`;
otherwise `computeDelta` against baseline rows). Not reproduced, to avoid writing
fabricated usage into a real database.

## GREEN

After moving `petto.sqlite` aside, a real-mode start captured a clean baseline
(`claude_code` 154,948,766) and one minute later applied only real usage
(+950,337).

## Contract verification

`bash .harness/tests/verify-contract.sh` → `Contract verification passed.`

## CHANGELOG.md

Recorded under `Unreleased / Added`.

## Completion

Recorded. Open gap: tag baselines with their collector if demo and real modes
must coexist in one database.
