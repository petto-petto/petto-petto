#!/usr/bin/env bash

set -u

failures=0

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

assert_exact_lines_in_order() {
  path=$1
  shift

  if [ ! -f "$path" ]; then
    fail "cannot inspect missing file: $path"
    return
  fi

  previous_line=0
  for expected_line in "$@"; do
    count=$(grep -F -x -c -- "$expected_line" "$path" || true)
    if [ "$count" -eq 0 ]; then
      fail "missing exact Rust command: $expected_line"
      continue
    fi
    if [ "$count" -ne 1 ]; then
      fail "Rust command must appear exactly once: $expected_line"
      continue
    fi

    line=$(grep -F -x -n -- "$expected_line" "$path" | cut -d: -f1)
    if [ "$line" -le "$previous_line" ]; then
      fail "Rust commands are not in the required order: $expected_line"
    fi
    previous_line=$line
  done
}

assert_skill_frontmatter() {
  if [ ! -f "$1" ]; then
    fail "cannot inspect missing Skill: $1"
    return
  fi

  if [ "$(sed -n '1p' "$1")" != '---' ] \
    || [ "$(sed -n '2p' "$1")" != "name: $2" ] \
    || ! sed -n '3p' "$1" | grep -E -q '^description: "[^"]*"$' \
    || [ "$(sed -n '4p' "$1")" != '---' ] \
    || [ "$(grep -F -x -c -- '---' "$1" || true)" -ne 2 ]; then
    fail "invalid Skill frontmatter: $1"
  fi
}

assert_rust_runner_shape() {
  if [ ! -f "$1" ]; then
    fail "missing Rust verification runner: $1"
    return
  fi

  actual=$(<"$1")
  expected_with_preflight=$'#!/usr/bin/env bash\n\nset -euo pipefail\n\nif [ ! -f Cargo.toml ]; then\n  printf \'%s\\n\' \'Rust verification cannot run: Cargo.toml is missing. This harness branch does not track Cargo.toml/Cargo.lock; land the existing manifest separately, then rerun bash .harness/scripts/verify-rust.sh.\'\n  exit 1\nfi\n\ncargo fmt --all -- --check\ncargo check --workspace --all-targets --all-features\ncargo clippy --workspace --all-targets --all-features -- -D warnings\ncargo test --workspace --all-features'

  if [ "$actual" != "$expected_with_preflight" ]; then
    fail 'Rust verification runner has an unsupported executable shape'
  fi
}

assert_adapter() {
  if [ ! -L "$1" ]; then
    fail "missing Skill adapter symlink: $1"
  elif [ "$(readlink "$1")" != "$2" ]; then
    fail "wrong Skill adapter target: $1"
  elif [ ! -d "$1" ]; then
    fail "Skill adapter does not resolve to a directory: $1"
  elif [ ! -r "$1/SKILL.md" ]; then
    fail "Skill adapter does not expose a readable SKILL.md: $1"
  fi
}

for path in \
  AGENTS.md \
  CLAUDE.md \
  .harness/README.md \
  .harness/CHANGELOG.md \
  .harness/rules/rust.md \
  .harness/rules/skill-authoring.md \
  .harness/references/writing-great-skills/SKILL.md \
  .harness/references/writing-great-skills/GLOSSARY.md; do
  assert_file "$path"
done

if [ -f CLAUDE.md ] && [ "$(sed '/^[[:space:]]*$/d' CLAUDE.md)" != '@AGENTS.md' ]; then
  fail 'CLAUDE.md must only import @AGENTS.md'
fi

for instruction in \
  '.harness/rules/rust.md' \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  '$work' \
  '$harness-improve' \
  'fresh evidence'; do
  assert_contains AGENTS.md "$instruction" "AGENTS.md is missing required guidance: $instruction"
done

assert_sha256 .harness/references/writing-great-skills/SKILL.md 3fc52d73ec3959091e455681e9f894046b2cb59d1881c69efabd7f9ccb2bc13e
assert_sha256 .harness/references/writing-great-skills/GLOSSARY.md b0421d239599252c5adbb07f8559a0a422e7b89b59183e9efbee12eecc208318

assert_exact_lines_in_order .harness/rules/rust.md \
  'cargo fmt --all -- --check' \
  'cargo check --workspace --all-targets --all-features' \
  'cargo clippy --workspace --all-targets --all-features -- -D warnings' \
  'cargo test --workspace --all-features'

for instruction in \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  'baseline scenario' \
  'failing contract or behavior check'; do
  assert_contains .harness/rules/skill-authoring.md "$instruction" "skill authoring rule is missing: $instruction"
done

assert_skill_frontmatter .claude/skills/work/SKILL.md work
assert_skill_frontmatter .claude/skills/harness-improve/SKILL.md harness-improve

for path in \
  .claude/skills/work/SKILL.md \
  .harness/rules/rust.md; do
  assert_contains "$path" 'bash .harness/scripts/verify-rust.sh' \
    "shared Rust verification entrypoint is missing from: $path"
done

for role in explorer planner implementer verifier reviewer; do
  assert_file ".harness/roles/$role.md"
done

for path in \
  .harness/roles/specifier.md \
  .harness/specs/features/README.md \
  .harness/templates/feature-spec.md; do
  assert_file "$path"
done

for instruction in \
  '[Specifier](../../../.harness/roles/specifier.md)' \
  '.harness/specs/features/' \
  'existing approved feature specification' \
  'missing or ambiguous' \
  'new or changed user-visible behavior' \
  'domain rules' \
  'public interfaces' \
  'persisted formats' \
  'ambiguous feature request without an approved feature specification'; do
  assert_contains .claude/skills/work/SKILL.md "$instruction" \
    "work Skill is missing Specifier contract guidance: $instruction"
done

assert_contains .harness/roles/specifier.md \
  '.harness/specs/features/YYYY-MM-DD-<feature-name>.md' \
  'Specifier contract is missing the dated feature-spec filename convention'

if ! bash .harness/tests/verify-work-skill.sh; then
  fail 'work Skill behavior verification failed'
fi

if ! bash .harness/tests/verify-harness-improve-skill.sh; then
  fail 'harness-improve Skill behavior verification failed'
fi

assert_file .harness/scripts/verify-rust.sh
assert_rust_runner_shape .harness/scripts/verify-rust.sh
assert_adapter .agents/skills/work ../../.claude/skills/work
assert_adapter .agents/skills/harness-improve ../../.claude/skills/harness-improve

for required in \
  '## Provenance and evidence boundary' \
  'Exact requests' \
  'Agent run identifiers' \
  'Pre-Skill repository state' \
  'Post-Skill repository state' \
  'Read inputs' \
  'Artifacts and SHA-256' \
  '/root/baseline_work_skill' \
  '/root/implement_task_2/work_skill_scenario' \
  '/root/baseline_harness_improve' \
  '/root/implement_task_3/fresh_harness_scenario_round2' \
  '520d7b7' \
  'dd37caf' \
  '591ec80' \
  '4840a63' \
  '7ef26f6' \
  'Fixtures are captured outputs; scripts validate retained artifacts but do not rerun a model or prove universal behavior.' \
  'Fixtures are durable captured transcripts; live agent invocation is intentionally not part of deterministic contract verification.'; do
  assert_contains .harness/tests/skill-scenarios.md "$required" \
    "scenario provenance is missing: $required"
done

for path in .harness/README.md .harness/CHANGELOG.md; do
  assert_contains "$path" 'does not track Cargo.toml/Cargo.lock' \
    "manifest-boundary documentation is missing from: $path"
done

stale_pattern='ai-pet-design|Type[S]cript|Elec[t]ron|Math[.]random|Event[S]tore|Ralph|Ouroboros'
stale_paths='AGENTS.md CLAUDE.md .claude .agents .harness/README.md .harness/CHANGELOG.md .harness/rules .harness/roles .harness/friction .harness/scripts'
if git grep -n -E -- "$stale_pattern" -- $stale_paths; then
  fail 'forbidden stale reference found in tracked harness paths'
fi

if [ "$failures" -ne 0 ]; then
  printf 'Contract verification failed: %s assertion(s).\n' "$failures"
  exit 1
fi

printf 'Contract verification passed.\n'
