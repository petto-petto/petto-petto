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

  actual=$(shasum -a 256 "$1" | awk '{print $1}')
  if [ "$actual" != "$2" ]; then
    fail "unexpected SHA-256 for $1"
  fi
}

assert_skill_frontmatter() {
  if [ ! -f "$1" ]; then
    fail "cannot inspect missing Skill: $1"
    return
  fi

  if [ "$(sed -n '1p' "$1")" != '---' ] || ! grep -q "^name: $2$" "$1" || ! grep -q '^description: ' "$1"; then
    fail "invalid Skill frontmatter: $1"
  fi
}

assert_adapter() {
  if [ ! -L "$1" ]; then
    fail "missing Skill adapter symlink: $1"
  elif [ "$(readlink "$1")" != "$2" ]; then
    fail "wrong Skill adapter target: $1"
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

for command in \
  'cargo fmt --check' \
  'cargo check' \
  'cargo clippy -- -D warnings' \
  'cargo test'; do
  assert_contains .harness/rules/rust.md "$command" "missing required Rust command: $command"
done

for instruction in \
  '.harness/references/writing-great-skills/SKILL.md' \
  '.harness/references/writing-great-skills/GLOSSARY.md' \
  'baseline scenario' \
  'failing contract or behavior check'; do
  assert_contains .harness/rules/skill-authoring.md "$instruction" "skill authoring rule is missing: $instruction"
done

assert_skill_frontmatter .claude/skills/work/SKILL.md work
assert_skill_frontmatter .claude/skills/harness-improve/SKILL.md harness-improve

for role in explorer planner implementer verifier reviewer; do
  assert_file ".harness/roles/$role.md"
done

assert_file .harness/scripts/verify-rust.sh
assert_adapter .agents/skills/work ../../../.claude/skills/work
assert_adapter .agents/skills/harness-improve ../../../.claude/skills/harness-improve

stale_pattern='ai-pet-design|Type[S]cript|Elec[t]ron|Math[.]random|Event[S]tore|Ralph|Ouroboros'
stale_paths='AGENTS.md CLAUDE.md .claude .agents .harness/README.md .harness/CHANGELOG.md .harness/rules .harness/roles .harness/friction .harness/scripts'
for path in $stale_paths; do
  if [ -e "$path" ] && grep -R -n -E -- "$stale_pattern" "$path"; then
    fail "forbidden stale reference found under: $path"
  fi
done

if [ "$failures" -ne 0 ]; then
  printf 'Contract verification failed: %s assertion(s).\n' "$failures"
  exit 1
fi

printf 'Contract verification passed.\n'
