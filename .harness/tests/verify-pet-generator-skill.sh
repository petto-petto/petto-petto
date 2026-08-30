#!/usr/bin/env bash

set -euo pipefail

skill=.claude/skills/pet-generator/SKILL.md
codex_skill=.agents/skills/pet-generator

test -f "$skill"
test -L "$codex_skill"
test "$(readlink "$codex_skill")" = '../../.claude/skills/pet-generator'
test -f "$codex_skill/SKILL.md"
grep -F -q -- 'name: pet-generator' "$skill"
test ! -e .claude/skills/pixel-pet-creator-pillow
test ! -e .agents/skills/pixel-pet-creator-pillow

PETTO_PET_PYCACHE=/tmp/petto-petto-pet-pycache
PYTHONPYCACHEPREFIX="$PETTO_PET_PYCACHE" python3 -m py_compile "$(dirname "$skill")"/scripts/*.py

printf '%s\n' 'Pet generator Skill verification passed.'
