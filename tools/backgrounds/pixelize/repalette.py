#!/usr/bin/env python3
"""픽셀화 결과를 게임 팔레트로 옮기고, 도트답게 다듬는다.

앞선 변형(C)에서 나무 실루엣이 보라로 튄 원인은 셋이었고 전부 여기서 고친다.

1. **팔레트에 없는 검정이 섞였다.** `putpalette` 에 36색만 주고 남은 슬롯을
   0 으로 채웠더니 PIL 이 그 검정(#000000)을 쓸 수 있는 색으로 보고 3.0% 를
   칠했다. 남는 슬롯은 마지막 색으로 채운다.

2. **RGB 거리로 매핑했다.** 사람 눈은 RGB 유클리드 거리대로 색을 보지 않는다.
   OKLab 으로 옮겨서 재면 어두운 자주가 보라가 아니라 어두운 갈색으로 간다.

3. **accent 를 매핑 후보에 뒀다.** `#5B1A6E` `#9A2280` `#D6395C` `#F2703C` 는
   버섯·꽃 같은 소품에만 쓰라고 만든 색이다. 넓은 면이 그리로 가면 화면이
   물든다. `--no-accent` 로 후보에서 뺀다.

그리고 "AI 가 만든 느낌"의 실체 하나를 더 다룬다 — **정리되지 않은 클러스터**.
찍은 도트는 같은 색이 덩어리로 뭉쳐 있고 경계가 규칙적인데, 축소된 그림은
경계에 한두 칸짜리 돌기가 남는다. `--clean N` 은 N 픽셀 미만의 연결 성분을
이웃 최빈색으로 흡수한다.

    python3 repalette.py <입력> <출력> [--no-accent] [--clean 6] [--dither]
"""

import argparse
import json
from collections import Counter, deque

import numpy as np
from PIL import Image

BG005 = ("/Users/sowonpark/Documents/Projects/petto-petto/apps/desktop/renderer"
         "/assets/backgrounds/bg_005_dream_forest_day/bg_005.json")

# 소품 전용 색. 넓은 면이 여기로 가면 안 된다.
ACCENT = {"#5B1A6E", "#9A2280", "#D6395C", "#F2703C", "#FFC94A"}


def load_palette(no_accent):
    meta = json.loads(open(BG005).read())
    hexes = meta["palette"]["colors"]
    if no_accent:
        hexes = [h for h in hexes if h.upper() not in ACCENT]
    return np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in hexes],
                    dtype=np.float64), hexes


def srgb_to_oklab(rgb):
    """0-255 sRGB -> OKLab. 지각 균등 공간이라 '눈에 비슷한 색'이 가깝게 온다."""
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ], axis=-1)


BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6],
                   [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float64) / 16 - 0.5


def map_to_palette(arr, pal, dither=0.0):
    """각 픽셀을 OKLab 거리가 가장 가까운 팔레트 색으로.

    `dither` 가 0 보다 크면 매핑 전에 Bayer 4x4 만큼 밝기를 흔든다. 팔레트에
    중간 단계가 없는 구간에서 두 색이 체커로 섞여 계조가 생긴다 — 디더는
    도트의 정통 기법이지 노이즈가 아니다. 0.0 이면 끄는 것과 같다.
    """
    src_rgb = arr.reshape(-1, 3).astype(np.float64)
    if dither > 0:
        H, W, _ = arr.shape
        tile = np.tile(BAYER4, (H // 4 + 1, W // 4 + 1))[:H, :W]
        src_rgb = np.clip(src_rgb + (tile.reshape(-1, 1) * dither * 255), 0, 255)
    src = srgb_to_oklab(src_rgb)
    ref = srgb_to_oklab(pal)
    d = ((src[:, None, :] - ref[None, :, :]) ** 2).sum(-1)
    idx = d.argmin(1)
    return pal[idx].astype(np.uint8).reshape(arr.shape)


def clean_clusters(arr, min_size):
    """min_size 미만의 연결 성분을 이웃 최빈색으로 흡수한다.

    찍은 도트와 축소된 그림을 가르는 것이 이 정리다. 경계에 남은 한두 칸짜리
    돌기를 없애면 계단이 규칙적으로 읽힌다.
    """
    H, W, _ = arr.shape
    key = (arr[..., 0].astype(np.int32) << 16 |
           arr[..., 1].astype(np.int32) << 8 | arr[..., 2].astype(np.int32))
    seen = np.zeros((H, W), bool)
    out = arr.copy()
    for y in range(H):
        for x in range(W):
            if seen[y, x]:
                continue
            k = key[y, x]
            q, cells = deque([(y, x)]), []
            seen[y, x] = True
            while q:
                cy, cx = q.popleft()
                cells.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and not seen[ny, nx] \
                            and key[ny, nx] == k:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(cells) >= min_size:
                continue
            # 성분을 둘러싼 색 중 최빈값으로 흡수
            border = Counter()
            for cy, cx in cells:
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and key[ny, nx] != k:
                        border[tuple(arr[ny, nx])] += 1
            if not border:
                continue
            fill = max(border.items(), key=lambda kv: kv[1])[0]
            for cy, cx in cells:
                out[cy, cx] = fill
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--no-accent", action="store_true")
    ap.add_argument("--clean", type=int, default=0,
                    help="이 크기 미만의 연결 성분을 흡수 (0=안 함)")
    ap.add_argument("--dither", type=float, default=0.0,
                    help="Bayer 4x4 세기 0.0~0.2. 팔레트에 중간 단계가 없는 "
                         "구간에서 두 색을 체커로 섞어 계조를 만든다")
    a = ap.parse_args()

    pal, hexes = load_palette(a.no_accent)
    im = Image.open(a.src).convert("RGB")
    arr = np.array(im)
    print(f"팔레트 {len(hexes)}색" + (" (accent 제외)" if a.no_accent else ""))

    arr = map_to_palette(arr, pal, a.dither)
    used = len(set(map(tuple, arr.reshape(-1, 3))))
    print(f"  OKLab 매핑(디더 {a.dither}) 후 실사용 {used}색")

    if a.clean:
        arr = clean_clusters(arr, a.clean)
        used = len(set(map(tuple, arr.reshape(-1, 3))))
        print(f"  클러스터 정리(<{a.clean}px) 후 {used}색")

    Image.fromarray(arr).save(a.dst)
    print(f"  저장 {a.dst}")


if __name__ == "__main__":
    main()
