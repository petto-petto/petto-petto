#!/usr/bin/env python3
"""검수용 미리보기를 한 번에 만든다 — 확대, 캐릭터 합성, 레이어 분해, 이전본 대조.

이 스크립트가 있는 이유: 배경 작업에서 게이트를 통과했는지보다 **눈으로 봤을 때
말이 되는지**가 자주 갈린다. 실제로 걸린 결함들(전봇대 같은 줄기, 막대사탕 나무,
창백한 화면, 파란 열매처럼 튀는 액센트)은 전부 수치가 아니라 확대 미리보기에서
보였다. 그런데 그때마다 확대·합성 코드를 새로 짜게 되므로 여기 묶어 둔다.

에셋이 아니다 — 최종 배경은 언제나 1배다. 미리보기는 프로젝트 밖에 둔다.

Usage:
    python3 bg_preview.py <out-dir> --out /tmp/prev.png --scale 3
    python3 bg_preview.py <out-dir> --out /tmp/prev.png --pet path/to/pet.png
    python3 bg_preview.py <out-dir> --out /tmp/prev.png --layers
    python3 bg_preview.py <out-dir> --out /tmp/prev.png --compare <이전 out-dir>
"""
import argparse
import json
import os
import sys
import warnings

import bg_pillow_gate  # noqa: F401

warnings.filterwarnings("ignore", category=DeprecationWarning)


def load(outdir):
    from PIL import Image
    metas = [f for f in os.listdir(outdir) if f.endswith(".json") and f != "scene.json"]
    if not metas:
        raise SystemExit(f"{outdir}: 메타 json이 없다")
    meta = json.load(open(os.path.join(outdir, metas[0]), encoding="utf-8"))
    img = Image.open(os.path.join(outdir, meta["composite"])).convert("RGBA")
    return meta, img


def stack(tiles, gap=8, bg=(18, 18, 18, 255)):
    from PIL import Image
    w = max(t.size[0] for t in tiles)
    h = sum(t.size[1] for t in tiles) + gap * (len(tiles) - 1)
    out = Image.new("RGBA", (w, h), bg)
    y = 0
    for t in tiles:
        out.alpha_composite(t, ((w - t.size[0]) // 2, y))
        y += t.size[1] + gap
    return out


def main():
    from PIL import Image
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("outdir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--pet", help="캐릭터 PNG — petAnchor 크기로 맞춰 합성한다")
    ap.add_argument("--layers", action="store_true", help="레이어를 따로 쌓아 보여준다")
    ap.add_argument("--compare", help="이전 결과 폴더 — 위아래로 나란히")
    a = ap.parse_args()

    meta, img = load(a.outdir)
    tiles = []
    if a.compare:
        _, prev = load(a.compare)
        if prev.size != img.size:
            prev = prev.resize(img.size, Image.NEAREST)
        tiles.append(prev)
    tiles.append(img)
    if a.pet:
        pa = meta.get("petAnchor")
        if not pa:
            print("경고: petAnchor가 없어 합성을 건너뛴다", file=sys.stderr)
        else:
            pet = Image.open(a.pet).convert("RGBA")
            if pet.size != (pa["w"], pa["h"]):
                pet = pet.resize((pa["w"], pa["h"]), Image.NEAREST)
            c = img.copy()
            c.alpha_composite(pet, (pa["x"], pa["y"]))
            tiles.append(c)
    if a.layers:
        for l in sorted(meta["layers"], key=lambda x: x["z"]):
            lay = Image.open(os.path.join(a.outdir, l["file"])).convert("RGBA")
            chk = Image.new("RGBA", lay.size, (40, 40, 46, 255))
            for y in range(0, lay.size[1], 8):
                for x in range(0, lay.size[0], 8):
                    if (x // 8 + y // 8) % 2:
                        for yy in range(y, min(y + 8, lay.size[1])):
                            for xx in range(x, min(x + 8, lay.size[0])):
                                chk.putpixel((xx, yy), (52, 52, 60, 255))
            chk.alpha_composite(lay)
            tiles.append(chk)
    sheet = stack(tiles)
    w, h = sheet.size
    sheet.convert("RGB").resize((w * a.scale, h * a.scale), Image.NEAREST).save(a.out)
    print(f"written: {a.out}  ({len(tiles)}장, x{a.scale})")
    print("보면서 확인할 것 — references/troubleshooting.md 의 증상 목록")


if __name__ == "__main__":
    main()
