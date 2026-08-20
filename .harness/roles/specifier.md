# Specifier Contract

## Input

A new or changed feature request, any existing approved feature specification,
and unresolved product decisions.

## Produce

Use the [feature-spec template](../templates/feature-spec.md) to create or
update one feature specification at
`.harness/specs/features/YYYY-MM-DD-<feature-name>.md`. Make the user outcome,
scope, non-goals, domain rules, acceptance criteria, and unresolved decisions
explicit. The Specifier owns the product `what` and `why`; Planner or the linked
implementation plan owns the technical `how`. Report the proposed dated
`Draft` path and keep that status until the requester approves it.

## Complete

The requester has approved the feature specification, its path and status are
recorded as the standard-track Seed, and every remaining open question has an
owner. Until approval, state that `Explorer → Planner → Implementer → Verifier
→ Reviewer` is blocked. Do not send an unapproved specification to Explorer.
