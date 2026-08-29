#!/usr/bin/env python3
"""모션 프레임 생성기(motion_make.py) — 옮기지 말고 찌그러뜨린다.

Derive motion frames from a finished card grid by deforming, not translating.

Why this exists: sliding the whole sprite up and down is the obvious way to
animate and it always looks dead. The eye reads a translated sprite as "the
picture moved", not "the creature moved". What sells life is the silhouette
changing shape while the feet stay planted — squash when it lands, stretch when
it leaps, and parts like tails and ears arriving a frame late.

Those mechanics are the same for every character, so they live here rather than
being re-invented per sprite. What differs per character — where the feet are,
which part should lag, where the dust puffs — comes in as arguments.

Usage:
    python3 motion_make.py --grid card.txt --motion idle --out-prefix /tmp/pet_idle
    python3 motion_make.py --grid card.txt --motion attack --anchor 3 \
        --lag 24-30 --effect-at 8,26 --out-prefix /tmp/pet_attack

    --anchor N     bottom N rows of the silhouette are the ground contact and
                   never move (default 2). Getting this right matters more than
                   anything else here: if the feet slide, nothing else helps.
    --lag X0-X1    column range that arrives one frame late (tail, ears, wings).
                   Repeatable. Skip it and the whole body moves in lockstep.
    --effect-at X,Y  anchor for the effect stamp (dust for attack, emote for
                   click). Uses colours already in the grid, so the palette
                   budget is untouched.

뽑은 뒤에는 motion_check.py 로 정렬 후 차이가 등급 하한을 넘는지 확인한다.

Writes <prefix>_f0.txt … and prints a per-frame summary of how the bounding box
changes — if that column never moves, the animation is still translation.
"""

import argparse
import re
import sys

W = H = None


def load(path):
    txt = open(path, encoding="utf-8").read()
    legend = dict(re.findall(r"^(\S)\s*=\s*(#[0-9A-Fa-f]{6})", txt.split("[grid]")[0], re.M))
    rows = [list(r) for r in txt.split("[grid]\n")[1].split("\n") if r]
    return legend, rows


def dump(legend, rows):
    return ("[legend]\n" + "\n".join(f"{k} = {v}" for k, v in legend.items())
            + "\n[grid]\n" + "\n".join("".join(r) for r in rows))


def blank():
    return [["."] * W for _ in range(H)]


def span(rows):
    pts = [(x, y) for y in range(H) for x in range(W) if rows[y][x] != "."]
    if not pts:
        return None
    return (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts))


def row_span(row):
    xs = [x for x, c in enumerate(row) if c != "."]
    return (min(xs), max(xs)) if xs else None


def squash(rows, anchor):
    """Feet stay; everything above drops one row. Silhouette gets shorter."""
    b = span(rows)
    top, bot = b[1], b[3]
    seam = bot - anchor
    out = [r[:] for r in rows]
    for y in range(seam, top, -1):
        out[y] = rows[y - 1][:]
    out[top] = ["."] * W
    return out


def stretch(rows, anchor):
    """Feet stay; body lifts one row and the waist row is duplicated to fill."""
    b = span(rows)
    top, bot = b[1], b[3]
    seam = bot - anchor
    if top == 0:
        return [r[:] for r in rows]
    out = [r[:] for r in rows]
    for y in range(top - 1, seam):
        out[y] = rows[y + 1][:]
    out[seam] = rows[seam][:]
    return out


def widen(rows, y0, y1, n=1):
    """Bulge the given band outward by duplicating the pixel next to the outline."""
    out = [r[:] for r in rows]
    for y in range(max(0, y0), min(H, y1 + 1)):
        s = row_span(rows[y])
        if not s or s[1] - s[0] < 3:
            continue
        a, b = s
        for _ in range(n):
            if a - 1 < 1 or b + 1 > W - 2:
                break   # 캔버스 여백 1px 은 절대 침범하지 않는다
            new = out[y][:]
            new[a - 1] = out[y][a]
            new[a] = out[y][a + 1]
            new[b + 1] = out[y][b]
            new[b] = out[y][b - 1]
            out[y] = new
            a, b = a - 1, b + 1
    return out


def narrow(rows, y0, y1, n=1):
    """Pull the band in — the counterpart of widen, for the stretched frame."""
    out = [r[:] for r in rows]
    for y in range(max(0, y0), min(H, y1 + 1)):
        s = row_span(rows[y])
        if not s or s[1] - s[0] < 5:
            continue
        a, b = s
        for _ in range(n):
            new = out[y][:]
            new[a] = "."
            new[b] = "."
            new[a + 1] = out[y][a]
            new[b - 1] = out[y][b]
            out[y] = new
            a, b = a + 1, b - 1
    return out


def reseal(rows, outline):
    """Re-close the outline after a deformation.

    Shifting or bulging a row can expose body pixels at the silhouette edge,
    because the row that moved into place had a narrower profile than its new
    neighbours. Rather than trying to predict that per shape, just reassert the
    invariant the whole style depends on: every pixel touching empty space is
    the outline colour. Same pass as step 3 of the drawing order.
    """
    solid = {(x, y) for y in range(H) for x in range(W) if rows[y][x] != "."}
    out = [r[:] for r in rows]
    for (x, y) in solid:
        if any((x + dx, y + dy) not in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            out[y][x] = outline
    return out


def apply_lag(cur, prev, ranges):
    """Tail/ears keep the previous frame's pose for one beat."""
    if not ranges:
        return cur
    out = [r[:] for r in cur]
    for (a, b) in ranges:
        for y in range(H):
            for x in range(max(0, a), min(W, b + 1)):
                out[y][x] = prev[y][x]
    return out


def stamp(rows, pts, ch):
    out = [r[:] for r in rows]
    for (x, y) in pts:
        if 0 <= x < W and 0 <= y < H and out[y][x] == ".":
            out[y][x] = ch
    return out


def dust(rows, at, step, ch):
    """A small puff that spreads and thins over three beats."""
    if not at:
        return rows
    x, y = at
    sets = {0: [(x, y), (x + 1, y)],
            1: [(x - 1, y), (x + 2, y), (x, y - 1)],
            2: [(x - 2, y), (x + 3, y)]}
    return stamp(rows, sets.get(step, []), ch)


def emote(rows, at, ch):
    """Two pixels above the head — reads as a '!' at 32px."""
    if not at:
        return rows
    x, y = at
    return stamp(rows, [(x, y), (x, y - 2)], ch)


def build(motion, rows, legend, anchor, lag, eff):
    b = span(rows)
    top, bot = b[1], b[3]
    # 부풀리는 띠는 몸통 아래쪽만. 얼굴 높이까지 넓히면 프레임마다 이목구비가
    # 흔들려서, 살아 있는 게 아니라 화면이 지직거리는 것처럼 보인다.
    mid0, mid1 = top + (bot - top) * 3 // 5, bot - anchor - 1
    shadow = next((k for k, v in legend.items() if k not in "KW"), "S")
    outline = next((k for k, v in legend.items() if v.upper() == "#2C2438"), "K")

    base = [r[:] for r in rows]
    sq = widen(squash(base, anchor), mid0, mid1, 1)
    st = narrow(stretch(base, anchor), mid0, mid1, 1)

    if motion == "idle":
        seq = [base, sq, base, st]
    elif motion == "click":
        seq = [base, st, emote(sq, eff, outline), base]
    else:  # attack — anticipation, strike, hold, settle, home
        strike = narrow(stretch(stretch(base, anchor), anchor), mid0, mid1, 1)
        seq = [base,
               dust(sq, eff, 0, shadow),
               dust(strike, eff, 1, shadow),
               dust(strike, eff, 2, shadow),
               sq,
               base]

    out = []
    for i, g in enumerate(seq):
        g = apply_lag(g, out[i - 1] if i else g, lag)
        out.append(g if i == 0 else reseal(g, outline))
    return out


def main():
    global W, H
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", required=True)
    ap.add_argument("--motion", required=True, choices=("idle", "click", "attack"))
    ap.add_argument("--anchor", type=int, default=2)
    ap.add_argument("--lag", action="append", default=[])
    ap.add_argument("--effect-at", default="")
    ap.add_argument("--out-prefix", required=True)
    a = ap.parse_args()

    legend, rows = load(a.grid)
    H = len(rows)
    W = len(rows[0])
    lag = []
    for r in a.lag:
        m = re.fullmatch(r"(\d+)-(\d+)", r)
        if not m:
            sys.exit(f"--lag 형식은 X0-X1 : {r!r}")
        lag.append((int(m.group(1)), int(m.group(2))))
    eff = tuple(int(v) for v in a.effect_at.split(",")) if a.effect_at else None

    frames = build(a.motion, rows, legend, a.anchor, lag, eff)
    b0 = span(rows)
    print(f"{a.motion}  {len(frames)}프레임   기준 bbox "
          f"{b0[2]-b0[0]+1}x{b0[3]-b0[1]+1}  (접지 {a.anchor}행 고정"
          + (f", 지연 {a.lag}" if a.lag else "") + ")")
    changed = 0
    for i, g in enumerate(frames):
        open(f"{a.out_prefix}_f{i}.txt", "w", encoding="utf-8").write(dump(legend, g))
        b = span(g)
        w, h = b[2] - b[0] + 1, b[3] - b[1] + 1
        d = "" if (w, h) == (b0[2]-b0[0]+1, b0[3]-b0[1]+1) else "  ← 실루엣 변형"
        if d:
            changed += 1
        print(f"  f{i}  bbox {w}x{h}  y {b[1]}-{b[3]}{d}")
    if not changed:
        print("\n경고: bbox 가 한 번도 안 변했다 — 평행이동만 있는 애니메이션이다")
    print(f"\n{len(frames)}개 그리드 → {a.out_prefix}_f*.txt")


if __name__ == "__main__":
    main()
