#!/usr/bin/env python3
"""모션 화려함 검사(motion_check.py) — 프레임이 '평행이동'인지 '다시 그린 것'인지 구분한다.

프레임을 최적 오프셋으로 정렬한 뒤 남는 차이만 센다. 스프라이트를 통째로 1px 민
프레임은 정렬하면 0%가 되므로, 등급이 올라가도 shift 만 반복하는 모션은 이 검사에
반드시 걸린다. (초기 3종 계측: 통째로 민 idle 은 정렬 후 0~2%였다.)

프레임을 만드는 쪽은 motion_make.py 다. 만들고(make) 검사한다(check).

Usage:
    python3 motion_check.py idle_frames/*.txt --grade rare --motion idle
    python3 motion_check.py pet_002_s2_idle.png --grade rare --motion idle

.txt 를 넘기면 프레임 그리드로, .png 를 넘기면 가로 1행 스프라이트 시트로 읽는다.
PNG 경로는 Piskel 이 export 한 머신 기준이므로, 쉘이 분리된 환경에서는 그쪽
쉘에서 돌리거나 .txt 프레임으로 검사한다.
"""
import argparse
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import budget
import geom


def frames_from_grids(paths, w, h):
    from grid import load
    out = []
    for p in paths:
        legend, rows = load(p, w, h)
        out.append({(x, y): legend[ch] for y, r in enumerate(rows)
                    for x, ch in enumerate(r) if ch != "."})
    return out


def frames_from_sheet(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    n = w // h
    p = im.load()
    return [{(x, y): p[x + i * h, y][:3] for y in range(h) for x in range(h)
             if p[x + i * h, y][3] > 0} for i in range(n)]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--grade", required=True)
    ap.add_argument("--motion", required=True, choices=("idle", "click", "attack"))
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--height", type=int, default=32)
    args = ap.parse_args()
    g = budget.check(args.grade)

    if args.files[0].lower().endswith(".png"):
        frames = frames_from_sheet(args.files[0])
    else:
        frames = frames_from_grids(args.files, args.width, args.height)

    need_n = budget.FRAME_COUNT[args.motion][g]
    need_d = budget.MIN_ALIGNED_DIFF[args.motion][g]
    fails = []
    if len(frames) < need_n:
        fails.append(f"{args.motion} 프레임 {len(frames)}장 — {g} 최소 {need_n}장")

    diffs = [geom.aligned_diff(frames[i], frames[i + 1]) * 100
             for i in range(len(frames) - 1)]
    print(f"      프레임 {len(frames)}장 / 정렬 후 차이 " +
          " ".join(f"{d:.0f}%" for d in diffs))
    peak = max(diffs) if diffs else 0
    if peak < need_d:
        fails.append(
            f"정렬 후 최대 차이 {peak:.0f}% — {g} {args.motion} 기준 {need_d}%. "
            f"프레임을 통째로 밀기만 하면 이 값이 0에 가깝다. 눈 감기·귀 젖히기·"
            f"액센트 이동·부위 변형처럼 픽셀을 실제로 다시 그린 변화를 넣을 것")
    print()
    for f in fails:
        print("FAIL  " + f)
    if fails:
        print("\nRESULT: FAIL — 프레임을 고치고 다시")
        sys.exit(1)
    print("RESULT: PASS")


if __name__ == "__main__":
    main()
