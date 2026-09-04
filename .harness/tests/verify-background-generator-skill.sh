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

for documented_stamp in rock_mossy mushroom_cluster log_mossy bush_leafy; do
  grep -F -q -- "\`$documented_stamp\`" "$canonical_root/references/stamps.md"
done

# 고목은 이 스킬이 그리는 가장 큰 오브젝트다. 수피 양식과 담쟁이가 코드와 문서
# 양쪽에 있어야 다음 사람이 파라미터의 존재를 안다.
for bark_style in fissure plate lenticel; do
  grep -F -q -- "\"$bark_style\"" "$canonical_root/scripts/bg_render.py"
done
for tree_param in bark ivyStrands stubs converge; do
  grep -F -q -- "\`$tree_param\`" "$canonical_root/references/ops.md"
done
grep -F -q -- '담쟁이' "$canonical_root/references/ops.md"

# 잎덩어리와 지면은 화면 면적이 가장 큰 둘이다. 새 파라미터가 코드와 문서 양쪽에
# 있어야 다음 사람이 존재를 안다.
for mass_param in crest litSpan patches pebbles; do
  grep -F -q -- "\`$mass_param\`" "$canonical_root/references/ops.md"
done
grep -F -q -- 'litClumps' "$canonical_root/scripts/bg_render.py"
grep -F -q -- '브로콜리' "$canonical_root/references/troubleshooting.md"

# 1. accent 대비 진단 — 프리셋 고를 때 '이 팔레트로는 대비를 못 만든다'를 알려야 한다.
grep -F -q -- 'accent_contrast' "$canonical_root/scripts/bgcore.py"
grep -F -q -- 'accent_contrast' "$canonical_root/scripts/bg_palette.py"
grep -F -q -- 'accent 대비' "$canonical_root/references/color.md"
# 4. 하이라이트를 절대 밝기가 아니라 화면 자신의 동적 범위로 잰다.
grep -F -q -- 'dynamic_range' "$canonical_root/scripts/bg_score.py"
grep -F -q -- '동적 범위' "$canonical_root/references/color.md"
# 기각한 지표는 왜 기각했는지 남긴다 — 다음 사람이 같은 제안을 반복하지 않도록.
grep -F -q -- '색상 지배도' "$canonical_root/references/quality.md"

# P2. 인터뷰가 정지 화면 한 장만 전제하면, 움직임·변형·노출 요구가 뒤늦게 나온다.
for slot in motion variants exposure; do
  grep -F -q -- "\"$slot\"" "$canonical_root/scripts/bg_interview.py"
done
for slot_name in '움직이는 요소' '변형 개수' '노출·톤 강도'; do
  grep -F -q -- "$slot_name" "$canonical_root/scripts/bg_interview.py"
  grep -F -q -- "$slot_name" "$canonical_root/references/interview.md"
done
# 가중치 합이 100이어야 모호도 계산이 성립한다.
python3 - "$canonical_root/scripts/bg_interview.py" <<'PYCHECK'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
body = src[src.index("SLOTS = ["):src.index("THRESHOLD")]
total = sum(int(w) for w in re.findall(r'^\s*\("[a-z_]+",\s*(\d+),', body, re.M))
assert total == 100, f"슬롯 가중치 합이 {total} (100이어야 함)"
PYCHECK

# P3-7. 기존 프리셋을 태워 파생하는 길. 손으로 명도를 재배치하면 두 함정에 빠진다 —
# 옅은 색이 쨍해지고, 무채색이 회색이 된다.
grep -F -q -- '--from' "$canonical_root/scripts/bg_preset_new.py"
grep -F -q -- '--burn' "$canonical_root/scripts/bg_preset_new.py"
grep -F -q -- 'def derive' "$canonical_root/scripts/bg_preset_new.py"
grep -F -q -- '프리셋 파생' "$canonical_root/references/color.md"

# P4. 절차와 규율 — 이번에 실제로 통한 방식과 실제로 데인 자리.
grep -F -q -- '격리해' "$canonical_root/SKILL.md"
grep -F -q -- '임시 디렉터리' "$canonical_root/SKILL.md"
grep -F -q -- '난수 소비' "$canonical_root/references/ops.md"

# P3-6. 인터뷰가 '움직이는 요소'를 차단 슬롯으로 묻는데, 그 답을 실행할 도구가
# 스킬 안에 있어야 한다. 프레임을 검사하지 않으면 승격이 아니라 위치 변경이다.
test -f "$canonical_root/scripts/bg_animate.py"
test -f "$codex_root/scripts/bg_animate.py"
grep -F -q -- 'animate' "$canonical_root/scripts/bg_animate.py"
grep -F -q -- 'bg_animate.py' "$canonical_root/SKILL.md"
grep -F -q -- 'animation' "$canonical_root/scripts/bg_check.py"
grep -F -q -- 'animation' "$canonical_root/references/layers.md"
grep -F -q -- '미검증' "$canonical_root/references/layers.md"

# P1-3. 작은 원본을 크게 확대하면 4px 블록이 된다. 고해상도 변형이 있는데도
# 작은 쪽을 확대해 쓰는 경우를 정적으로 잡는다.
grep -F -q -- '고해상도 변형' "$canonical_root/scripts/bg_check.py"

for required in \
  evals/evals.json \
  references/quality.md \
  references/examples/forest_example.png \
  scripts/bg_render.py \
  scripts/bg_check.py \
  scripts/bg_final.py \
  scripts/bgcore.py \
  stamps/interior/fireplace.txt \
  stamps/outdoor/tree_pine.txt \
  stamps/outdoor/rock_mossy.txt \
  stamps/outdoor/mushroom_cluster.txt \
  stamps/outdoor/log_mossy.txt \
  stamps/outdoor/bush_leafy.txt; do
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
test "$file_count" = 72
while IFS= read -r relative; do
  cmp -s "$canonical_root/$relative" "$codex_root/$relative"
done < "$canonical_files"

PETTO_BACKGROUND_PYCACHE=/tmp/petto-petto-background-pycache
PYTHONPYCACHEPREFIX="$PETTO_BACKGROUND_PYCACHE" python3 -m py_compile "$canonical_root"/scripts/*.py

# 이 검사는 "Pillow가 없을 때 스킬이 닫히는가"를 본다. 그러려면 Pillow를 못 찾는
# 환경이 필요한데, 검사를 돌리는 사람의 셸에 프로젝트 venv가 PATH 앞에 걸려 있으면
# 여기서 Pillow가 잡혀 검사가 스스로 실패한다 — 스킬이 아니라 셸이 원인이다.
# 그래서 검사가 **스스로 깨끗한 환경을 만든다.**
pillow_free_env() {
  env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$HOME" \
      PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 "$@"
}

if pillow_free_env python3 -c 'import PIL' >"$blocked_output" 2>&1; then
  printf '%s\n' 'FAIL: dependency-gate check needs an environment without Pillow'
  printf '%s\n' '      (/usr/bin/python3 can import PIL — install location is unexpected)'
  exit 1
fi

for script in "$(dirname "$skill")"/scripts/bg_*.py; do
  if pillow_free_env python3 -B -S "$script" --help >"$blocked_output" 2>&1; then
    printf 'FAIL: Pillow-free execution was accepted: %s\n' "$script"
    exit 1
  fi
  grep -F -q -- 'Pillow is required' "$blocked_output"
done

printf '%s\n' 'Background generator Skill verification passed.'
