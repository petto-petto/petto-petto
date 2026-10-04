#!/usr/bin/env python3
"""픽셀화된 배경의 색마다 **역할(램프)** 을 배정한다 — 초안은 기계, 확정은 사람.

## 왜 필요한가

시간대 변환은 색을 명도로만 다뤄서는 안 된다. 하늘의 밝은 시안과 잎사귀의
밝은 녹색은 둘 다 '밝은 색'이지만 노을에서는 반대로 가야 한다 — 하늘은 주황으로
물들고 잎은 역광 실루엣이 된다. 그래서 색마다 역할을 먼저 정해야 한다.

프리미티브 렌더러는 `presets.json` 의 램프를 알고 칠하므로 이 정보를 처음부터
갖는다. 픽셀화된 이미지는 그렇지 않아서, 한 번 되찾아 줘야 한다.

## 무엇으로 가르는가

    색상(H)         하늘/안개는 시안, 잎은 녹색, 줄기는 갈색, 빛은 노랑
    평균 수직위치    같은 밝기라도 화면 위에 있으면 하늘, 아래면 지면
    채도            안개는 하늘과 색상이 겹치지만 채도가 낮다

경계에 걸린 색은 반드시 생긴다. 그래서 이 스크립트는 **초안만** 내고, 확신이
낮은 색에 `?` 를 붙여 사람이 보게 한다. 램프 하나가 틀리면 그 색이 시간대마다
엉뚱하게 움직이므로(잎이 하늘 규칙을 받으면 노을에 하늘색 잎이 된다) 확인이 싸다.

Pillow 만 쓴다 — `background-generator` 스크립트들과 같은 전제다.

사용:
    python3 assign_ramps.py <이미지> [-o ramps.json]
"""

import argparse
import colorsys
import json

from PIL import Image

# 이 프로젝트의 숲 배경 기준이다. 실내나 사막 배경이면 다시 잡아야 한다.
HUE_BANDS = [
    ("sky",     (180, 250)),   # 시안~하늘색
    ("foliage", (100, 180)),   # 녹색~청록
    ("light",   (35, 70)),     # 노랑~금색
    ("wood",    (0, 35)),      # 갈색~적갈색
]
MIST_MAX_SAT = 0.42      # 하늘·잎과 색상이 겹쳐도 채도가 낮으면 안개
MIST_MIN_LUM = 0.60      # 그리고 밝아야 한다. 어두운 저채도는 그림자다
SKY_MAX_Y = 0.55         # 주로 화면 이 아래에 있으면 하늘로 보지 않는다
CONFIDENT = 0.70


def classify(rgb, mean_y):
    """(램프, 확신도 0~1, 근거)."""
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in rgb])
    deg = h * 360

    if s <= MIST_MAX_SAT and l >= MIST_MIN_LUM:
        # 안개는 위쪽·중간에 깔린다. 아래쪽에 주로 있으면 채도가 낮아도
        # 밝은 잎일 가능성이 높다 — 실제로 #7BC6AE(S0.40)가 그랬다.
        if mean_y > SKY_MAX_Y:
            return "mist", 0.45, (f"저채도(S{s:.2f})지만 평균y {mean_y:.2f} 로 "
                                  "아래쪽 — foliage 일 수 있다")
        return "mist", 0.75, f"저채도(S{s:.2f}) + 밝음(L{l:.2f})"

    for name, (lo, hi) in HUE_BANDS:
        if not lo <= deg < hi:
            continue
        conf, why = 0.85, f"H{deg:.0f}"
        if name == "sky" and mean_y > SKY_MAX_Y:
            conf, why = 0.45, f"H{deg:.0f} 인데 평균y {mean_y:.2f} 로 아래쪽"
        elif name == "light" and l < 0.55:
            conf, why = 0.50, f"H{deg:.0f} 인데 어두움(L{l:.2f}) — wood 일 수 있다"
        elif min(deg - lo, hi - deg) < 5:
            conf, why = 0.55, f"H{deg:.0f} (대역 경계)"
        return name, conf, why

    return "wood", 0.30, f"H{deg:.0f} 어느 대역에도 안 듦"


def profile(im):
    """색마다 (면적비, 평균 수직위치)."""
    W, H = im.size
    px = im.load()
    acc = {}
    for y in range(H):
        for x in range(W):
            c = px[x, y]
            n, sy = acc.get(c, (0, 0))
            acc[c] = (n + 1, sy + y)
    return {c: (n / (W * H), sy / n / H) for c, (n, sy) in acc.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--out", default="ramps.json")
    a = ap.parse_args()

    im = Image.open(a.image).convert("RGB")
    stats = profile(im)

    rows = []
    for c, (area, mean_y) in stats.items():
        ramp, conf, why = classify(c, mean_y)
        _, l, _ = colorsys.rgb_to_hls(*[v / 255 for v in c])
        rows.append(dict(hex="#%02X%02X%02X" % c, ramp=ramp, conf=conf,
                         why=why, area=area, lum=l))
    rows.sort(key=lambda r: -r["area"])

    print(f"{'hex':<9}{'램프':<9}{'면적':>7}{'확신':>7}  근거")
    print("-" * 68)
    review = [r for r in rows if r["conf"] < CONFIDENT]
    for r in rows:
        mark = "?" if r["conf"] < CONFIDENT else " "
        print(f'{r["hex"]:<9}{r["ramp"]:<9}{r["area"]*100:6.2f}% '
              f'{r["conf"]:6.2f}{mark} {r["why"]}')

    # 램프 안에서는 명도 오름차순. 변환 규칙이 '이 램프의 몇 단'을 전제한다.
    ramps = {}
    for r in sorted(rows, key=lambda r: r["lum"]):
        ramps.setdefault(r["ramp"], []).append(r["hex"])

    print()
    for name, hexes in ramps.items():
        print(f"  {name:<9} {len(hexes):>2}색  {' '.join(hexes)}")
    if review:
        print(f"\n확인 필요 {len(review)}색: "
              + " ".join(r["hex"] for r in review))
        print(f"  {a.out} 을 열어 직접 고칠 것 — 램프가 틀리면 그 색이 "
              "시간대마다 엉뚱하게 움직인다.")

    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(ramps, f, indent=2, ensure_ascii=False)
    print(f"\n저장 -> {a.out}")


if __name__ == "__main__":
    main()
