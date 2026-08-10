#!/usr/bin/env bash

set -u

failures=0
skill=.claude/skills/work/SKILL.md
scenarios=.harness/tests/skill-scenarios.md

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

assert_file() {
  if [ ! -f "$1" ]; then
    fail "missing file: $1"
  fi
}

assert_contains() {
  if ! grep -F -q -- "$2" "$1"; then
    fail "$3"
  fi
}

assert_not_contains() {
  if grep -F -q -- "$2" "$1"; then
    fail "$3"
  fi
}

section() {
  awk -v heading="$2" '
    $0 == heading { active = 1; next }
    active && /^## / { exit }
    active { print }
  ' "$1"
}

assert_section_contains() {
  if ! section "$1" "$2" | grep -F -q -- "$3"; then
    fail "$4"
  fi
}

assert_section_not_contains() {
  if section "$1" "$2" | grep -F -q -- "$3"; then
    fail "$4"
  fi
}

assert_file "$skill"
assert_file "$scenarios"
assert_file .harness/tests/fixtures/work-baseline-response.md
assert_file .harness/tests/fixtures/work-post-skill-response.md

assert_section_contains "$skill" '## Lightweight track' 'Scope confirmation' \
  'lightweight track must begin with scope confirmation'
assert_section_contains "$skill" '## Lightweight track' 'Minimal implementation' \
  'lightweight track must require minimal implementation'
assert_section_contains "$skill" '## Lightweight track' 'Mechanical verification' \
  'lightweight track must require Mechanical verification'
assert_section_contains "$skill" '## Lightweight track' 'Diff review' \
  'lightweight track must end with diff review'

for prohibited in \
  'Explorer contract' \
  'Planner' \
  'Implementer' \
  'Verifier' \
  'Reviewer' \
  'Semantic' \
  'Independent Review' \
  'Evolve'; do
  assert_section_not_contains "$skill" '## Lightweight track' "$prohibited" \
    "lightweight track must not require standard-work phase: $prohibited"
done

for required in \
  'Interview/Seed' \
  'Explorer' \
  'Planner' \
  'Implementer' \
  'Verifier' \
  'Reviewer' \
  'Mechanical' \
  'Semantic' \
  'Independent Review' \
  'Evolve'; do
  assert_section_contains "$skill" '## Standard track' "$required" \
    "standard track is missing required phase: $required"
done

assert_not_contains "$skill" '## Review evidence' \
  'review definitions must live in role contracts, not the work Skill'
assert_contains "$skill" '[Verifier](../../../.harness/roles/verifier.md)' \
  'work Skill must point to the Verifier contract'
assert_contains "$skill" '[Reviewer](../../../.harness/roles/reviewer.md)' \
  'work Skill must point to the Reviewer contract'
assert_contains "$scenarios" 'fixtures/work-baseline-response.md' \
  'scenario record must point to the baseline fixture'
assert_contains "$scenarios" 'fixtures/work-post-skill-response.md' \
  'scenario record must point to the post-Skill fixture'
assert_contains "$scenarios" 'bash .harness/tests/verify-work-skill.sh' \
  'scenario record must contain the behavior-check command'
assert_contains "$scenarios" 'Work Skill verification failed: 18 assertion(s).' \
  'scenario record must contain the RED behavior-check output'
assert_contains "$scenarios" 'Work Skill verification passed.' \
  'scenario record must contain the GREEN behavior-check output'

if [ "$failures" -ne 0 ]; then
  printf 'Work Skill verification failed: %s assertion(s).\n' "$failures"
  exit 1
fi

printf 'Work Skill verification passed.\n'
