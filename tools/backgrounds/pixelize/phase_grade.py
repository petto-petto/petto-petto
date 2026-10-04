#!/usr/bin/env python3
"""배경 한 장에서 dawn/day/dusk/night 네 장을 파생한다.

## 픽셀은 한 번만 만진다

22색짜리 도트 그림은 **인덱스 + 팔레트**다. 시간대가 바뀌어도 '어느 픽셀이
몇 번 색인가'는 그대로고 팔레트만 달라진다. 그래서 인덱스 이미지를 한 번
만들어 두고 `putpalette` 만 네 번 부른다 — 583,200 픽셀을 네 번 훑지 않는다.

이건 최적화이기 이전에 **런타임이 쓸 수 있는 형태**다. 게임이 시간대를 바꿀 때도
같은 일을 하면 된다.

## 왜 램프가 먼저인가

명도만 보고 색을 밀면 시간대 변환이 실패한다. 하늘의 밝은 시안과 잎의 밝은
녹색은 둘 다 '밝은 색'이지만 노을에서는 반대로 가야 한다 — 하늘은 주황으로
물들고 잎은 역광 실루엣이 된다. 그래서 `assign_ramps.py` 가 배정한 역할을
읽어 **램프 단위로** 규칙을 준다.

## 색상환을 도는 방향

`pull` 은 목표 색상까지 얼마나 끌지다. 시안(H194)에서 주황(H16)처럼 거의
정반대인 경우 0.72 로는 중간인 연두에서 멈춘다 — 실제로 그렇게 실패했다.
반대로 갈색(H26)에서 남색(H223)은 짧은 쪽이 자홍을 지나므로, 조금만 끌어도
줄기가 자주색이 된다. 그런 램프는 `hue=None` 으로 색상을 놔두고 명도만 만진다.

사용:
    python3 phase_grade.py <이미지> [-r ramps.json] [-o 출력디렉터리]
"""

import argparse
import colorsys
import json
from pathlib import Path

from PIL import Image

#   hue    끌려갈 색상(0~1). None 이면 색상을 건드리지 않는다.
#   pull   그 색상으로 얼마나 끌리는가(0~1). 색상환 반대편이면 1.0 에 가까워야 한다.
#   lmul   명도 배수.
#   smul   채도 배수. 1.0 에서 크게 벗어나면 형광이 된다.
PHASES = {
    "dawn": {   # 여명 — 하늘은 연보라, 빛은 차갑고 옅다
        "sky":     dict(hue=0.80, pull=0.45, lmul=0.88, smul=0.85),
        "mist":    dict(hue=0.82, pull=0.40, lmul=0.90, smul=0.80),
        "foliage": dict(hue=0.55, pull=0.20, lmul=0.72, smul=0.95),
        "wood":    dict(hue=None, pull=0.00, lmul=0.70, smul=0.90),
        "light":   dict(hue=0.92, pull=0.30, lmul=0.92, smul=0.75),
    },
    "day": {},   # 항등 — 원본이 낮이다
    "dusk": {   # 노을 — 하늘이 주황, 잎과 줄기는 역광 실루엣
        "sky":     dict(hue=0.045, pull=0.98, lmul=0.90, smul=1.10),
        "mist":    dict(hue=0.055, pull=0.92, lmul=0.86, smul=1.05),
        "foliage": dict(hue=0.10,  pull=0.30, lmul=0.62, smul=1.00),
        "wood":    dict(hue=0.03,  pull=0.25, lmul=0.55, smul=1.00),
        "light":   dict(hue=0.055, pull=0.65, lmul=1.00, smul=1.20),
    },
    "night": {  # 밤 — 전부 남색으로, 빛만 남긴다
        "sky":     dict(hue=0.63, pull=0.90, lmul=0.34, smul=0.72),
        "mist":    dict(hue=0.64, pull=0.85, lmul=0.40, smul=0.70),
        "foliage": dict(hue=0.60, pull=0.55, lmul=0.42, smul=0.80),
        "wood":    dict(hue=None, pull=0.00, lmul=0.45, smul=0.80),
        "light":   dict(hue=0.14, pull=0.25, lmul=0.82, smul=0.90),
    },
}
PHASE_ORDER = ["dawn", "day", "dusk", "night"]

IDENTITY = dict(hue=None, pull=0.0, lmul=1.0, smul=1.0)


def hex_to_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def grade(rgb, rule):
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in rgb])
    if rule["hue"] is not None and rule["pull"] > 0:
        # 색상환에서 짧은 쪽으로 돈다
        d = (rule["hue"] - h + 0.5) % 1.0 - 0.5
        h = (h + d * rule["pull"]) % 1.0
    l = min(1.0, max(0.0, l * rule["lmul"]))
    s = min(1.0, max(0.0, s * rule["smul"]))
    return tuple(int(round(v * 255)) for v in colorsys.hls_to_rgb(h, l, s))


def indexed(im, order):
    """RGB 이미지를 (P 모드 이미지, 색 순서) 로. 인덱스는 이후 바뀌지 않는다."""
    lookup = {c: i for i, c in enumerate(order)}
    p = Image.new("P", im.size)
    p.putdata([lookup[c] for c in im.getdata()])
    return p


def palette_bytes(colors):
    flat = [v for c in colors for v in c]
    # 남는 슬롯은 마지막 색으로 채운다. 0 으로 두면 PIL 이 검정을 쓸 수 있는
    # 색으로 보고 칠해 버린다 — 실제로 그 버그로 화면의 3.0% 가 검어졌다.
    last = colors[-1] if colors else (0, 0, 0)
    while len(flat) < 768:
        flat.extend(last)
    return flat[:768]


def load_ramps(path):
    ramps = json.loads(Path(path).read_text(encoding="utf-8"))
    role = {}
    for name, hexes in ramps.items():
        for h in hexes:
            role[hex_to_rgb(h)] = name
    return ramps, role


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-r", "--ramps", default="ramps.json")
    ap.add_argument("-o", "--out", default="out")
    ap.add_argument("--prefix", help="출력 파일 접두사 (기본: 입력 파일명)")
    a = ap.parse_args()

    src = Path(a.image)
    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    prefix = a.prefix or src.stem

    im = Image.open(src).convert("RGB")
    _, role = load_ramps(a.ramps)

    order = sorted(set(im.getdata()))
    missing = [c for c in order if c not in role]
    if missing:
        print(f"!! 역할이 없는 색 {len(missing)}개: "
              + " ".join("#%02X%02X%02X" % c for c in missing[:8]))
        print(f"   assign_ramps.py 로 {a.ramps} 를 다시 만들 것")
        return 1

    # 픽셀을 만지는 것은 여기 한 번뿐이다
    p = indexed(im, order)
    print(f"{src.name}  {len(order)}색  인덱스 1회 생성")

    for phase in PHASE_ORDER:
        rules = PHASES[phase]
        graded = [grade(c, rules.get(role[c], IDENTITY)) for c in order]
        p.putpalette(palette_bytes(graded))
        dst = outdir / f"{prefix}_{phase}.png"
        p.convert("RGB").save(dst)
        print(f"  {phase:<6} -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
