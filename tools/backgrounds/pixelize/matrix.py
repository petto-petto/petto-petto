#!/usr/bin/env python3
"""계절 원본들을 훑어 계절 x 시간대 전체를 굽는다.

## 왜 계절은 원본이 따로 필요한가

시간대는 색만 바뀐다 — 같은 나무가 노을빛을 받을 뿐이다. 그래서 팔레트 변환으로
파생된다. 계절은 **구조가 바뀐다.** 겨울에는 잎이 떨어지고 가지가 드러난다.

색 변환으로 잎을 지우는 것은 시도했고 실패했다. 잎인 픽셀은 역할 배정 덕분에
정확히 골라낼 수 있지만, **잎 뒤에 가지가 그려져 있지 않다.** 원본이 잎 달린
상태로 만들어졌으니 지우면 그 자리는 구멍이다. 없는 정보는 지우기로 만들 수
없다.

그래서 계절은 원본을 각각 준비하고(`control/` 의 구조 조건으로 구도를 맞춘다),
시간대만 여기서 파생한다. 입력 N장 -> 출력 N x 4 장.

## 입력 규약

    in/spring.png  in/summer.png  in/autumn.png  in/winter.png
    ramps/spring.json  ...        (없으면 ramps.json 공용)

계절마다 색이 다르므로 램프 배정도 계절마다 필요하다. `assign_ramps.py` 로
초안을 내고 확인 표시된 색만 손보면 된다.

사용:
    python3 matrix.py [--in in] [--out out] [--ramps-dir ramps]
"""

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEASON_ORDER = ["spring", "summer", "autumn", "winter"]


def ramps_for(season, ramps_dir, fallback):
    p = ramps_dir / f"{season}.json"
    return p if p.exists() else fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", default="in")
    ap.add_argument("--out", default="out")
    ap.add_argument("--ramps-dir", default="ramps")
    ap.add_argument("--ramps", default="ramps.json",
                    help="계절별 파일이 없을 때 쓸 공용 배정")
    a = ap.parse_args()

    indir, outdir = Path(a.indir), Path(a.out)
    ramps_dir, fallback = Path(a.ramps_dir), Path(a.ramps)
    outdir.mkdir(parents=True, exist_ok=True)

    found = [s for s in SEASON_ORDER if (indir / f"{s}.png").exists()]
    if not found:
        print(f"{indir}/ 에 계절 원본이 없다. "
              f"{'  '.join(s + '.png' for s in SEASON_ORDER)} 중 하나 이상 필요.")
        print("구도를 맞추려면 control/canny.png 를 조건으로 생성할 것 "
              "— README.md 참조.")
        return 1

    missing = [s for s in SEASON_ORDER if s not in found]
    if missing:
        print(f"없는 계절: {', '.join(missing)} — 있는 것만 굽는다\n")

    total = 0
    for season in found:
        rp = ramps_for(season, ramps_dir, fallback)
        if not rp.exists():
            print(f"!! {season}: 램프 배정이 없다 ({rp}). "
                  f"assign_ramps.py {indir}/{season}.png -o {rp}")
            continue
        rc = subprocess.run(
            [sys.executable, str(HERE / "phase_grade.py"),
             str(indir / f"{season}.png"), "-r", str(rp),
             "-o", str(outdir), "--prefix", season],
            check=False).returncode
        if rc:
            print(f"!! {season} 실패")
            continue
        total += 4

    print(f"\n{len(found)}계절 x 4시간대 = {total}장 -> {outdir}/")
    return 0 if total else 1


if __name__ == "__main__":
    raise SystemExit(main())
