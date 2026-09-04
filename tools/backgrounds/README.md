# 펫룸 배경 재생성

`background-generator` Skill이 굽는 것은 정적 4레이어 한 세트다. 펫룸 배경은 거기에
두 가지가 더 필요해서 이 스크립트들이 있다.

- **같은 구도를 낮/밤 두 프리셋으로** — `scene.json`을 손으로 두 벌 유지하면 한쪽만
  고치는 사고가 난다. 구도는 `build_petroom_scene.py` 한 곳에 있고 프리셋만 갈아 끼운다.
- ~~반딧불이 애니메이션 프레임~~ — **Skill로 옮겼다.**
  `.claude/skills/background-generator/scripts/bg_animate.py` 를 쓴다. 움직일 op에
  `"animate": true` 를 붙이고 `bg_animate.py <배경 디렉터리>` 로 굽는다.

```bash
export PATH="$PWD/.venv/bin:$PATH"   # Pillow는 프로젝트 venv에 있다

BG=apps/desktop/renderer/assets/backgrounds
SKILL=.claude/skills/background-generator

# 1) 정적 본체
python3 tools/backgrounds/build_petroom_scene.py jungle bg_002 "깊은 숲 (낮)" 0.0 day \
  > "$BG/bg_002_deep_forest/scene.json"
python3 "$SKILL/scripts/bg_render.py" "$BG/bg_002_deep_forest/scene.json" \
  --out-dir "$BG/bg_002_deep_forest"

# 2) 게이트 — 둘 다 통과해야 완성이다
python3 "$SKILL/scripts/bg_check.py" "$BG/bg_002_deep_forest"
python3 "$SKILL/scripts/bg_score.py" "$BG/bg_002_deep_forest" \
  --elements tools/backgrounds/petroom-elements.json

# 3) 반딧불이 12프레임 + 런타임 json의 animation 블록
python3 "$SKILL/scripts/bg_animate.py" "$BG/bg_002_deep_forest" --frames 12 --fps 6
```

밤 버전은 `forest_night bg_003 "깊은 숲 (밤)" ... night`, out-dir은
`$BG/bg_003_deep_forest_night`.

`petroom-interview.json`은 구도를 정한 인터뷰 명세다(모호도 0%). 구도를 바꾸기 전에
여기부터 고친다 — `bg_interview.py score`로 다시 잴 수 있다.
