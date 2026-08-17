#!/usr/bin/env bash

set -u

failures=0
skill=.claude/skills/work/SKILL.md
scenarios=.harness/tests/skill-scenarios.md
baseline=${WORK_BASELINE_FIXTURE:-.harness/tests/fixtures/work-baseline-response.md}
post_skill=${WORK_POST_SKILL_FIXTURE:-.harness/tests/fixtures/work-post-skill-response.md}
contract=.harness/tests/verify-contract.sh
specifier=.harness/roles/specifier.md
feature_specs=.harness/specs/features/README.md
feature_spec_template=.harness/templates/feature-spec.md
specifier_baseline=.harness/tests/fixtures/work-specifier-baseline-response.md
specifier_post=.harness/tests/fixtures/work-specifier-post-skill-response.md

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

assert_sha256() {
  if [ ! -f "$1" ]; then
    fail "cannot hash missing file: $1"
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$1" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$1" | awk '{print $1}')
  else
    fail 'cannot verify SHA-256: install sha256sum or shasum'
    return
  fi

  if [ "$actual" != "$2" ]; then
    fail "unexpected SHA-256 for $1"
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

assert_lines_in_order() {
  path=$1
  shift

  previous_line=0
  for expected_line in "$@"; do
    count=$(grep -F -x -c -- "$expected_line" "$path" || true)
    if [ "$count" -ne 1 ]; then
      fail "expected exactly one line in $path: $expected_line"
      continue
    fi

    line=$(grep -F -x -n -- "$expected_line" "$path" | cut -d: -f1)
    if [ "$line" -le "$previous_line" ]; then
      fail "lines are not in required order in $path: $expected_line"
    fi
    previous_line=$line
  done
}

assert_numbered_phase_order() {
  path=$1
  heading=$2
  phase_count=$3
  shift 3

  numbered_count=$(section "$path" "$heading" | grep -E -c '^[0-9]+\. \*\*' || true)
  if [ "$numbered_count" -ne "$phase_count" ]; then
    fail "$heading must contain exactly $phase_count numbered phases"
  fi

  previous_line=0
  for expected_prefix in "$@"; do
    count=$(section "$path" "$heading" | grep -F -c -- "$expected_prefix" || true)
    if [ "$count" -ne 1 ]; then
      fail "$heading must contain exactly one phase: $expected_prefix"
      continue
    fi

    line=$(section "$path" "$heading" | grep -F -n -- "$expected_prefix" | cut -d: -f1)
    if [ "$line" -le "$previous_line" ]; then
      fail "$heading phases are not in required order: $expected_prefix"
    fi
    previous_line=$line
  done
}

assert_file "$skill"
assert_file "$scenarios"
assert_file "$baseline"
assert_file "$post_skill"
assert_file "$contract"
assert_file "$specifier"
assert_file "$feature_specs"
assert_file "$feature_spec_template"
assert_file "$specifier_baseline"
assert_file "$specifier_post"

assert_sha256 "$baseline" d1e7a35a766c977fea66d32ed0670833ad3ee08ded2ca2394b2c5f023f0110f5
assert_sha256 "$post_skill" 9368c26cdab8fff8e04e4a81e235376358b09c35e17254dff6abec4d2b9bbcce

assert_section_contains "$skill" '## Lightweight track' 'Scope confirmation' \
  'lightweight track must begin with scope confirmation'
assert_section_contains "$skill" '## Lightweight track' 'Minimal implementation' \
  'lightweight track must require minimal implementation'
assert_section_contains "$skill" '## Lightweight track' 'Mechanical verification' \
  'lightweight track must require Mechanical verification'
assert_section_contains "$skill" '## Lightweight track' 'Diff review' \
  'lightweight track must end with diff review'
assert_numbered_phase_order "$skill" '## Lightweight track' 4 \
  '1. **Scope confirmation**' \
  '2. **Minimal implementation**' \
  '3. **Mechanical verification**' \
  '4. **Diff review**'

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

assert_numbered_phase_order "$skill" '## Standard track' 5 \
  '1. **Interview/Seed**' \
  '2. **Explore and plan**' \
  '3. **Implement**' \
  '4. **Verify and review**' \
  '5. **Evolve**'

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
assert_contains "$skill" '[Specifier](../../../.harness/roles/specifier.md)' \
  'work Skill must point to the Specifier contract'
assert_contains "$skill" '.harness/specs/features/' \
  'work Skill must point to the feature-spec directory'
assert_contains "$skill" 'existing approved feature specification' \
  'work Skill must use an approved feature specification as the Seed'
assert_contains "$skill" 'missing or ambiguous' \
  'work Skill must invoke Specifier only when the feature specification is missing or ambiguous'
assert_contains "$skill" 'Specifier only for that missing-or-ambiguous branch' \
  'work Skill must require Specifier output only for the missing-or-ambiguous branch'

for role in explorer planner implementer verifier reviewer; do
  assert_contains "$skill" ".harness/roles/$role.md" \
    "work Skill must preserve the $role core role"
done

for heading in \
  '## Status' \
  '## Owner' \
  '## Problem and user outcome' \
  '## Scope' \
  '## Non-goals' \
  '## Domain rules' \
  '## Acceptance criteria' \
  '## Edge and error cases' \
  '## API and data impact' \
  '## Open questions' \
  '## Related implementation plan'; do
  assert_contains "$feature_spec_template" "$heading" \
    "feature-spec template is missing required section: $heading"
done

assert_not_contains "$specifier_baseline" '.harness/specs/features/' \
  'Specifier baseline fixture must omit a feature-spec path'

for required in \
  '.harness/specs/features/' \
  'Draft' \
  '승인' \
  'Explorer → Planner → Implementer → Verifier → Reviewer'; do
  assert_contains "$specifier_post" "$required" \
    "Specifier post-Skill fixture is missing required result: $required"
done
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
assert_contains "$scenarios" 'Rust 프로젝트에 pet 상태를 한 단계 증가시키는 작은 기능을 추가해줘.' \
  'scenario record must bind the post-Skill fixture to the exact request'

for prohibited in \
  'standard' \
  'lightweight' \
  'Interview/Seed' \
  'Mechanical Review' \
  'Semantic Review' \
  'Independent Review' \
  'Evolve'; do
  assert_not_contains "$baseline" "$prohibited" \
    "baseline fixture must omit post-Skill phase: $prohibited"
done

assert_contains "$post_skill" '선택 트랙: **standard**' \
  'post-Skill fixture must select the standard track'
assert_contains "$post_skill" '**Interview/Seed**' \
  'post-Skill fixture must include Interview/Seed'
assert_lines_in_order "$post_skill" \
  '1. **Explorer** — 영향받는 상태, 호출 경로, Rust 규칙과 기존 테스트를 확인' \
  '2. **Planner** — 최소 변경안과 실패해야 하는 집중 테스트, 검증 명령을 정의' \
  '3. **Implementer** — 테스트를 먼저 실패시킨 뒤 최소 구현' \
  '4. **Verifier**' \
  '5. **Reviewer** — 구현자와 분리된 **Independent Review** 수행' \
  '6. **Evolve** — 재사용할 교훈이나 반복 마찰을 기록하고, 없으면 `none` 기록'

for required in \
  '**Mechanical Review**' \
  '**Semantic Review**' \
  '**Independent Review**' \
  'fresh command output' \
  'completion claim을 하지 않겠습니다.'; do
  assert_contains "$post_skill" "$required" \
    "post-Skill fixture is missing required result: $required"
done

assert_lines_in_order "$post_skill" \
  '   - **Mechanical Review** — formatter, build, lint, test를 fresh output으로 실행' \
  '   - **Semantic Review** — 성공 기준별 실제 동작을 대조' \
  '5. **Reviewer** — 구현자와 분리된 **Independent Review** 수행'

assert_contains "$contract" 'bash .harness/tests/verify-work-skill.sh' \
  'contract verification must run the work Skill behavior check'

if [ "$failures" -ne 0 ]; then
  printf 'Work Skill verification failed: %s assertion(s).\n' "$failures"
  exit 1
fi

printf 'Work Skill verification passed.\n'
