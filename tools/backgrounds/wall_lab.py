#!/usr/bin/env python3
"""벽면 광원 일관성 실험대.

`panel`로 세운 벽은 `bg_check.py`의 **광원 좌상단 일관성**에서 반복적으로 걸린다.
원인은 `panel`이 켜(course)를 `줄눈(어두움) → 윗면(밝음)` 순으로, 즉 밝은 행을
어두운 행 **아래**에 두기 때문이다. 게이트는 8x8 창의 좌상단 삼각형과 우하단
삼각형을 비교하므로, 이 배치는 창마다 우하단을 밝게 만들어 비율을 끌어내린다.

실측(560x240 골목 벽, mid 램프):

    boardH 12 → 56% / 55%      boardH 6 → 32% / 37%

켜를 촘촘하게 할수록 **나빠진다.** 줄눈이 늘어나기 때문이다. 그래서 켜 간격이
아니라 **면 전체의 좌상단 기울기**로 풀어야 한다.

이 스크립트는 후보 패치를 씬에 꽂아 실제로 굽고 게이트를 돌린다 — 랩에서만
좋아 보이고 배경에서는 깨지는 것을 막기 위해 판정은 언제나 `bg_check.py`가 한다.

    python3 tools/backgrounds/wall_lab.py sweep <scene.json>
    python3 tools/backgrounds/wall_lab.py apply <scene.json> <variant> [out.json]

입력은 `scene.json` 하나다(SKILL.md §7). 별도 빌더에 의존하지 않는다.
"""

import copy
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".claude/skills/background-generator"
PY = str(ROOT / ".venv/bin/python")

# 벽 상자 — (레이어, 램프, x0, y0, w, h)
WALLS = [("mid", "mid", 0, 0, 190, 184), ("mid", "mid", 372, 0, 188, 184)]


def _layer(scene, name):
    for layer in scene["layers"]:
        if layer["name"] == name:
            return layer
    raise SystemExit(f"레이어 {name!r}가 없다")


def _set_board(scene, board_h, joint):
    for layer, _ramp, x0, *_ in WALLS:
        for op in _layer(scene, layer)["ops"]:
            if op.get("op") == "panel" and op["box"][0] == x0:
                op["boardH"] = board_h
                op["jointEvery"] = joint


def _insert_after_panels(scene, layer_name, ops):
    """panel/texture 뒤, 스탬프 앞에 끼운다 — 스탬프 자체 3톤을 덮지 않는다."""
    layer = _layer(scene, layer_name)
    last = 0
    for i, op in enumerate(layer["ops"]):
        if op.get("op") in ("panel", "texture"):
            last = i + 1
    layer["ops"][last:last] = ops


def v_gradient_glow(scene, up=0.55, down=0.45, gamma=1.15):
    """좌상단 밝은 글로우 + 우하단 어두운 글로우.

    `glow`는 bayer 디더로 감쇠하므로 벽의 켜 무늬를 지우지 않고 램프 단만 민다.
    같은 램프를 쓰기 때문에 매스가 쪼개지지도 않는다.

    **우하단 어두운 글로우는 공짜가 아니다.** 벽 아랫단을 near 지면 쪽으로 끌어
    내려 `near: 뒤와 명도차`를 0.069까지 떨어뜨린다(하한 0.08). down=0 으로 끄면
    그 게이트가 돌아온다.
    """
    ops = []
    for _layer_name, ramp, x0, y0, w, h in WALLS:
        ops.append({"op": "glow", "x": x0, "y": y0,
                    "rx": int(w * 1.25), "ry": int(h * 1.05),
                    "color": f"{ramp}.4", "strength": up, "gamma": gamma})
        if down:
            ops.append({"op": "glow", "x": x0 + w, "y": y0 + h,
                        "rx": int(w * 0.85), "ry": int(h * 0.75),
                        "color": f"{ramp}.0", "strength": down, "gamma": 1.4})
    _insert_after_panels(scene, "mid", ops)


# far 원경 건물 — 벽과 같은 `panel` 켜 구조라 같은 이유로 걸린다.
FAR_BLOCKS = [(0, 86, 86, 98), (86, 64, 70, 120), (156, 98, 64, 86),
              (220, 74, 78, 110), (298, 104, 58, 80), (356, 68, 74, 116),
              (430, 92, 62, 92), (492, 78, 68, 106)]


def far_glow(scene, up=0.5, gamma=1.2):
    """원경 건물 하나하나에 좌상단 밝은 기울기를 준다.

    **texture 앞에 넣는다.** 뒤에 넣으면 창을 나타내는 accent 자국을 덮어
    `램프 accent: 3단 이상`이 2단으로 떨어진다.
    """
    ops = [{"op": "glow", "x": x0, "y": y0,
            "rx": int(w * 1.3), "ry": int(h * 1.1),
            "color": "far.4", "strength": up, "gamma": gamma}
           for (x0, y0, w, h) in FAR_BLOCKS]
    layer = _layer(scene, "far")
    last = max(i for i, o in enumerate(layer["ops"]) if o.get("op") == "panel") + 1
    layer["ops"][last:last] = ops


def invert_course(scene, layer_name, spec):
    """켜를 뒤집는다 — 밝은 행이 어두운 행 **위**로 온다.

    `panel`의 기본 배치는 `seam`(어두움) 바로 아래에 `light`(밝음)를 둔다. 8x8 창의
    좌상단/우하단 비교에서는 이 순서가 매 창마다 우하단을 밝게 만든다. seam 과
    light 단을 맞바꾸면 벽돌 켜의 **윗면이 빛을 받고 그 아래 줄눈이 그늘지는**
    배치가 되어 좌상단 광원 규칙과 같은 방향이 된다.

    글로우와 달리 디더를 한 픽셀도 더 쓰지 않는다 — 고립픽셀·top1 점유가 그대로다.
    """
    for op in _layer(scene, layer_name)["ops"]:
        if op.get("op") != "panel":
            continue
        seam, light = spec.get(op["box"][0], (None, None))
        if seam is not None:
            op["seam"], op["light"] = seam, light


def thin_rain(scene, count=70):
    """빗방울 수를 줄인다 — `specks`는 1px이라 고립픽셀 게이트에 직접 들어간다."""
    for layer in scene["layers"]:
        for op in layer["ops"]:
            if op.get("op") == "specks":
                op["count"] = count


def stacked_base(scene, steps=(4, 3, 2, 1)):
    """벽을 세로로 잘라 아래로 갈수록 base 단을 낮춘다 (골목 바닥이 어둡다)."""
    layer = _layer(scene, "mid")
    for _ln, ramp, x0, y0, w, h in WALLS:
        src = next(o for o in layer["ops"]
                   if o.get("op") == "panel" and o["box"][0] == x0)
        layer["ops"].remove(src)
        seg = h // len(steps)
        for i, base in enumerate(steps):
            o = copy.deepcopy(src)
            o["box"] = [x0, y0 + i * seg, w, seg if i < len(steps) - 1 else h - i * seg]
            o["base"] = base
            o["light"] = min(4, base + 1)
            o["seed"] = src.get("seed", 9) + i
            layer["ops"].append(o)
    # 스탬프가 벽 뒤로 가지 않게 다시 정렬
    layer["ops"].sort(key=lambda o: 0 if o.get("op") in ("panel", "texture") else 1)


# (벽 x0) -> (seam 단, light 단).  seam 이 밝고 light 가 어둡다 = 켜 뒤집기
WALL_INV = {0: (4, 1), 372: (3, 0)}
FAR_INV = {x0: (3, 0) for (x0, _y, _w, _h) in FAR_BLOCKS}

VARIANTS = {
    "baseline": lambda s: None,
    "inv_wall": lambda s: (_set_board(s, 12, 15), invert_course(s, "mid", WALL_INV)),
    "inv_wall_far": lambda s: (_set_board(s, 12, 15), invert_course(s, "mid", WALL_INV),
                               invert_course(s, "far", FAR_INV)),
    "inv_b8": lambda s: (_set_board(s, 8, 15), invert_course(s, "mid", WALL_INV),
                         invert_course(s, "far", FAR_INV)),
    "inv_b6": lambda s: (_set_board(s, 6, 15), invert_course(s, "mid", WALL_INV),
                         invert_course(s, "far", FAR_INV)),
    "inv_b16": lambda s: (_set_board(s, 16, 18), invert_course(s, "mid", WALL_INV),
                          invert_course(s, "far", FAR_INV)),
    "glow_ref": lambda s: (_set_board(s, 12, 15), v_gradient_glow(s, 0.55, 0, 1.2),
                           far_glow(s, 0.5, 1.2)),
}

LIGHT = re.compile(r"광원 좌상단 일관성.*?(\d+)/(\d+) = (\d+)%")
MISS = re.compile(r"광원 어긋난 매스: \('(\w+)', (\d+), '.*?= (\d+)%'\)")
RESULT = re.compile(r"RESULT: (\w+)(?:\s+\((\d+) failed\))?")


def build(scene_path, variant):
    scene = json.loads(Path(scene_path).read_text(encoding="utf-8"))
    VARIANTS[variant](scene)
    return scene


def measure(scene):
    with tempfile.TemporaryDirectory() as td:
        sp = Path(td) / "scene.json"
        sp.write_text(json.dumps(scene, ensure_ascii=False), encoding="utf-8")
        out = Path(td) / "out"
        r = subprocess.run([PY, str(SKILL / "scripts/bg_render.py"), str(sp),
                            "--out-dir", str(out)], capture_output=True, text=True)
        if r.returncode:
            return {"error": r.stderr.strip()[-200:]}
        c = subprocess.run([PY, str(SKILL / "scripts/bg_check.py"), str(out), "--verbose"],
                           capture_output=True, text=True)
        txt = c.stdout
        m, res = LIGHT.search(txt), RESULT.search(txt)
        return {
            "light": f"{m.group(3)}% ({m.group(1)}/{m.group(2)})" if m else "?",
            "miss": [f"{a}:{c_}%" for a, _b, c_ in MISS.findall(txt)],
            "result": res.group(1) if res else "?",
            "failed": [ln.strip() for ln in txt.splitlines() if "[FAIL]" in ln],
        }


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, scene_path = sys.argv[1], sys.argv[2]
    if cmd == "sweep":
        for name in VARIANTS:
            r = measure(build(scene_path, name))
            print(f"{name:<22} light={r.get('light','?'):<14} {r.get('result','?'):<5} "
                  f"miss={','.join(r.get('miss', [])) or '-'}")
            for f in r.get("failed", []):
                print(f"    {f}")
    elif cmd == "apply":
        variant = sys.argv[3]
        scene = build(scene_path, variant)
        dest = sys.argv[4] if len(sys.argv) > 4 else scene_path
        Path(dest).write_text(json.dumps(scene, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{variant} -> {dest}")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
