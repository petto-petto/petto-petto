#!/usr/bin/env bash

set -euo pipefail

skill=${BACKGROUND_SKILL:-.claude/skills/background-generator/SKILL.md}
generator=${BACKGROUND_GENERATOR:-.claude/skills/background-generator/scripts/bg_render.py}
codex_root=.agents/skills/background-generator
canonical_root=$(dirname "$skill")

test -f "$skill"
test -f "$generator"
test -d "$codex_root"
test ! -L "$codex_root"
test -f "$codex_root/SKILL.md"
grep -F -q -- 'name: background-generator' "$skill"
grep -F -q -- 'sky / far / mid / near' "$skill"
grep -F -q -- 'Pillow is required' "$skill"
grep -F -q -- 'Do not run any script, render, verify, or install Pillow.' "$skill"
grep -F -q -- 'apps/desktop/renderer/assets/backgrounds/{id}_{slug}/' "$skill"
grep -F -q -- '"skill_name": "background-generator"' "$canonical_root/evals/evals.json"

for required in \
  evals/evals.json \
  references/quality.md \
  references/examples/forest_example.png \
  scripts/bg_render.py \
  scripts/bg_check.py \
  scripts/bg_final.py \
  scripts/bgcore.py \
  stamps/interior/fireplace.txt \
  stamps/outdoor/tree_pine.txt; do
  test -f "$canonical_root/$required"
  test -f "$codex_root/$required"
done

canonical_files=$(mktemp /tmp/background-generator-canonical.XXXXXX)
codex_files=$(mktemp /tmp/background-generator-codex.XXXXXX)
blocked_output=$(mktemp /tmp/background-generator-blocked.XXXXXX)
trap 'rm -f "$blocked_output" "$canonical_files" "$codex_files"' EXIT
find "$canonical_root" -type f ! -path '*/__pycache__/*' ! -path '*/.omc/*' | sed "s#^$canonical_root/##" | sort > "$canonical_files"
find "$codex_root" -type f ! -path '*/__pycache__/*' ! -path '*/.omc/*' | sed "s#^$codex_root/##" | sort > "$codex_files"
diff -u "$canonical_files" "$codex_files"

file_count=$(wc -l < "$canonical_files" | tr -d ' ')
test "$file_count" = 67
while IFS= read -r relative; do
  cmp -s "$canonical_root/$relative" "$codex_root/$relative"
done < "$canonical_files"

PETTO_BACKGROUND_PYCACHE=/tmp/petto-petto-background-pycache
PYTHONPYCACHEPREFIX="$PETTO_BACKGROUND_PYCACHE" python3 -m py_compile "$canonical_root"/scripts/*.py

if python3 -c 'import PIL' >"$blocked_output" 2>&1; then
  printf '%s\n' 'FAIL: Pillow unexpectedly available for the dependency-gate check'
  exit 1
fi

for script in "$(dirname "$skill")"/scripts/bg_*.py; do
  if PYTHONDONTWRITEBYTECODE=1 python3 -B -S "$script" --help >"$blocked_output" 2>&1; then
    printf 'FAIL: Pillow-free execution was accepted: %s\n' "$script"
    exit 1
  fi
  grep -F -q -- 'Pillow is required' "$blocked_output"
done

printf '%s\n' 'Background generator Skill verification passed.'
