#!/usr/bin/env python3
"""배경에 펫이 설 자리를 정한다 — `groundTop` · `horizon` · `petAnchor`.

## 무엇을 정하는가

    groundTop   지면이 시작되는 y. 펫의 **발끝**이 여기 닿는다
    horizon     원경이 끝나는 y. 레이어를 나눌 때와 하늘 검사에 쓴다
    petAnchor   펫 상자. 발끝(y+h)이 groundTop 과 같아야 한다

`bg_check.py` 가 이 셋을 검사한다 — `petAnchor` 가 캔버스 안에 있는지, 발끝이
`groundTop` 에 맞는지, 지면 밴드가 캔버스 높이의 최소치를 넘는지.

## groundTop 을 어떻게 찾는가

행마다 색 분포를 구하고 **위아래 행이 얼마나 다른지**를 잰다. 나무 밑동과
풀밭이 만나는 선에서 분포가 크게 바뀐다. 화면 아래 절반만 보는데, 위쪽은
수관 경계에서 더 큰 변화가 나기 때문이다.

자동 검출은 초안이다. `--overlay` 로 선을 그려 눈으로 확인할 것 — 펫이 공중에
뜨거나 땅에 묻히는 건 숫자로 안 잡히고 화면에서만 보인다.

사용:
    python3 make_meta.py out/q_codex-astra/summer_day.png --overlay
    python3 make_meta.py "out/q_codex-astra/*.png" --overlay -o out/meta
"""

import argparse
import glob
import json
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

PET = (128, 128)          # 펫 상자. bg_005 와 같다
SEARCH = (0.50, 0.95)     # groundTop 을 찾는 구간(높이 비율)
HORIZON_SEARCH = (0.20, 0.70)


def row_hist(px, W, y, step=3):
    c = Counter()
    for x in range(0, W, step):
        c[px[x, y]] += 1
    return c


def hist_distance(a, b):
    """두 행의 색 분포가 얼마나 다른가 (0~1)."""
    keys = set(a) | set(b)
    na, nb = sum(a.values()) or 1, sum(b.values()) or 1
    return sum(abs(a.get(k, 0) / na - b.get(k, 0) / nb) for k in keys) / 2


def find_break(px, W, H, lo, hi, window=4):
    """구간 안에서 위아래 분포 차가 가장 큰 y."""
    best, best_y = -1.0, int(H * (lo + hi) / 2)
    for y in range(int(H * lo), int(H * hi)):
        if y - window < 0 or y + window >= H:
            continue
        up = Counter()
        dn = Counter()
        for k in range(1, window + 1):
            up.update(row_hist(px, W, y - k))
            dn.update(row_hist(px, W, y + k))
        d = hist_distance(up, dn)
        if d > best:
            best, best_y = d, y
    return best_y, best


def analyse(path, fixed_ground=None, fixed_horizon=None, pet=64):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()

    if fixed_ground is None:
        ground, g_conf = find_break(px, W, H, *SEARCH)
    else:
        ground, g_conf = fixed_ground, 1.0
    if fixed_horizon is None:
        horizon, h_conf = find_break(px, W, H, *HORIZON_SEARCH)
    else:
        horizon, h_conf = fixed_horizon, 1.0

    pw = ph = pet
    anchor = {"x": (W - pw) // 2, "y": ground - ph, "w": pw, "h": ph}

    notes = []
    if anchor["y"] < 0:
        notes.append(f"펫 상자가 캔버스 위로 넘친다 (y={anchor['y']})")
    band = H - ground
    if band < H // 8:
        notes.append(f"지면 밴드 {band}px — 캔버스의 1/8({H//8}px) 미만")
    if horizon >= ground:
        notes.append(f"horizon({horizon})이 groundTop({ground}) 아래")

    return dict(file=Path(path).name, width=W, height=H,
                horizon=horizon, groundTop=ground, petAnchor=anchor,
                confidence=dict(ground=round(g_conf, 3), horizon=round(h_conf, 3)),
                notes=notes)


def overlay(path, meta, outdir):
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im)
    W = meta["width"]
    g, h = meta["groundTop"], meta["horizon"]
    a = meta["petAnchor"]
    d.line([(0, h), (W, h)], fill=(80, 200, 255), width=2)
    d.line([(0, g), (W, g)], fill=(255, 80, 120), width=2)
    d.rectangle([a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]],
                outline=(255, 214, 102), width=2)
    d.text((6, h + 4), f"horizon {h}", fill=(80, 200, 255))
    d.text((6, g - 14), f"groundTop {g}", fill=(255, 80, 120))
    d.text((a["x"] + 4, a["y"] + 4), "petAnchor", fill=(255, 214, 102))
    dst = outdir / f"overlay_{meta['file']}"
    im.save(dst)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pattern")
    ap.add_argument("-o", "--out", default="out/meta")
    ap.add_argument("--overlay", action="store_true")
    ap.add_argument("--ground", type=int,
                    help="groundTop 을 이 값으로 고정한다. 같은 장소의 변형들은 "
                         "지면이 하나여야 한다 — 계절이 바뀔 때 펫 발 높이가 "
                         "변하면 화면에서 튄다")
    ap.add_argument("--horizon", type=int, help="horizon 고정")
    ap.add_argument("--pet", type=int, default=64,
                    help="펫 상자 한 변. 스프라이트 32px x PET_SCALE 2 = 64")
    a = ap.parse_args()

    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    files = sorted(glob.glob(a.pattern)) or [a.pattern]

    metas = []
    print(f"{'파일':<22}{'horizon':>9}{'ground':>8}{'확신':>7}  비고")
    print("-" * 66)
    for f in files:
        m = analyse(f, a.ground, a.horizon, a.pet)
        metas.append(m)
        note = "; ".join(m["notes"]) if m["notes"] else ""
        print(f'{m["file"]:<22}{m["horizon"]:>9}{m["groundTop"]:>8}'
              f'{m["confidence"]["ground"]:>7.2f}  {note}')
        if a.overlay:
            overlay(f, m, outdir)

    # 구도가 같은 16장이면 groundTop 이 서로 가까워야 한다. 흩어지면 검출이
    # 틀렸거나 장면이 실제로 다른 것이다.
    gs = [m["groundTop"] for m in metas]
    if len(gs) > 1:
        print(f"\ngroundTop  최소 {min(gs)}  최대 {max(gs)}  "
              f"폭 {max(gs)-min(gs)}px  중앙값 {sorted(gs)[len(gs)//2]}")

    (outdir / "meta.json").write_text(
        json.dumps(metas, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"저장 -> {outdir}/meta.json"
          + (f"  (오버레이 {len(files)}장)" if a.overlay else ""))


if __name__ == "__main__":
    main()
