#!/usr/bin/env python3
"""생성된 이미지가 도트 규격에 얼마나 가까운지 잰다.

모델이나 프롬프트를 바꿔 시험할 때, 눈으로 "픽셀아트 같다"고 판단하면 틀린다.
`dream_forest_ref.jpg` 는 눈으로는 도트인데 실제로는 40,113색에 중간톤 77.7%
였다. 그래서 숫자로 본다.

## 판정 기준

    색 수        도트는 보통 16~64. 수천이면 팔레트라는 게 없는 것이다.
    중간톤       상위 32색에 안 드는 픽셀의 비율. 안티앨리어싱의 흔적이다.
    고립픽셀     8이웃이 모두 다른 색인 픽셀. 노이즈의 지표.
    블록 크기    도트 한 칸이 화면 몇 px 인가. 2 이상이면 업스케일된 것이다.

**런 길이는 재지 않는다.** 1픽셀이 1도트인 네이티브 해상도에서는 같은 색이
한 칸만 이어지는 것이 정상이라, 이 지표로는 진짜 도트(`bg_005`)도 탈락한다.
실제로 그렇게 오판한 적이 있다.

사용:
    python3 check_dots.py <이미지> [<이미지> ...]
"""

import sys
from collections import Counter
from math import gcd

from PIL import Image

GOOD_COLORS = (16, 64)
MIDTONE_MAX = 0.10
ISOLATED_MAX = 0.06
TOP_N = 32


def block_size(px, W, H):
    """도트 한 칸이 화면 몇 px 인지 추정.

    색이 바뀌는 x 좌표들의 최대공약수를 본다. 2배로 업스케일된 이미지면
    경계가 전부 짝수 좌표에 온다.
    """
    g = 0
    for y in range(0, H, max(1, H // 60)):
        for x in range(1, W):
            if px[x, y] != px[x - 1, y]:
                g = gcd(g, x)
                if g == 1:
                    return 1
    return g or 1


def isolated_ratio(px, W, H):
    n = 0
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            c = px[x, y]
            if all(px[x + dx, y + dy] != c
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy):
                n += 1
    return n / (W * H)


def report(path):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    counts = Counter(px[x, y] for y in range(H) for x in range(W))
    N = W * H

    ncol = len(counts)
    top = set(k for k, _ in counts.most_common(TOP_N))
    mid = sum(n for k, n in counts.items() if k not in top) / N
    iso = isolated_ratio(px, W, H)
    blk = block_size(px, W, H)

    print(f"\n{path}  {W}x{H}")
    def line(label, val, ok, detail=""):
        print(f"  [{'ok  ' if ok else 'FAIL'}] {label:<22} {val:<14} {detail}")

    line("색 수", f"{ncol:,}", GOOD_COLORS[0] <= ncol <= GOOD_COLORS[1],
         f"(도트 기준 {GOOD_COLORS[0]}~{GOOD_COLORS[1]})")
    line("중간톤", f"{mid*100:.1f}%", mid <= MIDTONE_MAX,
         f"(<= {MIDTONE_MAX*100:.0f}%, 상위 {TOP_N}색 밖)")
    line("고립픽셀", f"{iso*100:.1f}%", iso <= ISOLATED_MAX,
         f"(<= {ISOLATED_MAX*100:.0f}%)")
    line("블록 크기", f"{blk}px", blk == 1,
         "(1이면 네이티브, 2 이상은 업스케일본)")

    fails = sum([not (GOOD_COLORS[0] <= ncol <= GOOD_COLORS[1]),
                 mid > MIDTONE_MAX, iso > ISOLATED_MAX, blk != 1])
    if fails == 0:
        print("  => 도트 규격. 팔레트 고정만 하면 된다.")
    elif ncol > 1000:
        print(f"  => 생성 이미지 그대로다. repalette.py 로 팔레트를 고정해야 한다.")
    else:
        print(f"  => {fails}개 항목 미달. 팔레트 고정 단계에서 보정된다.")
    return fails


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    print("비교용 실측값")
    print("  bg_005 (프리미티브)     36색 / 중간톤 4.4% / 고립 2.9% / 1px")
    print("  dream_forest_ref.jpg  40,113색 / 중간톤 77.7% / 고립 25.7%")
    print("  G_clean6 (픽셀화 후)    22색 / 중간톤 0.0% / 고립 1.3% / 1px")
    for p in sys.argv[1:]:
        report(p)


if __name__ == "__main__":
    main()
