#!/usr/bin/env bash

set -u

failures=0
skill=.claude/skills/harness-improve/SKILL.md
friction=.harness/friction/README.md
scenarios=.harness/tests/skill-scenarios.md
baseline=${HARNESS_IMPROVE_BASELINE_FIXTURE:-.harness/tests/fixtures/harness-improve-baseline-response.md}
post_skill=${HARNESS_IMPROVE_POST_SKILL_FIXTURE:-.harness/tests/fixtures/harness-improve-post-skill-response.md}
contract=.harness/tests/verify-contract.sh
changelog=.harness/CHANGELOG.md

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
  if [ ! -f "$1" ]; then
    fail "cannot inspect missing file: $1"
  elif ! grep -F -q -- "$2" "$1"; then
    fail "$3"
  fi
}

assert_not_contains() {
  if [ -f "$1" ] && grep -F -q -- "$2" "$1"; then
    fail "$3"
  fi
}

assert_file "$skill"
assert_file "$friction"
assert_file "$scenarios"
assert_file "$baseline"
assert_file "$post_skill"
assert_file "$contract"
assert_file "$changelog"

if [ -f "$skill" ]; then
  if [ "$(sed -n '1p' "$skill")" != '---' ] \
    || ! grep -q '^name: harness-improve$' "$skill" \
    || ! grep -q '^description: Evidence:' "$skill"; then
    fail 'harness-improve Skill must have evidence-led frontmatter'
  fi
fi

for trigger in \
  'explicit' \
  '$harness-improve' \
  '/harness-improve' \
  'implicit' \
  'rules' \
  'Skills' \
  'roles' \
  'verification' \
  'repeated friction'; do
  assert_contains "$skill" "$trigger" "Skill description or body is missing trigger: $trigger"
done

for required in \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  'before changing' \
  'Evidence' \
  'root cause' \
  'Prune' \
  'smallest change' \
  'user approval' \
  'RED' \
  'GREEN' \
  'bash .harness/tests/verify-contract.sh' \
  'CHANGELOG.md' \
  'observable'; do
  assert_contains "$skill" "$required" "Skill is missing required harness-improve behavior: $required"
done

for required in \
  'Evidence' \
  'baseline' \
  'root cause' \
  'pruning' \
  'approval' \
  'RED' \
  'GREEN' \
  'contract verification' \
  'CHANGELOG.md' \
  'completion'; do
  assert_contains "$friction" "$required" "friction loop is missing required record field: $required"
done

assert_contains "$scenarios" 'fixtures/harness-improve-baseline-response.md' \
  'scenario record must point to the harness-improve baseline fixture'
assert_contains "$scenarios" 'fixtures/harness-improve-post-skill-response.md' \
  'scenario record must point to the harness-improve post-Skill fixture'
assert_contains "$scenarios" 'bash .harness/tests/verify-harness-improve-skill.sh' \
  'scenario record must contain the harness-improve behavior-check command'
assert_contains "$scenarios" '팀원이 반복해서 검증 명령을 빠뜨려서 하네스를 개선하고 싶다.' \
  'scenario record must bind fixtures to the exact request'

for missing in \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  'pruning review' \
  'RED-GREEN' \
  'CHANGELOG'; do
  assert_not_contains "$baseline" "$missing" \
    "baseline fixture must omit post-Skill requirement: $missing"
done

for required in \
  'single repository-owned verification entrypoint' \
  'evidence' \
  'user approval' \
  'no harness files changed'; do
  assert_contains "$post_skill" "$required" \
    "post-Skill fixture is missing required result: $required"
done

assert_contains "$contract" 'bash .harness/tests/verify-harness-improve-skill.sh' \
  'contract verification must run the harness-improve behavior check'
assert_contains "$changelog" 'evidence-driven harness evolution' \
  'CHANGELOG must record evidence-driven harness evolution'

if [ "$failures" -ne 0 ]; then
  printf 'Harness-improve Skill verification failed: %s assertion(s).\n' "$failures"
  exit 1
fi

printf 'Harness-improve Skill verification passed.\n'
