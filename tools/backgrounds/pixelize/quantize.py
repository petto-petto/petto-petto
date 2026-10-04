#!/usr/bin/env python3
"""생성 이미지를 게임 캔버스 크기의 도트로 내린다 — 팔레트는 **장면마다** 뽑는다.

## 공용 팔레트로 하면 안 되는 이유

`bg_005` 의 36색을 16장 전부에 강제했더니 노을 넉 장이 갈색 흙탕물이 되고 밤이
녹색으로 물들었다. 그 팔레트는 여름 낮 녹색 숲에서 뽑은 것이라 **노을 주황도
밤 남색도 아예 없다.** 없는 색으로는 근사할 수 없다.

배경끼리 팔레트를 공유해야 할 이유도 사실 없다. 펫은 자기 스프라이트와 자기
팔레트를 갖고, `design.md` 가 요구하는 것은 공용 외곽선 `#2C2438` 과 좌상단
광원이지 같은 팔레트가 아니다. 그래서 장면마다 그 장면에 맞는 팔레트를 뽑는다.

## 축소 방식을 고르지 않고 둘 다 굽는다

생성본은 픽셀아트처럼 보이지만 격자가 화면 픽셀에 정렬돼 있지 않다(블록 gcd=1).
1774x887 -> 1080x540 은 1.64배라 정수배도 아니다. 어떤 리샘플이 나은지는 눈으로
봐야 알기 때문에 `box` 와 `lanczos` 를 둘 다 만들어 비교한다.

    box       면적 평균. 색이 뭉개지지만 노이즈가 준다
    lanczos   선명하지만 링잉이 생겨 색 수가 늘 수 있다

사용:
    python3 quantize.py in/spring_day.png -o out/q --colors 32
    python3 quantize.py "in/*.png" -o out/q --colors 32 --method box
"""

import argparse
import glob
from pathlib import Path

from PIL import Image

CANVAS = (960, 360)   # 펫룸 장면 규격. windows.ts 의 SCENE_WIDTH/ROOM_HEIGHT
OUTLINE = (0x2C, 0x24, 0x38)   # design.md 공용 외곽선

METHODS = {
    "box": Image.BOX,
    "lanczos": Image.LANCZOS,
    "nearest": Image.NEAREST,
}


def to_canvas(im, size, method, anchor=1.0):
    """캔버스 비율로 크롭한 뒤 줄인다.

    `anchor` 는 세로로 어디를 남길지다. 0.0 이면 위, 1.0 이면 아래.
    **기본이 1.0(아래)인 이유**: 지면은 화면 아래에 있고 펫이 거기 선다.
    센터 크롭하면 잔디가 잘려나가 펫이 설 자리가 없어진다 — 실제로 960x360
    으로 줄일 때 센터 크롭은 지면을 화면 밖으로 밀어냈다.
    """
    w, h = im.size
    want_h = w * size[1] // size[0]
    if want_h <= h:
        top = int((h - want_h) * anchor)
        im = im.crop((0, top, w, top + want_h))
    else:
        want_w = h * size[0] // size[1]
        left = (w - want_w) // 2
        im = im.crop((left, 0, left + want_w, h))
    return im.resize(size, METHODS[method])


def quantize(im, colors):
    """이 장면에서 팔레트를 뽑아 양자화한다.

    MEDIANCUT 은 면적이 넓은 색에 팔레트를 많이 배정한다 — 하늘이 큰 노을
    장면이면 노을 색조가 여러 단 들어온다. 공용 팔레트를 쓸 때 잃었던 것이
    바로 그것이다.
    """
    q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return q.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pattern", help="입력 파일 또는 glob 패턴")
    ap.add_argument("-o", "--out", default="out/q")
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--method", default="box", choices=list(METHODS))
    ap.add_argument("--width", type=int, default=CANVAS[0])
    ap.add_argument("--height", type=int, default=CANVAS[1])
    ap.add_argument("--anchor", type=float, default=1.0,
                    help="세로 크롭 위치 0.0=위 1.0=아래(기본). 지면을 살리려면 아래")
    a = ap.parse_args()

    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    size = (a.width, a.height)

    files = sorted(glob.glob(a.pattern))
    if not files:
        print(f"입력 없음: {a.pattern}")
        return 1

    print(f"{len(files)}장  ->  {size[0]}x{size[1]}  {a.colors}색  "
          f"({a.method}, anchor {a.anchor})")
    for f in files:
        src = Path(f)
        im = Image.open(src).convert("RGB")
        small = to_canvas(im, size, a.method, a.anchor)
        out = quantize(small, a.colors)
        dst = outdir / src.name
        out.save(dst)
        used = len(set(out.getdata()))
        print(f"  {src.name:<22} {used:>3}색  -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
