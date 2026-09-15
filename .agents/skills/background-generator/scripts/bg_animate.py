#!/usr/bin/env python3
"""scene.json -> 애니메이션 프레임 + 런타임 메타의 animation 블록.

`bg_render.py`는 정지 한 세트만 굽는다. 이 스크립트는 **움직인다고 선언된 op만**
위상을 바꿔 씬을 여러 번 렌더하고, 그 op이 사는 레이어의 PNG만 `frames/`로 모은다.
나머지 레이어는 프레임마다 동일하므로 굽지 않는다 — 런타임은 그 셋을 그대로 두고
한 레이어만 교체한다.

입력은 그 배경의 `scene.json` 하나다. 별도 빌더에 의존하지 않는다(SKILL.md §6).

## 무엇이 움직이는지는 씬이 정한다

움직일 op에 `"animate": true`를 붙인다.

    {"op": "specks", "box": [...], "count": 34, "color": "light.4", "animate": true}
    {"op": "glow", "x": 196, "y": 168, "rx": 7, "color": "light.4", "animate": true}

선언이 하나도 없으면 `specks`와 `glow`를 움직이는 것으로 보고 진행하되 경고한다 —
예전 씬과의 호환이고, 새 씬은 선언해야 한다. 선언이 있어야 물결이나 흔들리는 잎처럼
다른 것을 움직일 수 있다.

지원하는 움직임은 두 가지다.

  - `specks` — 무리가 통째로 조금씩 떠다닌다(box를 흔든다)
  - `glow`   — 반경과 세기가 숨쉰다

프레임마다 좌표를 새로 뽑지 않는다. 그러면 깜빡이는 게 아니라 화면이 갈아엎어진다.

Usage:
    python3 bg_animate.py <배경 디렉터리> [--frames 12] [--fps 6]
"""
import argparse
import copy
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bg_pillow_gate  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

MOVABLE = ("specks", "glow")


def targets_of(scene, explicit=True):
    """움직일 op의 위치 목록 — (레이어 이름, 레이어 인덱스, op 인덱스).

    좌표로 잡아야 씬 사본에서 같은 op을 다시 찾을 수 있다. 객체로 잡으면
    deepcopy 뒤에 대응이 끊긴다.
    """
    out = []
    for li, layer in enumerate(scene.get("layers", [])):
        for oi, op in enumerate(layer.get("ops", [])):
            if op.get("op") not in MOVABLE:
                continue
            if explicit and not op.get("animate"):
                continue
            out.append((layer["name"], li, oi))
    return out


def shifted(scene, targets, phase):
    """위상만큼 움직인 씬 사본.

    원래 자리를 기준으로 조금씩 흔든다. 프레임마다 새로 뽑으면 같은 무리가 떠다니는
    게 아니라 매 프레임 다른 무리가 된다.
    """
    s = copy.deepcopy(scene)
    for i, (_ln, li, oi) in enumerate(targets):
        op = s["layers"][li]["ops"][oi]
        if True:
            if op["op"] == "specks":
                x, y, w, h = op["box"]
                op["box"] = [x + round(6 * math.sin(phase + i)),
                             y + round(4 * math.cos(phase * 1.3 + i)), w, h]
            elif op["op"] == "glow":
                breathe = 0.5 + 0.5 * math.sin(phase + i * 1.7)
                base = op.get("rx", 6)
                r = max(2, round(base * (0.55 + 0.45 * breathe)))
                op["rx"] = op["ry"] = r
                op["x"] += round(5 * math.sin(phase + i))
                op["y"] += round(4 * math.cos(phase * 0.9 + i))
                op["strength"] = round(0.30 + 0.22 * breathe, 3)
            op.pop("animate", None)
    # 렌더러가 모르는 키는 전부 지운다.
    for layer in s["layers"]:
        for op in layer["ops"]:
            op.pop("animate", None)
    return s


def bake(out_dir, count, fps):
    scene_path = os.path.join(out_dir, "scene.json")
    scene = json.load(open(scene_path, encoding="utf-8"))
    bg_id = scene["id"]

    targets = targets_of(scene, explicit=True)
    if not targets:
        targets = targets_of(scene, explicit=False)
        if not targets:
            raise SystemExit(
                "움직일 op이 없다. 움직일 op에 \"animate\": true 를 붙여라.\n"
                f"움직일 수 있는 op: {', '.join(MOVABLE)}")
        print("# 경고: `animate` 선언이 없어 specks/glow 를 움직이는 것으로 봤다.",
              file=sys.stderr)
        print("#   새 씬은 움직일 op에 \"animate\": true 를 붙인다.", file=sys.stderr)

    layers = {t[0] for t in targets}
    if len(layers) != 1:
        raise SystemExit(
            f"움직이는 op이 여러 레이어에 걸쳐 있다: {sorted(layers)}\n"
            "런타임은 한 레이어만 교체한다. 한 레이어로 모아라.")
    moving = layers.pop()

    frames_dir = os.path.join(out_dir, "frames")
    if os.path.isdir(frames_dir):
        shutil.rmtree(frames_dir)
    os.makedirs(frames_dir)

    names = []
    for i in range(count):
        phase = 2 * math.pi * i / count
        with tempfile.TemporaryDirectory() as tmp:
            sp = os.path.join(tmp, "scene.json")
            with open(sp, "w", encoding="utf-8") as f:
                json.dump(shifted(scene, targets, phase), f, ensure_ascii=False)
            rd = os.path.join(tmp, "out")
            subprocess.run([sys.executable, os.path.join(HERE, "bg_render.py"),
                            sp, "--out-dir", rd],
                           capture_output=True, check=True, cwd=HERE)
            dst = os.path.join(frames_dir, f"{moving}_{i:02d}.png")
            shutil.copyfile(os.path.join(rd, f"{bg_id}_{moving}.png"), dst)
            names.append(f"frames/{os.path.basename(dst)}")
        print(f"  frame {i:02d}/{count - 1}  phase={phase:.3f}", file=sys.stderr)

    meta_path = os.path.join(out_dir, f"{bg_id}.json")
    meta = json.load(open(meta_path, encoding="utf-8"))
    meta["animation"] = {
        "layer": moving,
        "fps": fps,
        "loop": True,
        "frames": names,
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"# {os.path.basename(meta_path)} 에 animation 기록 "
          f"({len(names)}장 @ {fps}fps, 레이어 {moving})", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("outdir", help="배경 디렉터리 (scene.json 이 있는 곳)")
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--fps", type=int, default=6)
    a = ap.parse_args()
    if a.frames < 2:
        raise SystemExit("프레임은 2장 이상이어야 애니메이션이다.")
    bake(a.outdir, a.frames, a.fps)


if __name__ == "__main__":
    main()
