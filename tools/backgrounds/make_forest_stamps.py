#!/usr/bin/env python3
"""동화 숲(bg_005/bg_006)이 쓰는 스탬프를 생성한다.

손으로 ASCII 를 찍으면 광원 일관성(좌상단)과 3톤 규칙이 행마다 어긋난다. 그래서
형태는 타원·사인식으로, 명암은 법선으로 계산해 찍는다. 스킬의 스탬프 규약대로
legend 값은 리터럴 hex 가 아니라 **램프 참조**다 — 프리셋만 바꿔도 같은 형태가
다른 색으로 구워진다.

이름 규칙에 주의한다. `bg_check.py` 는 `<원본>_*` 이면서 최대변이 1.5배 이상인
스탬프를 '고해상도 변형'으로 보고 원본을 scale 3 이상으로 쓰면 실패시킨다.
그래서 꽃 덩굴은 `vine_*` 가 아니라 `bloom_vine`, 나무는 `tree_pine_*` 가 아니라
`conifer_tall` / `broadleaf_round` 다.

사용:
    python3 tools/backgrounds/make_forest_stamps.py [--out <stamps/outdoor 경로>]
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

DEFAULT_OUT = Path(".claude/skills/background-generator/stamps/outdoor")
MIRROR_OUT = Path(".agents/skills/background-generator/stamps/outdoor")

# 광원은 좌상단 고정 — 캐릭터 스킬과 공유하는 전제다.
LIGHT = (-0.62, -0.78)


def _shade(nx: float, ny: float, lit: str, body: str, dark: str) -> str:
    t = LIGHT[0] * nx + LIGHT[1] * ny
    if t > 0.40:
        return lit
    if t > -0.16:
        return body
    return dark


def _lobe(g, cx, cy, r, lit, body, dark, edge=None):
    """둥근 덩어리 하나를 반경 법선으로 칠한다.

    대각선으로 톤을 자르면 '색을 덧칠한 도형'으로 읽힌다. 로브마다 자기 중심에서
    바깥으로 나가는 법선을 광원에 대야 둥글게 보인다. 뒤 로브부터 그리고 앞
    로브가 덮으면 겹친 수관이 된다.
    """
    h, w = len(g), len(g[0])
    ri = int(math.ceil(r))
    for y in range(int(cy) - ri, int(cy) + ri + 1):
        for x in range(int(cx) - ri, int(cx) + ri + 1):
            if not (0 <= x < w and 0 <= y < h):
                continue
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy) / r
            if d > 1.0:
                continue
            if edge and d > 0.86 and (LIGHT[0] * dx + LIGHT[1] * dy) / r < -0.10:
                g[y][x] = edge          # 아래·오른쪽 테두리만 한 단 더 어둡게
            else:
                g[y][x] = _shade(dx / r, dy / r, lit, body, dark)


def _trunk(g, cx, y0, y1, half, light, dark):
    h, w = len(g), len(g[0])
    for y in range(y0, min(y1, h)):
        for x in range(int(cx - half), int(cx + half) + 1):
            if 0 <= x < w:
                g[y][x] = light if x < cx else dark


def _grid(w: int, h: int) -> list[list[str]]:
    return [["." for _ in range(w)] for _ in range(h)]


def mushroom_giant(size: int = 32) -> str:
    """대형 버섯 — 44x44, scale 1 로 쓴다.

    비율은 요청대로 갓 : 몸통 = 1:1(22행씩), 폭 : 높이 = 1:1. 갓은 반원보다 살짝
    부풀려 동글게. 반점은 작게 찍고 아래쪽에 한 단 어두운 테를 둘러 '구멍'이 아니라
    도톰하게 솟은 무늬로 읽히게 한다.
    """
    w = h = size
    cap_h = size // 2
    cx = rx = size / 2.0
    ry, cy = size * 0.545, size * 0.523
    g = _grid(w, h)

    for y in range(cap_h):
        k = (cy - y) / ry
        if k >= 1.0:
            continue
        hw = rx * math.sqrt(1.0 - k * k)
        for x in range(w):
            dx = x + 0.5 - cx
            if abs(dx) > hw:
                continue
            g[y][x] = _shade(dx / rx, -(cy - y) / ry, "C", "c", "d")

    # 반점 — 작게, 아래에 그늘 테를 둔다. 크면 갓에 구멍이 뚫린 것처럼 보인다.
    k = size / 44.0
    for fx, fy, fr in ((13, 7, 2), (26, 5, 2), (19, 13, 2), (33, 11, 1),
                       (7, 12, 1), (30, 17, 1), (10, 18, 1)):
        sx, sy, sr = round(fx * k), round(fy * k), max(1, round(fr * k))
        for y in range(sy - sr - 1, sy + sr + 2):
            for x in range(sx - sr - 1, sx + sr + 2):
                if not (0 <= x < w and 0 <= y < h) or g[y][x] == ".":
                    continue
                d = math.hypot(x - sx, y - sy)
                if d <= sr:
                    g[y][x] = "o"
                elif d <= sr + 1 and (y - sy) + (x - sx) > 0:
                    g[y][x] = "d"

    for x in range(w):                      # 갓 밑면(주름)
        if g[cap_h - 1][x] != ".":
            g[cap_h - 1][x] = "g"

    top, bot = cap_h, h - 1                 # 기둥 — 갓과 같은 22행
    for y in range(top, bot + 1):
        t = (y - top) / (bot - top)
        # 사인으로 휘게 하면 1px 단위에서 계단 자국이 남는다. 폭만 부드럽게 벌린다.
        hw = (5.2 + 3.4 * t * t) * k
        left, right = cx - hw, cx + hw
        for x in range(w):
            px = x + 0.5
            if left <= px <= right:
                u = (px - left) / max(right - left, 1e-6)
                g[y][x] = "h" if u < 0.34 else ("s" if u > 0.80 else "w")
    for x in range(w):                      # 갓이 기둥에 지는 그림자
        if g[top][x] in ("h", "w", "s"):
            g[top][x] = "s"

    return _render({"C": "accent.3", "c": "accent.2", "d": "accent.1", "o": "light.3",
                    "g": "wood.1", "h": "wood.4", "w": "wood.3", "s": "wood.2"}, g)

def conifer_tall() -> str:
    """침엽수 — 30x56. 층마다 둥근 로브를 늘어놓아 밑변이 가리비처럼 파이게 한다.

    삼각형을 대각선으로 잘라 톤을 나누면 '색칠한 삼각형'이지 나무가 아니다.
    """
    w, h = 30, 56
    cx = 15.0
    g = _grid(w, h)
    tiers = ((10.0, 4.6, 3), (19.0, 6.4, 4), (28.0, 8.0, 5), (37.0, 9.4, 5), (45.0, 10.6, 6))
    for cy, span, n in tiers:                       # 뒤(위) 층부터 그린다
        r = span * 0.72
        for i in range(n):
            t = -1.0 + 2.0 * i / max(1, n - 1)
            lx = cx + t * span
            ly = cy + abs(t) * 1.8                  # 바깥으로 갈수록 처진다
            _lobe(g, lx, ly, r, "L", "M", "S", edge="S")
        _lobe(g, cx, cy - span * 0.30, r * 1.15, "L", "M", "S")   # 층 중앙 봉우리

    _trunk(g, cx, 48, h, 2, "b", "k")
    return _render({"L": "leaf.4", "M": "leaf.2", "S": "leaf.1",
                    "b": "wood.3", "k": "wood.1"}, g)

def broadleaf_round() -> str:
    """둥근 활엽수 — 38x50. 수관을 둥근 로브 여덟 덩어리로 쌓는다."""
    w, h = 38, 50
    cx = 19.0
    g = _grid(w, h)
    # (x, y, r) — 뒤쪽·아래쪽 로브부터. 앞 로브가 덮어 겹침이 생긴다.
    lobes = ((19.0, 22.0, 12.5), (8.5, 20.0, 9.0), (29.5, 21.0, 9.0),
             (13.0, 10.0, 8.5), (26.0, 11.0, 8.0), (19.5, 6.5, 7.5),
             (11.0, 27.0, 8.0), (27.0, 28.0, 7.5), (19.0, 30.0, 7.0))
    for lx, ly, r in lobes:
        _lobe(g, lx, ly, r, "L", "M", "S", edge="S")
    _trunk(g, cx, 34, h, 2, "b", "k")
    return _render({"L": "leaf.4", "M": "leaf.2", "S": "leaf.1",
                    "b": "wood.3", "k": "wood.1"}, g)

def bloom_vine() -> str:
    """노란 꽃이 핀 늘어진 덩굴 — 11x34."""
    w, h = 11, 34
    g = _grid(w, h)
    cx = 5
    stem_x = []
    for y in range(h):
        x = cx + round(1.9 * math.sin(y / 4.4))
        stem_x.append(x)
        g[y][x] = "l" if y % 5 == 0 else "v"
    for y in range(3, h - 2, 4):
        side = 1 if stem_x[y] >= cx else -1
        for d in (1, 2):
            x = stem_x[y] + side * d
            if 0 <= x < w:
                g[y][x] = "l" if d == 1 else "v"
    for fy in (8, 19, 29):
        side = -1 if stem_x[fy] >= cx else 1
        fx = stem_x[fy] + side * 2
        if not (1 <= fx < w - 1):
            fx = cx
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            x, y = fx + dx, fy + dy
            if 0 <= x < w and 0 <= y < h:
                g[y][x] = "p"
        g[fy][fx] = "P"
    return _render({"v": "leaf.1", "l": "leaf.3", "p": "accent.4", "P": "light.4"}, g)


def _render(legend: dict[str, str], grid: list[list[str]]) -> str:
    lines = ["[legend]"] + [f"{k} = {v}" for k, v in legend.items()] + ["[grid]"]
    lines += ["".join(row).rstrip(".") or "." for row in grid]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    stamps = {"mushroom_giant": mushroom_giant(), "bloom_vine": bloom_vine(),
              "conifer_tall": conifer_tall(), "broadleaf_round": broadleaf_round()}
    for target in ([args.out] if args.out else [DEFAULT_OUT, MIRROR_OUT]):
        if not target.exists():
            print(f"# 건너뜀 (없는 경로): {target}")
            continue
        for name, text in stamps.items():
            (target / f"{name}.txt").write_text(text, encoding="utf-8")
            rows = text.split("[grid]\n")[1].splitlines()
            print(f"# {target/(name+'.txt')}  {max(len(r) for r in rows)}x{len(rows)}")


if __name__ == "__main__":
    main()
