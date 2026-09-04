#!/usr/bin/env python3
"""검수용 GIF. 에셋이 아니라 눈으로 확인하려고 만드는 것이다.

런타임이 할 일(sky/far/mid는 고정, near만 교체)을 그대로 재현한다 — GIF가 실제
게임 화면과 다르게 보이면 검수가 의미 없다.

프레임마다 팔레트를 새로 뽑으면 색이 미세하게 흔들려 반딧불이가 아니라 화면 전체가
깜빡이는 것처럼 보인다. 그래서 첫 프레임의 팔레트를 전 프레임에 강제한다.

    python3 tools/backgrounds/make_gif.py <배경 디렉터리> <out.gif> [scale]
"""

import json
import sys
from pathlib import Path

from PIL import Image


def build(out_dir, gif_path, scale=1):
    out_dir = Path(out_dir)
    meta = json.loads(next(out_dir.glob("bg_*.json")).read_text(encoding="utf-8"))
    anim = meta["animation"]
    moving = anim["layer"]

    base = None
    for layer in sorted(meta["layers"], key=lambda l: l["z"]):
        if layer["name"] == moving:
            continue
        img = Image.open(out_dir / layer["file"]).convert("RGBA")
        base = img if base is None else Image.alpha_composite(base, img)

    frames = []
    for rel in anim["frames"]:
        near = Image.open(out_dir / rel).convert("RGBA")
        flat = Image.alpha_composite(base, near).convert("RGB")
        if scale > 1:
            flat = flat.resize((flat.width * scale, flat.height * scale), Image.NEAREST)
        frames.append(flat)

    master = frames[0].quantize(colors=64, method=Image.Quantize.MEDIANCUT,
                                dither=Image.Dither.NONE)
    paletted = [f.quantize(palette=master, dither=Image.Dither.NONE) for f in frames]
    duration = round(1000 / anim["fps"])
    paletted[0].save(gif_path, save_all=True, append_images=paletted[1:],
                     duration=duration, loop=0, optimize=False, disposal=1)
    print(f"{gif_path}  {len(paletted)}장 @ {anim['fps']}fps "
          f"({duration}ms/frame, {len(paletted)*duration/1000:.1f}초 루프)  "
          f"{frames[0].width}x{frames[0].height}  "
          f"{Path(gif_path).stat().st_size/1024:.0f}KB")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
