#!/usr/bin/env python3
"""계절 x 시간대 16장을 한 장으로 붙인다.

16장을 하나씩 열어 보면 색감 차이가 기억에 남지 않는다. 특히 모델을 바꿔가며
비교할 때는 같은 격자에 놓고 봐야 한다 — 노을 넉 장이 전부 갈색이 된 것도
시트로 보고서야 한눈에 잡혔다.

사용:
    python3 sheet.py out/q_codex-astra -o out/q_codex-astra-sheet.png
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

SEASONS = ["spring", "summer", "autumn", "winter"]
PHASES = ["dawn", "day", "dusk", "night"]
TILE = (400, 200)
LABEL_H = 16


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("-o", "--out")
    ap.add_argument("--tile-width", type=int, default=TILE[0])
    a = ap.parse_args()

    src = Path(a.dir)
    out = Path(a.out) if a.out else src.with_suffix(".png").with_name(src.name + "-sheet.png")
    tw = a.tile_width
    th = tw // 2                      # 배경이 2:1 이다
    sheet = Image.new("RGB", (tw * 4, (th + LABEL_H) * 4), (18, 18, 22))
    d = ImageDraw.Draw(sheet)

    missing = []
    for r, season in enumerate(SEASONS):
        for c, phase in enumerate(PHASES):
            f = src / f"{season}_{phase}.png"
            y = r * (th + LABEL_H)
            d.text((c * tw + 4, y + 3), f"{season}_{phase}", fill=(210, 210, 220))
            if not f.exists():
                missing.append(f.name)
                continue
            # NEAREST — 도트를 보려는 것이니 보간하면 안 된다
            sheet.paste(Image.open(f).resize((tw, th), Image.NEAREST), (c * tw, y + LABEL_H))

    sheet.save(out)
    print(f"{out}  {sheet.size[0]}x{sheet.size[1]}")
    if missing:
        print(f"없는 장면 {len(missing)}개: {' '.join(missing)}")


if __name__ == "__main__":
    main()
