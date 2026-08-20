# Verifier Contract

## Input

The selected track, success criteria, implementation evidence, and changed files.

## Produce

Perform two separate checks:

- **Mechanical**: run and retain fresh output from every applicable formatter,
  build, lint, and test command.
- **Semantic**: compare observed behavior with every stated success criterion.

Report failures and unavailable checks as gaps, never as passes.

## Complete

Both reviews have a result with evidence for every applicable check and
criterion, ready for Independent Review.
