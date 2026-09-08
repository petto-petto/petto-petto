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
# accent 는 "한 장면 안에서 온도를 대비시키는 유일한 램프"인데, 색상환에서
# 중경의 보색으로만 파생되면 지정할 방법이 없다. 초록 숲의 보색은 보라라서
# 따뜻한 햇살을 accent 로 둘 수 없었다.
grep -F -q -- '--accent' "$canonical_root/scripts/bg_preset_new.py"

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
test "$file_count" = 76
while IFS= read -r relative; do
  if ! cmp -s "$canonical_root/$relative" "$codex_root/$relative"; then
    printf 'FAIL: the two Skill trees differ: %s\n' "$relative"
    exit 1
  fi
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

# 이펙트 op 은 구도가 아니다. 핵심 요소로 셀 수 있으면 "contact_shadow 를 4개
# 쓰겠다" 고 선언하고 4개 쓰는 것으로 구도 점수가 만점이 된다 — 자기충족적이다.
grep -F -q -- 'EFFECT_OPS = (' "$canonical_root/scripts/bg_score.py"
# 상수가 있는 것만으로는 부족하다 — 요소 집계에서 실제로 걸러야 한다.
grep -F -q -- 'if not is_effect(' "$canonical_root/scripts/bg_score.py"
for effect_op in glow specks rays contact_shadow autoshade; do
  grep -F -q -- "\"$effect_op\"" "$canonical_root/scripts/bg_score.py"
done
# 문서의 예시가 잘못을 가르치면 검사보다 예시가 이긴다.
if grep -F -q -- '"op": "glow"' "$canonical_root/scripts/bg_score.py"; then
  printf '%s\n' 'FAIL: bg_score.py의 예시가 이펙트 op을 핵심 요소로 가르친다'
  exit 1
fi

# 사용자에게 물을 수 있는데 자기 채점한 결과로 최종 통과를 선언할 수 없다.
grep -F -q -- 'judged_by' "$canonical_root/scripts/bg_visual.py"
grep -F -q -- 'judged_by' "$canonical_root/scripts/bg_final.py"
grep -F -q -- '--unattended' "$canonical_root/scripts/bg_final.py"

# `next` 는 "지금 무엇을 물을까"를 답하는 명령이다. 차단 슬롯 조회를 모호도 분기
# 안에 두면 물을 것이 가장 많은 경우에 이름이 대입되지 않아 크래시했다. 조회는
# 분기 밖에서 무조건 일어나야 한다.
python3 - "$canonical_root/scripts/bg_interview.py" <<'PYCHECK'
import ast, sys
tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())
fn = next(n for n in ast.walk(tree)
          if isinstance(n, ast.FunctionDef) and n.name == "main")
branch = next(n for n in ast.walk(fn)
              if isinstance(n, ast.If) and ast.dump(n.test).find("'next'") != -1)
first = branch.body[0]
assert isinstance(first, ast.Assign) and first.targets[0].id == "stuck", \
    "bg_interview.py: `next` 분기는 stuck 대입으로 시작해야 한다 (조건부면 크래시)"
PYCHECK

# 스킬 본문이 다시 비대해지는 것을 기계적으로 막는다. 두 가지가 함께 커진다 —
# 길이 자체(sprawl)와, references/ 와 스크립트가 이미 소유한 기준값의 재기술
# (duplication). 재기술은 지표를 바꿀 때 고칠 자리를 하나 더 만들고, 둘이
# 어긋나도 읽는 사람은 알 수 없다 — 실제로 프리셋 표의 layout 이 그렇게 어긋났다.
skill_lines=$(wc -l < "$skill" | tr -d ' ')
if [ "$skill_lines" -gt 240 ]; then
  printf 'FAIL: SKILL.md is %s lines (cap 240)\n' "$skill_lines"
  printf '      기준값·배점표는 references/ 와 스크립트 --help 가 소유한다.\n'
  exit 1
fi

# 아래는 전부 다른 곳이 소유하고, 그 소유자가 실행 시 스스로 출력한다.
#   references/quality.md  — 게이트 기준값
#   bg_check.py            — 검사할 때마다 항목명과 실측값을 함께 찍는다
#   bg_score.py            — 배점과 획득 점수를 항목별로 찍는다
#   bg_final.py --help     — 최종 다섯 조건
for owned_threshold in \
  '24~48' \
  '>= 15%' '≥ 15%' \
  '>= 7구간' '≥ 7구간' \
  '75% 이상' '≥75%' \
  '<= 16%' '≤ 16%' \
  '검수 결과 첨부'; do
  if grep -F -q -- "$owned_threshold" "$skill"; then
    printf 'FAIL: SKILL.md restates a threshold it does not own: %s\n' "$owned_threshold"
    exit 1
  fi
done

printf '%s\n' 'Background generator Skill verification passed.'
