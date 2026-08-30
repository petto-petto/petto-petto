#!/usr/bin/env python3
"""단계 간 델타 검사 — "이 진화가 실제로 진화인가"를 숫자로 확인한다.

한 장짜리 검사(grid.py, palette.py)는 스프라이트 하나만 본다. 그런데 '화려함'은
관계 속성이라, 옆 단계와 비교해야만 존재한다. 같은 그림을 조금 키우기만 해도
단일 검사는 전부 통과하고, 도감 진화 트랙에서만 밋밋하게 드러난다. 이 스크립트가
그 구멍을 막는다.

Usage:
    python3 progression.py s1.txt s2.txt s3.txt --grade rare
    python3 progression.py s1.txt s2.txt --grade common --width 32 --height 32

검사 항목 (기준값은 budget.py)
    채운 픽셀 증가율   이전 단계 대비 최소 +25%
    실루엣 IoU         bbox 정렬 후 겹침. S2 <= 0.65, S3 <= 0.55
    색 수 증가         단계마다 최소 +1

IoU 가 핵심이다. 면적만 보면 "같은 그림을 확대"가 통과하는데, IoU 는 그걸 정확히
0.9 근처로 잡아낸다. 통과하려면 실루엣 자체를 다시 짜야 한다.

**다만 IoU 를 떨어뜨리는 수단에는 금지된 것이 하나 있다.**

    허용  새 부위를 실루엣 밖에 달기(꼬리·뿔·날개·갈기), 자세 변경,
          특징부 확대, 다리 수·길이 변경, 좌우 비대칭 도입
    금지  두신 비율 반전 — 머리를 줄이고 몸통을 키우는 것

머리를 줄이면 IoU 는 확실히 떨어진다. 실제로 midnight_zebra Stage 3 가 그 방법으로
0.63 → 0.51 을 통과했고, 등신이 5.0 이 되어 말상이 됐다. 등신은 grid.py 가 상한
2.0 으로 막으므로 그 길은 이제 막혀 있다 — IoU 는 부위와 자세로 떨어뜨린다.
"""
import argparse
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import budget
import geom
from grid import load


def sprite(path, w, h):
    legend, rows = load(path, w, h)
    pts = {(x, y) for y, r in enumerate(rows)
           for x, ch in enumerate(r) if ch != "."}
    used = {ch for r in rows for ch in r if ch != "."}
    return pts, len(used)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("grids", nargs="+", help="단계 순서대로 (s1 s2 s3)")
    ap.add_argument("--grade", required=True)
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--height", type=int, default=32)
    args = ap.parse_args()
    budget.check(args.grade)

    if len(args.grids) < 2:
        raise SystemExit("단계 간 검사이므로 그리드가 2개 이상 필요하다")

    data = [sprite(p, args.width, args.height) for p in args.grids]
    fails = []
    print(f"      단계        면적    색수   증가율   IoU")
    prev = None
    for i, (pts, ncol) in enumerate(data, start=1):
        if prev is None:
            print(f"      S{i}       {len(pts):5}   {ncol:4}       —      —")
        else:
            grow = len(pts) / len(prev[0]) - 1
            ov = geom.iou(prev[0], pts)
            gain = ncol - prev[1]
            cap = budget.MAX_SILHOUETTE_IOU.get(i, 0.55)
            print(f"      S{i}       {len(pts):5}   {ncol:4}   {grow:+6.0%}   {ov:.2f}")
            if grow < budget.MIN_AREA_GROWTH:
                fails.append(f"S{i-1}→S{i} 면적 증가 {grow:+.0%} — 최소 "
                             f"{budget.MIN_AREA_GROWTH:+.0%}. 체형을 키우거나 부위를 더할 것")
            if ov > cap:
                fails.append(f"S{i-1}→S{i} 실루엣 IoU {ov:.2f} — 상한 {cap:.2f}. "
                             f"정렬해 겹치면 {ov:.0%}가 같은 그림이다. 크기만 키운 진화라는 뜻이니 "
                             f"실루엣을 다시 짤 것 — 새 부위를 실루엣 밖에 달거나(꼬리·뿔·날개), "
                             f"자세를 틀거나, 특징부를 과장한다. "
                             f"**머리를 줄여 IoU 를 떨어뜨리지 말 것** (grid.py 등신 상한에서 막힌다)")
            if gain < budget.MIN_COLOR_GAIN:
                fails.append(f"S{i-1}→S{i} 색 수 {gain:+d} — 단계마다 최소 "
                             f"+{budget.MIN_COLOR_GAIN}. 등급 상한 안에서 무늬색이나 발광 포인트를 추가할 것")
        prev = (pts, ncol)
    print()
    for f in fails:
        print("FAIL  " + f)
    if fails:
        print("\nRESULT: FAIL — 그리드를 고치고 다시. **통과 전에는 export 하지 않는다**")
        sys.exit(1)
    print("RESULT: PASS — 단계 간 차이가 충분하다")


if __name__ == "__main__":
    main()
