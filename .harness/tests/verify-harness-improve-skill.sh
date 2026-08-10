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

assert_sha256() {
  if [ ! -f "$1" ]; then
    fail "cannot hash missing file: $1"
    return
  fi

  actual=$(shasum -a 256 "$1" | awk '{print $1}')
  if [ "$actual" != "$2" ]; then
    fail "unexpected SHA-256 for $1"
  fi
}

assert_text_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "$3" ;;
  esac
}

assert_markers_in_order() {
  path=$1
  shift

  if [ ! -f "$path" ]; then
    fail "cannot inspect missing file: $path"
    return
  fi

  previous_line=0
  for marker in "$@"; do
    count=$(grep -F -c -- "$marker" "$path" || true)
    if [ "$count" -ne 1 ]; then
      fail "expected exactly one ordered marker in $path: $marker"
      continue
    fi

    line=$(grep -F -n -- "$marker" "$path" | cut -d: -f1)
    if [ "$line" -le "$previous_line" ]; then
      fail "markers are not in required order in $path: $marker"
    fi
    previous_line=$line
  done
}

assert_file "$skill"
assert_file "$friction"
assert_file "$scenarios"
assert_file "$baseline"
assert_file "$post_skill"
assert_file "$contract"
assert_file "$changelog"

if [ -f "$skill" ]; then
  description=$(sed -n '3p' "$skill")
  if [ "$(sed -n '1p' "$skill")" != '---' ] \
    || ! grep -q '^name: harness-improve$' "$skill" \
    || ! printf '%s\n' "$description" | grep -q '^description: Evidence:'; then
    fail 'harness-improve Skill must have evidence-led frontmatter'
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
    assert_text_contains "$description" "$trigger" \
      "Skill description is missing trigger: $trigger"
  done
fi

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

assert_sha256 "$baseline" 968cc63fcb89a8b10b3aee5fd27970ab16c2590c7c60b21c4222213d0c2ee7bd
assert_sha256 "$post_skill" a23aa9a745b9950e74ee3213505a2a363965574b0ac27ca958e646296d06e7c3

for present in \
  '누락됐다는 정확한 명령명' \
  '단일 repo-owned 진입점' \
  '포맷 오류' \
  '완료 조건:'; do
  assert_contains "$baseline" "$present" \
    "baseline fixture must preserve present behavior: $present"
done

for missing in \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  'root cause' \
  'pruning review' \
  'RED-GREEN' \
  'user approval' \
  'verify-contract' \
  'CHANGELOG'; do
  assert_not_contains "$baseline" "$missing" \
    "baseline fixture must omit post-Skill requirement: $missing"
done

for missing_result in \
  '| Root-cause classification | **Missing (RED)**' \
  '| Explicit user approval | **Missing (RED)**' \
  '| Contract validation | **Missing (RED)**'; do
  assert_contains "$scenarios" "$missing_result" \
    "baseline scenario must record missing condition: $missing_result"
done

assert_markers_in_order "$post_skill" \
  '## Read evidence' \
  '## Evidence' \
  '## Root cause' \
  '## Pruning and smallest change' \
  '## User approval' \
  '## RED' \
  '## GREEN' \
  '## Contract verification' \
  '## CHANGELOG update' \
  '## Observable completion'

assert_contains "$post_skill" \
  '`.harness/references/writing-great-skills/SKILL.md`를 읽은 뒤 `.harness/references/writing-great-skills/GLOSSARY.md`를 읽었습니다.' \
  'post-Skill fixture must prove both embedded references were read first and in order'

for required in \
  '단일 repo-owned verification entrypoint' \
  '하네스 파일을 변경하지 않았습니다.'; do
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
