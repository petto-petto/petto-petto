#!/usr/bin/env python3
"""scene.json -> 레이어 PNG + 합성 PNG + 메타 json.

280x120 배경을 sky/far/mid/near 레이어로 나눠 굽는다. 그림은 scene.json의
ops 목록(프리미티브 + 스탬프)으로 기술하고, 색은 프리셋 램프 참조('mid.2')로
쓴다 — 프리셋만 바꾸면 같은 구도가 다른 분위기로 다시 구워진다.

Usage:
    python3 bg_render.py scene.json --out-dir assets/backgrounds/bg_001_forest_glade
    python3 bg_render.py scene.json --out-dir <dir> --preview /tmp/prev.png --scale 3
"""
import argparse
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
import json
import math
import os
import random
import re
import sys

import bg_pillow_gate  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgcore import (CANVAS, bayer, hex_rgba, load_stamp, preset, resolve, shift, to_hex)

LAYER_ORDER = ["sky", "far", "mid", "near"]


class Canvas:
    def __init__(self, w, h, seamless):
        from PIL import Image
        self.w, self.h, self.seamless = w, h, seamless
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.img.load()

    def put(self, x, y, rgba):
        if rgba is None:
            return
        if self.seamless:
            x %= self.w
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = rgba


def snap_period(w, p):
    """seamless일 때 반복 주기를 캔버스 폭의 약수로 스냅한다.

    폭을 나누지 못하는 주기로 무늬를 깔면 좌우 끝에서 위상이 어긋나 이음매가
    생긴다. 요청한 값에 가장 가까운 약수로 당긴다(없으면 원래 값).
    """
    p = max(1, int(round(p)))
    divs = [d for d in range(1, w + 1) if w % d == 0]
    return min(divs, key=lambda d: (abs(d - p), d))


def curve(x, base, amp, period, phase, harmonic, seed):
    """실루엣 상단선. 사인 + 2배음 + 결정적 지터를 정수로 양자화."""
    v = base + amp * math.sin(2 * math.pi * (x / max(1e-6, period)) + phase)
    if harmonic:
        v += amp * harmonic * math.sin(4 * math.pi * (x / max(1e-6, period)) + phase * 1.7)
    if seed is not None:
        rnd = random.Random((seed * 7919 + x) & 0xFFFFFFFF)
        v += rnd.choice((-1, 0, 0, 1)) * 0.5
    return int(round(v))


# ---------------------------------------------------------------- ops


def op_fill(c, o, pre):
    col = resolve(o["color"], pre)
    for y in range(c.h):
        for x in range(c.w):
            c.put(x, y, col)


def op_rect(c, o, pre):
    col = resolve(o["color"], pre)
    x0, y0, w, h = o["x"], o["y"], o["w"], o["h"]
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            c.put(x, y, col)


def op_vgradient(c, o, pre):
    """세로 그라데이션. ramp의 from..to 단계 사이를 행 비율로 보간, 경계는 bayer 디더."""
    ramp = pre["ramps"][o["ramp"]]
    fi, ti = o.get("from", len(ramp) - 1), o.get("to", 0)
    x0, y0, w, h = o.get("box", [0, o.get("y0", 0), c.w, o.get("y1", c.h) - o.get("y0", 0)])
    dither = o.get("dither", True)
    blk = max(1, int(o.get("block", 2)))
    for y in range(y0, y0 + h):
        t = (y - y0) / max(1, h - 1)
        f = fi + (ti - fi) * t
        lo, hi = int(math.floor(f)), int(math.ceil(f))
        lo = max(0, min(len(ramp) - 1, lo)); hi = max(0, min(len(ramp) - 1, hi))
        frac = f - math.floor(f)
        c_lo, c_hi = resolve(ramp[lo], pre), resolve(ramp[hi], pre)
        for x in range(x0, x0 + w):
            use_hi = (frac >= 0.5) if not dither else bayer(x // blk, y // blk, frac)
            c.put(x, y, c_hi if use_hi else c_lo)


def op_hills(c, o, pre):
    """물결 실루엣. from='bottom'이면 곡선 아래를, 'top'이면 위를 채운다."""
    col = resolve(o["color"], pre)
    edge = resolve(o["edge"], pre) if o.get("edge") else None
    edge_h = o.get("edgeH", 1)
    side = o.get("from", "bottom")
    y_end = o.get("to", c.h if side == "bottom" else 0)
    per = o.get("period", 60)
    if c.seamless:
        per = snap_period(c.w, per)
    for x in range(c.w):
        top = curve(x, o["base"], o.get("amp", 4), per,
                    o.get("phase", 0.0), o.get("harmonic", 0.0), o.get("seed"))
        if side == "bottom":
            span = range(top, y_end)
            edge_rows = range(top, top + edge_h)
        else:
            span = range(y_end, top + 1)
            edge_rows = range(top - edge_h + 1, top + 1)
        for y in span:
            c.put(x, y, col)
        if edge:
            for y in edge_rows:
                c.put(x, y, edge)


def op_band(c, o, pre):
    """수평 지면 밴드 — 상단 엣지 라인 + 선택적 반점."""
    col = resolve(o["color"], pre)
    y0, h = o["y"], o.get("h", c.h - o["y"])
    for y in range(y0, y0 + h):
        for x in range(c.w):
            c.put(x, y, col)
    if o.get("top"):
        te = resolve(o["top"], pre)
        for y in range(y0, y0 + o.get("topH", 2)):
            for x in range(c.w):
                c.put(x, y, te)
    sp = o.get("speckle")
    if sp:
        sc = resolve(sp["color"], pre)
        rnd = random.Random(sp.get("seed", 1))
        n = int(c.w * h * sp.get("density", 0.05))
        for _ in range(n):
            c.put(rnd.randrange(c.w), rnd.randrange(y0 + o.get("topH", 2), y0 + h), sc)


def scale_rows(rows, k):
    """최근접 확대. 도트가 깨지지 않게 정수배만 받는다."""
    k = int(k)
    if k <= 1:
        return rows
    out = []
    for r in rows:
        rr = "".join(ch * k for ch in r)
        out.extend([rr] * k)
    return out


def _flip_tone(ref, pre):
    """램프 안에서 단계를 좌우 대칭으로 뒤집는다: i -> lo+hi-i.

    스탬프를 좌우 반전하면 왼쪽에 있던 하이라이트가 오른쪽으로 간다. 광원이
    좌상단 고정이므로 그대로 두면 '거울 나무'가 된다 — 반전된 침엽수 하나가
    광원 일관성을 62%까지 떨어뜨린 적이 있다. 기하는 미러링하되 톤 순서를
    뒤집으면 하이라이트가 다시 왼쪽으로 온다.
    """
    m = re.match(r"^([a-zA-Z_]+)\.(-?\d+)$", str(ref).strip())
    if not m:
        return ref
    ramp = pre["ramps"].get(m.group(1))
    if not ramp:
        return ref
    i = max(0, min(len(ramp) - 1, int(m.group(2))))
    return f"{m.group(1)}.{len(ramp) - 1 - i}"


def op_stamp(c, o, pre):
    legend, rows = load_stamp(o["name"])
    rows = scale_rows(rows, o.get("scale", 1))
    sw, sh = len(rows[0]), len(rows)
    x0 = o["x"] - (sw // 2 if o.get("align", "left") == "center" else 0)
    y0 = o["y"] - (sh if o.get("anchor", "bottom") == "bottom" else 0)
    d = o.get("shade", 0)
    flip = o.get("flip", False)
    for ry, row in enumerate(rows):
        for rx, ch in enumerate(row):
            if ch == "." or ch not in legend:
                continue
            ref = shift(legend[ch], pre, d)
            if flip and not o.get("keepTone"):
                ref = _flip_tone(ref, pre)
            c.put(x0 + (sw - 1 - rx if flip else rx), y0 + ry, resolve(ref, pre))


def op_scatter(c, o, pre):
    """같은 스탬프를 여러 x에 반복. flipAlt면 하나 걸러 좌우 반전."""
    for i, x in enumerate(o["xs"]):
        op_stamp(c, {"name": o["name"], "x": x, "y": o["y"],
                     "anchor": o.get("anchor", "bottom"),
                     "align": o.get("align", "center"),
                     "shade": o.get("shade", 0),
                     "flip": bool(i % 2) if o.get("flipAlt", True) else o.get("flip", False)}, pre)


def op_tile(c, o, pre):
    """스탬프를 box 안에 반복해서 채운다(벽·마루 텍스처)."""
    legend, rows = load_stamp(o["name"])
    sw, sh = len(rows[0]), len(rows)
    x0, y0, w, h = o["box"]
    off = o.get("stagger", 0)
    for y in range(y0, y0 + h):
        ry = (y - y0) % sh
        band = (y - y0) // sh
        for x in range(x0, x0 + w):
            rx = (x - x0 + band * off) % sw
            ch = rows[ry][rx]
            if ch == "." or ch not in legend:
                continue
            c.put(x, y, resolve(shift(legend[ch], pre, o.get("shade", 0)), pre))


def op_clouds(c, o, pre):
    """뭉게구름 — 타원 퍼프 여러 개 + 아랫면 그림자."""
    col = resolve(o["color"], pre)
    sh = resolve(o["shade"], pre) if o.get("shade") else None
    mid = resolve(o["mid"], pre) if o.get("mid") else None
    for (cx, cy, rw, rh) in o["blobs"]:
        for y in range(cy - rh, cy + rh + 1):
            for x in range(cx - rw, cx + rw + 1):
                dx, dy = (x - cx) / max(1, rw), (y - cy) / max(1, rh)
                if dx * dx + dy * dy <= 1.0:
                    c.put(x, y, mid if (mid and dy > 0.15) else col)
        if sh:
            for x in range(cx - rw, cx + rw + 1):
                dx = (x - cx) / max(1, rw)
                if abs(dx) <= 1.0:
                    yb = cy + int(rh * math.sqrt(max(0.0, 1 - dx * dx)))
                    c.put(x, yb, sh)


def op_specks(c, o, pre):
    """잎·꽃·반딧불·먼지 — box 안에 결정적 난수로 흩뿌린다."""
    col = resolve(o["color"], pre)
    x0, y0, w, h = o["box"]
    rnd = random.Random(o.get("seed", 5))
    for _ in range(o.get("count", 20)):
        c.put(x0 + rnd.randrange(w), y0 + rnd.randrange(h), col)


def op_rays(c, o, pre):
    """좌상단 광원 기준 사선 광선. 디더로 반투명 느낌을 낸다."""
    col = resolve(o["color"], pre)
    slope = o.get("slope", 2.0)
    t = o.get("strength", 0.35)
    y1 = o.get("y1", c.h)
    for x0 in o["xs"]:
        wdt = o.get("width", 3)
        for y in range(o.get("y0", 0), y1):
            xs = int(x0 + y / slope)
            for k in range(wdt):
                if bayer(xs + k, y, t):
                    c.put(xs + k, y, col)


def op_scanshade(c, o, pre):
    """box에 가로 줄 음영 — 평평한 면에 결을 준다."""
    col = resolve(o["color"], pre)
    x0, y0, w, h = o["box"]
    every = o.get("every", 3)
    for y in range(y0, y0 + h):
        if (y - y0) % every:
            continue
        for x in range(x0, x0 + w):
            c.put(x, y, col)


def op_vignette(c, o, pre):
    """가장자리 어둡게 — 실내 프리셋에서 오버레이 경계를 정리한다."""
    col = resolve(o["color"], pre)
    e = o.get("edge", 10)
    s = o.get("strength", 0.6)
    for y in range(c.h):
        for x in range(c.w):
            d = min(x, c.w - 1 - x, y, c.h - 1 - y)
            if d >= e:
                continue
            if bayer(x, y, s * (1 - d / e)):
                c.put(x, y, col)


def op_fringe(c, o, pre):
    """겹친 반원 로브로 만든 유기적 경계 — 잎더미·수목선·덤불선.

    사인 곡선(hills)은 주기를 짧게 잡으면 픽셀 단위에서 톱니가 된다. 가까이서
    보는 잎은 둥근 덩어리라서 원의 최댓값 프로필로 그려야 잎으로 읽힌다.
    """
    col = resolve(o["color"], pre)
    edge = resolve(o["edge"], pre) if o.get("edge") else None
    edge_h = o.get("edgeH", 1)
    side = o.get("from", "top")
    base, r, sp = o["base"], o.get("r", 6), o.get("spacing", 9)
    if c.seamless:
        sp = snap_period(c.w, sp)
    rnd = random.Random(o.get("seed", 1))
    lobes = []
    x = -r
    while x < c.w + r:
        lobes.append((x, r + rnd.randint(-o.get("jitter", 2), o.get("jitter", 2))))
        x += sp
    prof = []
    for x in range(c.w):
        best = 0
        for cx, rr in lobes:
            d = abs(x - cx)
            if d <= rr:
                best = max(best, (rr * rr - d * d) ** 0.5)
        prof.append(int(round(best)))
    for x in range(c.w):
        depth = base + prof[x]
        if side == "top":
            for y in range(0, depth + 1):
                c.put(x, y, col)
            if edge:
                for y in range(depth - edge_h + 1, depth + 1):
                    c.put(x, y, edge)
        else:
            top = base - prof[x]
            for y in range(top, o.get("to", c.h)):
                c.put(x, y, col)
            if edge:
                for y in range(top, top + edge_h):
                    c.put(x, y, edge)


def _rev_ramp(pre):
    """hex -> (ramp, index). autoshade가 칠해진 색을 램프 위로 되돌리는 데 쓴다."""
    rev = {}
    for name, ramp in pre["ramps"].items():
        for i, h in enumerate(ramp):
            rev.setdefault(hex_rgba(h), (name, i))
    return rev


def op_autoshade(c, o, pre):
    """레이어에 이미 그려진 덩어리에 3톤 폼셰이딩을 자동으로 붙인다.

    도트 배경이 평평해 보이는 가장 큰 원인은 덩어리마다 색이 하나뿐이기
    때문이다. 이 op은 각 덩어리의 위/왼쪽 경계에 한 단 밝은 톤, 아래/오른쪽
    경계에 한 단 어두운 톤을 깐다 — 광원 좌상단 고정 규칙 그대로다.
    스탬프 하나하나에 하이라이트를 손으로 넣는 것보다 싸고, 광원 일관성
    게이트를 자동으로 통과한다.
    """
    from PIL import Image
    rev = _rev_ramp(pre)
    depth = o.get("depth", 1)
    hi_d, lo_d = o.get("highlight", 1), -o.get("shadow", 1)
    only = set(o["only"]) if o.get("only") else None
    box = o.get("box", [0, 0, c.w, c.h])
    snap = c.img.copy().load()
    x0, y0, bw, bh = box

    def ramp_at(x, y):
        if not (0 <= x < c.w and 0 <= y < c.h):
            return None
        px = snap[x, y]
        if px[3] == 0:
            return None
        return rev.get(px)

    for y in range(y0, min(c.h, y0 + bh)):
        for x in range(x0, min(c.w, x0 + bw)):
            cur = ramp_at(x, y)
            if cur is None:
                continue
            name, idx = cur
            if only and name not in only:
                continue
            ramp = pre["ramps"][name]
            up = ramp_at(x, y - depth)
            lf = ramp_at(x - depth, y)
            dn = ramp_at(x, y + depth)
            rt = ramp_at(x + depth, y)
            top_edge = (up is None or up[0] != name) or (lf is None or lf[0] != name)
            bot_edge = (dn is None or dn[0] != name) or (rt is None or rt[0] != name)
            if top_edge and not bot_edge:
                ni = max(0, min(len(ramp) - 1, idx + hi_d))
            elif bot_edge and not top_edge:
                ni = max(0, min(len(ramp) - 1, idx + lo_d))
            else:
                continue
            c.put(x, y, resolve(ramp[ni], pre))


def op_ground_plane(c, o, pre):
    """뒤로 물러나는 지면.

    깊이 단서(톤 기울기·셀 수렴·결 압축)는 그대로 둔다 — `bg_check`의 지면 압축
    게이트가 그걸 잰다. 대신 셋을 고친다.

      1. 잔디선이 직선 rect라 자를 댄 것처럼 보인다 → 너덜한 가장자리 + 풀 포기
      2. 세로 셀 경계가 `(x + row*3) % cw`라 규칙적인 빗이 된다 → 깊이에 비례한
         흙 얼룩. 직사각형으로 찍으면 글리치, 크고 매끈한 타원이면 연잎이 된다
      3. 돌·부스러기가 없다 → 크기 기울기를 가진 자갈

    **디테일은 위쪽 2/3에 몰아 둔다.** 아래가 촘촘해지면 지면 압축 판정이
    뒤집힌다(`gate_conflicts.md` §3).
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    y0, h = o["y"], o["h"]
    fi, ni = o.get("far", 3), o.get("near", 0)
    cw0, cw1 = o.get("cell", [2, 7])
    rnd = random.Random(o.get("seed", 11))

    def tone_at(row):
        return fi + (ni - fi) * (row / max(1, h - 1))

    for row in range(h):
        y = y0 + row
        f = tone_at(row)
        lo, hi = int(math.floor(f)), int(math.ceil(f))
        lo = max(0, min(len(ramp) - 1, lo)); hi = max(0, min(len(ramp) - 1, hi))
        c_lo, c_hi = resolve(ramp[lo], pre), resolve(ramp[hi], pre)
        frac = f - math.floor(f)
        for x in range(c.w):
            c.put(x, y, c_hi if bayer(x, y, frac) else c_lo)

    # 흙 얼룩 — 셀 폭에 비례한 작은 것을 많이. 행마다 폭을 흔들어 테두리를 지운다.
    for _ in range(o.get("patches", 150)):
        row = int((rnd.random() ** 1.5) * (h - 2))
        t = row / max(1, h - 1)
        cw = max(2, int(round(cw0 + (cw1 - cw0) * t)))
        y, x = y0 + row, rnd.randrange(0, c.w)
        rx = max(1.0, cw * rnd.uniform(0.18, 0.42))
        ry = max(1.0, rx * rnd.uniform(0.35, 0.7))
        tone = int(round(tone_at(row))) + rnd.choice((-1, -1, -1, 1))
        for dy in range(int(-ry) - 1, int(ry) + 2):
            if abs(dy) > ry:
                continue
            span = rx * math.sqrt(max(0.0, 1 - (dy / max(0.5, ry)) ** 2))
            span = max(0.0, span + rnd.uniform(-0.8, 0.8))
            for dx in range(int(-span), int(span) + 1):
                c.put(x + dx, y + dy, col(tone))

    # 가로 결 — 아래로 갈수록 간격이 넓어진다(위쪽이 압축돼 보인다)
    row, k = 0, 0
    while row < h:
        y = y0 + row
        bi = max(0, min(len(ramp) - 1,
                        int(round(tone_at(row))) + o.get("furrowShift", 1)))
        cc = resolve(ramp[bi], pre)
        for x in range(c.w):
            if bayer(x, y, o.get("furrowStrength", 0.55)):
                c.put(x, y, cc)
        k += 1
        row += o.get("furrow0", 2) + k

    # 자갈. 위쪽은 작고 아래로 갈수록 커진다. 지면과 같은 램프를 쓴다 —
    # 다른 램프(far·accent)를 쓰면 흙바닥에 청록 보석이 박힌다('파란 열매').
    for _ in range(o.get("pebbles", 26)):
        row = int((rnd.random() ** 1.3) * (h * 0.78))     # 아래 1/4은 비운다
        y = y0 + row
        t = row / max(1, h - 1)
        pr = max(1, int(1 + t * o.get("pebbleMax", 2)))
        x = rnd.randrange(pr + 1, max(pr + 2, c.w - pr - 1))
        centre = int(round(tone_at(row)))
        for dy in range(-pr, pr + 1):
            for dx in range(-pr, pr + 1):
                if dx * dx + dy * dy > pr * pr + pr * 0.4:
                    continue
                u = (dx + dy) / (2.0 * pr)
                c.put(x + dx, y + dy,
                      col(centre + (2 if u < -0.30 else (0 if u < 0.45 else -2))))
        for dx in range(-pr, pr + 1):
            c.put(x + dx, y + pr + 1, col(max(0, centre - 2)))

    for _ in range(o.get("debris", 10)):
        row = int((rnd.random() ** 1.4) * (h * 0.8))
        y, x = y0 + row, rnd.randrange(2, max(3, c.w - 8))
        ln = rnd.randint(3, 7)
        tone = max(0, int(round(tone_at(row))) - 2)
        for k in range(ln):
            c.put(x + k, y + (1 if k > ln // 2 else 0), col(tone))

    # 잔디선. 직선 rect는 자를 댄 것처럼 보인다.
    if o.get("edge"):
        ec = resolve(o["edge"], pre)
        er = pre["ramps"].get(str(o["edge"]).split(".")[0])
        eh = o.get("edgeH", 2)
        kn = [rnd.uniform(-1, 1) for _ in range(6)]
        for x in range(c.w):
            tt = x / max(1, c.w - 1)
            n = sum(k * math.sin(2 * math.pi * (i + 1) * tt * 3 + k * 3)
                    for i, k in enumerate(kn)) / len(kn)
            top = y0 + int(round(n * 1.6))
            for dy in range(eh + rnd.randint(0, 1)):
                c.put(x, top + dy, ec)
            if er and rnd.random() < 0.16:
                for k in range(rnd.randint(1, 3)):
                    c.put(x, top - 1 - k,
                          resolve(er[min(len(er) - 1, 3 if k == 0 else 2)], pre))


def op_scatter_depth(c, o, pre):
    """깊이 띠에 스탬프를 뿌린다 — 크기·톤·간격이 깊이를 따라 함께 변한다.

    하나로 깊이 단서 셋을 만든다: 크기 기울기, 명도 기울기, 그리고 y 순서로
    그리기 때문에 생기는 겹침(occlusion). 펫 박스는 avoid로 비운다.
    """
    n = o.get("count", 8)
    y0, y1 = o["y0"], o["y1"]
    x0, x1 = o.get("x0", 0), o.get("x1", c.w)
    s0, s1 = o.get("scale", [1, 2])
    d0, d1 = o.get("shade", [2, 0])
    av = o.get("avoid")
    rnd = random.Random(o.get("seed", 13))
    items = []
    for i in range(n):
        t = (i + 0.5) / n
        t = min(1.0, max(0.0, t + rnd.uniform(-0.12, 0.12)))
        x = rnd.randrange(x0, max(x0 + 1, x1))
        if av and av[0] - 8 <= x <= av[1] + 8:
            x = av[1] + 10 + rnd.randrange(0, 24) if rnd.random() < 0.5 else av[0] - 10 - rnd.randrange(0, 24)
        items.append((t, x))
    for t, x in sorted(items):
        op_stamp(c, {"name": o["name"], "x": x,
                     "y": int(round(y0 + (y1 - y0) * t)),
                     "anchor": "bottom", "align": "center",
                     "scale": int(round(s0 + (s1 - s0) * t)),
                     "shade": int(round(d0 + (d1 - d0) * t)),
                     # 무작위 반전은 기본으로 끈다. 톤 보정이 있어도 방향성 있는
                     # 스탬프가 뒤집히면 실루엣이 어색해지는 경우가 있어, 켜려면
                     # 씬에서 flipAlt를 명시한다.
                     "flip": (rnd.random() < 0.5) if o.get("flipAlt", False) else False},
                    pre)


def op_glow(c, o, pre):
    """디더 감쇠 광원 — 램프 불빛, 창으로 드는 빛 웅덩이.

    단색 타원을 얹으면 물감 자국이 된다. 중심에서 멀어질수록 디더 비율이
    떨어지게 해야 '빛'으로 읽힌다. 아래로 퍼지는 빛은 ry를 크게 준다.
    """
    col = resolve(o["color"], pre)
    cx, cy = o["x"], o["y"]
    rx, ry = o.get("rx", 18), o.get("ry", 10)
    st = o.get("strength", 0.6)
    gamma = o.get("gamma", 1.6)
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            d = ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2
            if d > 1.0:
                continue
            if bayer(x, y, st * (1 - d) ** gamma):
                c.put(x, y, col)


def op_contact_shadow(c, o, pre):
    """접지 그림자 — 물체가 바닥에 '놓인' 것으로 읽히게 하는 최소 단서."""
    col = resolve(o["color"], pre)
    cx, y, w = o["x"], o["y"], o.get("w", 14)
    h = o.get("h", 2)
    st = o.get("strength", 0.75)
    for dy in range(h):
        for dx in range(-w // 2, w // 2 + 1):
            r = abs(dx) / max(1, w / 2)
            if r * r + (dy / max(1, h)) ** 2 <= 1.0 and bayer(cx + dx, y + dy, st * (1 - r * 0.6)):
                c.put(cx + dx, y + dy, col)


def op_texture(c, o, pre):
    """덩어리진 디테일 마크. 1px 난수(=노이즈)가 아니라 2~3px 조각을 뿌린다."""
    col = resolve(o["color"], pre)
    x0, y0, w, h = o["box"]
    kind = o.get("marks", "grain")
    rnd = random.Random(o.get("seed", 17))
    n = int(w * h * o.get("density", 0.04))
    shapes = {"grain": [(0, 0), (0, 1)],
              "leaf": [(0, 0), (1, 0), (0, 1)],
              "brick": [(0, 0), (1, 0), (2, 0)],
              "dot": [(0, 0)]}[kind]
    for _ in range(n):
        bx, by = x0 + rnd.randrange(w), y0 + rnd.randrange(h)
        for dx, dy in shapes:
            c.put(bx + dx, by + dy, col)


def op_foliage(c, o, pre):
    """겹친 잎 로브 덩어리.

    브로콜리로 읽히는 진짜 원인은 로브가 원이라서가 아니라 **로브마다 제 몫의
    림라이트를 갖기 때문**이다. 실제 수관은 광원이 하나라 덩어리 전체에서 빛을
    받는 쪽 로브만 밝고, 안쪽은 그늘에 잠긴다. 셋을 바꾼다.

      1. 로브 밝기를 **덩어리 안에서의 위치**로 정한다. 직선 기울기로 주면 넓은
         상자에서 '한쪽만 밝은 벽'이 되므로 저주파 잡음장을 쓴다 — 밝은 뭉치와
         그늘진 뭉치가 번갈아 나온다.
      2. 로브 실루엣을 각도에 따라 흔든다(3·5차 하모닉).
      3. 윗변을 저주파 잡음으로 울렁이게 한다. 격자 커버리지는 그대로 두고 시작
         높이만 흔들어 **구멍이 뚫리지 않게** 하고, 바닥 줄은 크레스트를 받지
         않게 해 아래가 새지 않게 한다.
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    x0, y0, w, h = o["box"]
    r0, r1 = o.get("r", [5, 9])
    base, rim, shad = o.get("base", 1), o.get("rim", 3), o.get("shadow", 0)
    rnd = random.Random(o.get("seed", 7))
    rimw = o.get("rimW", 2)
    spread = o.get("spread", 2.2)
    depth_range = o.get("depthRange", 1)
    depth_tone = o.get("depthTone", True)
    step = max(3, int(((r0 + r1) / 2) * o.get("spacing", 1.15)))
    if c.seamless:
        step = snap_period(c.w, step)

    # opt-in이 꺼져 있으면 **난수를 한 번도 더 쓰지 않는다.** 소비 순서가 달라지면
    # 같은 seed로도 로브 배치가 통째로 바뀌어, 원경 캐노피 선이 달라지고 그 위의
    # 하늘 조각까지 달라진다.
    kn = [rnd.uniform(-1, 1) for _ in range(4)] if "crest" in o else [0.0]

    def crest(x):
        t = (x - x0) / max(1, w)
        return sum(k * math.sin(2 * math.pi * (i + 1) * t * o.get("crestFreq", 1.6)
                                + k * 3) for i, k in enumerate(kn)) / len(kn)

    # 새 동작(윗변 울렁임 + 뭉치 단위 명암)은 **opt-in**이다. `crest`를 주지
    # 않으면 기존 동작 그대로다 — 로브마다 림라이트, 윗변 평평.
    #
    # 원경 잎덩어리에는 주지 않는다. 원경의 윗변이 곧 하늘의 아랫경계라, 흔들면
    # 하늘이 조각나고 조각난 하늘은 세로 그라데이션뿐이라 좌우 광원 방향이 없어
    # 게이트 판정이 디더 잡음에 좌우된다(`gate_conflicts.md`).
    organic = "crest" in o
    lp = [rnd.uniform(0, 6.3) for _ in range(3)] if organic else [0.0, 0.0, 0.0]
    lw = max(24.0, w / o.get("litClumps", 3.2))
    ca = o.get("crest", 0.0)
    lit_span = o.get("litSpan", 1.0)

    lobes = []
    y = y0
    while y <= y0 + h:
        x = x0 if c.seamless else x0 - r1
        while x < (x0 + w if c.seamless else x0 + w + r1):
            rr = rnd.randint(r0, r1)
            jx = x + (rnd.randint(-2, 2) if not c.seamless else 0)
            jy = y + rnd.randint(-2, 2) + int(round(crest(x) * ca * h))
            k3 = rnd.uniform(0, 6.3) if organic else 0.0
            k5 = rnd.uniform(0, 6.3) if organic else 0.0
            lobes.append((jy, jx, rr, k3, k5))
            x += step
        y += max(3, step - 2)
    if organic:
        # 바닥 줄은 크레스트를 받지 않는다. 윗변만 올리면 아래에 구멍이 남는다.
        x = x0 - r1
        while x < x0 + w + r1:
            lobes.append((y0 + h - rnd.randint(0, max(1, r0 // 2)),
                          x + rnd.randint(-2, 2), rnd.randint(r0, r1),
                          rnd.uniform(0, 6.3), rnd.uniform(0, 6.3)))
            x += max(3, int(step * 0.75))

    av = o.get("avoid")
    for ly, lx, rr, k3, k5 in sorted(lobes):
        if av and av[0] - rr <= lx <= av[1] + rr:
            continue
        t = (ly - y0) / max(1, h)
        d = int(round((t - 0.5) * depth_range)) if depth_tone else 0

        f = (math.sin(lx / lw + lp[0])
             + math.sin(ly / max(8.0, h * 0.45) + lp[1])
             + math.sin((lx + ly * 1.7) / (lw * 1.6) + lp[2])) / 3.0
        g = 0.5 + 0.5 * f + (t - 0.5) * 0.35
        lit_rim = g < lit_span
        deep = lit_span < 1.0 and g > 0.82

        prof = ([rr * (1.0 + 0.20 * math.sin(3 * a * math.tau / 48 + k3)
                       + 0.11 * math.sin(5 * a * math.tau / 48 + k5))
                 for a in range(48)] if organic else [float(rr)] * 48)

        for dy in range(-rr - 3, rr + 4):
            for dx in range(-rr - 3, rr + 4):
                rad = prof[int((math.atan2(dy, dx) % math.tau) / math.tau * 48) % 48]
                dist = math.hypot(dx, dy)
                if dist > rad:
                    continue
                px, py = lx + dx, ly + dy
                if not (y0 - r1 - 4 <= py <= y0 + h + r1):
                    continue
                u = (dx + dy) / (2.0 * max(1, rr))
                st = int(round(-u * spread))
                edge = dist > rad - rimw
                if edge and dx + dy < -rad * 0.30 and lit_rim:
                    c.put(px, py, col(rim + d))
                elif edge and dx + dy > rad * 0.30:
                    c.put(px, py, col(shad + d))
                elif deep:
                    c.put(px, py, col(base + d + st - 1))
                else:
                    c.put(px, py, col(base + d + st))

        # 빛 받는 로브의 윗호에만 잎 끝을 세운다. 많으면 톱니가 된다.
        if organic and lit_rim and rnd.random() < 0.5:
            for _ in range(rnd.randint(1, 2)):
                ang = rnd.uniform(math.pi * 1.15, math.pi * 1.85)
                rad = prof[int((ang % math.tau) / math.tau * 48) % 48]
                sx = lx + int(round(math.cos(ang) * rad))
                sy = ly + int(round(math.sin(ang) * rad))
                for k in range(rnd.randint(1, 2)):
                    c.put(sx + int(round(math.cos(ang) * k)),
                          sy + int(round(math.sin(ang) * k)), col(rim + d))

    # 마른 잔가지 — 덩어리가 식물이라는 신호.
    for _ in range(o.get("twigs", 0)):
        tx = rnd.randrange(x0, x0 + max(1, w))
        ty = y0 + int(round(crest(tx) * ca * h)) + rnd.randint(0, 6)
        ln = rnd.randint(4, 9)
        ang = rnd.uniform(-2.4, -0.8)
        for k in range(ln):
            c.put(tx + int(math.cos(ang) * k), ty + int(math.sin(ang) * k), col(shad))
        if rnd.random() < 0.6:
            bx = tx + int(math.cos(ang) * ln * 0.6)
            by = ty + int(math.sin(ang) * ln * 0.6)
            for k in range(rnd.randint(2, 4)):
                c.put(bx + k, by - k, col(shad))

    if o.get("fillBelow"):
        fill = col(shad)
        for x in range(x0, x0 + w):
            for yy in range(y0 + h, o["fillBelow"]):
                c.put(x, yy, fill)


def rnd_board(seed, i):
    return (seed * 2654435761 + i * 40503) % 97


def op_clearing(c, o, pre):
    """펫이 서는 자리를 의도적으로 '조용하게' 비운다.

    배경이 풍부해질수록 펫이 묻힌다. 둘은 같이 못 올라간다 — 그래서 게임 배경은
    캐릭터 자리에 빈터·양탄자·빛 웅덩이 같은 저대비 구역을 일부러 만든다.
    단색 타원 + 디더 가장자리로 만들면 '점 무리'로 보이므로, 안쪽 코어 / 한 단
    어두운 링 / 디더 가장자리 3단으로 나눠 빈터처럼 읽히게 한다.
    """
    ramp = pre["ramps"].get(o["color"].split(".")[0]) if "." in str(o["color"]) else None
    idx = int(str(o["color"]).split(".")[1]) if ramp else None
    core_c = resolve(o["color"], pre)
    ring_c = resolve(ramp[max(0, idx - 1)], pre) if ramp else core_c
    cx, cy = o["x"], o["y"]
    rx, ry = o.get("rx", 26), o.get("ry", 20)
    core = o.get("core", 0.45)
    ring = o.get("ring", 0.80)
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            d = ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2
            if d > 1.0:
                continue
            if d <= core:
                c.put(x, y, core_c)
            elif d <= ring:
                c.put(x, y, ring_c)
            elif bayer(x // 2, y // 2, (1 - d) / max(1e-6, 1 - ring)):
                c.put(x, y, ring_c)


def op_panel(c, o, pre):
    """널판 벽·징두리·마루 — 이음매와 세로 조인트가 있는 구조적 면.

    큰 평면에 난수 점을 뿌리면 질감이 아니라 노이즈다. 실제로 눈이 읽는 건
    반복되는 '선'이다: 널 사이 이음매(어두움) + 그 아래 반사광(밝음) +
    일정 간격의 세로 조인트.
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    x0, y0, w, h = o["box"]
    base, seam, light = o.get("base", 2), o.get("seam", 0), o.get("light", 3)
    bh = o.get("boardH", 6)
    rnd = random.Random(o.get("seed", 9))
    vary = o.get("vary", 0)
    for y in range(y0, y0 + h):
        bi = (y - y0) // bh
        v = 0
        if vary:
            v = (rnd_board(o.get("seed", 9), bi) % (2 * vary + 1)) - vary
        for x in range(x0, x0 + w):
            c.put(x, y, col(base + v))
    for i in range((h // bh) + 1):
        y = y0 + i * bh
        for x in range(x0, x0 + w):
            c.put(x, y, col(seam))
            if y + 1 < y0 + h:
                c.put(x, y + 1, col(light))
    je = o.get("jointEvery", 0)
    if je and c.seamless:
        je = snap_period(c.w, je)
    if je:
        for i in range((h // bh) + 1):
            y = y0 + i * bh
            off = 0 if c.seamless else rnd.randrange(je)
            x = x0 + off
            while x < x0 + w:
                for yy in range(y + 2, min(y0 + h, y + bh)):
                    c.put(x, yy, col(seam))
                x += je
    gr = o.get("grain", 0.0)
    if gr:
        gcol = col(o.get("grainShift", base + 1))
        n = int(w * h * gr)
        for _ in range(n):
            gx, gy = x0 + rnd.randrange(w), y0 + rnd.randrange(h)
            for k in range(rnd.randint(2, 4)):
                c.put(gx + k, gy, gcol)


# ---- 고목 -------------------------------------------------------------
#
# 굽이·원통 단면·세로 홈 셋만으로는 "전봇대가 아니다"까지밖에 못 간다. 화면에서
# 가장 큰 오브젝트라 디테일이 부족하면 배경 전체가 덜 그려진 것으로 읽힌다.
# 아래 다섯이 실제로 차이를 만든 것들이다.
#
#   1. 실루엣 요철 — 사인 곡선 그대로면 가장자리가 유리처럼 매끈해 압출 도형이 된다
#   2. 수피 양식   — 가로 눈금은 사다리, 균등한 줄눈은 벽돌담이 된다
#   3. 반사광      — 그림자 쪽에 반사광이 없으면 오른쪽이 단색 검은 띠가 된다
#   4. 부착물      — 옹이 링·가지 그루터기·이끼 매트·담쟁이
#   5. 갈래 뿌리   — 밑동 폭만 넓히면 나팔이다

_TC_BANDS = (0.07, 0.30, 0.48, 0.64, 0.80, 0.93, 1.01)


def _tc_tones(base, lit, dark):
    """원통 단면 7단. 마지막이 그림자 쪽 반사광이다."""
    return (base,
            lit,
            max(base + 1, lit - 1),
            base + 1,
            base,
            dark,
            max(dark + 1, base - 1))


def _tc_band(u, tones):
    for edge, tone in zip(_TC_BANDS, tones):
        if u < edge:
            return tone
    return tones[-1]


def _tc_spine(o, x_off, w_scale):
    """중심선과 좌우 실루엣.

    좌우에 **서로 다른** 저주파 잡음을 얹는다. 같은 값을 쓰면 폭만 변하고
    윤곽은 여전히 매끈하다.
    """
    y0, y1 = o.get("y0", 0), o.get("y1", 0)
    w0, w1 = o.get("w", [14, 20])
    w0, w1 = w0 * w_scale, w1 * w_scale
    x0 = o["x"] + x_off
    converge = o.get("converge", 0.0)
    sway, per = o.get("sway", 4), o.get("period", 90)
    phase = o.get("phase", 0.0)
    wob = o.get("wobble", 1.0)
    rnd = random.Random(int(o.get("seed", 3) * 977 + x_off * 13))
    kn_l = [rnd.uniform(-1, 1) for _ in range(5)]
    kn_r = [rnd.uniform(-1, 1) for _ in range(5)]

    def noise(kn, t):
        return sum(k * math.sin(2 * math.pi * (i + 1) * t + k * 3.1)
                   for i, k in enumerate(kn)) / len(kn)

    left, right, cent = {}, {}, {}
    span = max(1, y1 - y0)
    for y in range(y0, y1):
        t = (y - y0) / span
        cx = (x0 - x_off * converge * (t ** 2.0)
              + sway * math.sin(2 * math.pi * (y - y0) / max(1e-6, per) + phase))
        w = w0 + (w1 - w0) * t
        if t > 0.86:
            w += ((t - 0.86) / 0.14) ** 1.6 * o.get("flare", 6) * w_scale
        if t < 0.08:
            w += (0.08 - t) / 0.08 * o.get("flareTop", 4) * w_scale
        amp = max(1.0, w * 0.06) * wob
        left[y] = int(round(cx - w / 2 + noise(kn_l, t * 2.3) * amp))
        right[y] = int(round(cx + w / 2 + noise(kn_r, t * 2.9) * amp))
        cent[y] = cx
    return left, right, cent


def _tc_body(c, o, pre, left, right, col, tones, seed):
    """몸통 + 윤곽. 밴드 경계를 행마다 흔들어 세로 줄무늬로 보이지 않게 한다."""
    edge = resolve(o["edge"], pre) if o.get("edge") else None
    rnd = random.Random(seed * 5)
    jit = [rnd.uniform(-0.035, 0.035) for _ in range(64)]
    for y in sorted(left):
        l, r = left[y], right[y]
        span = max(1, r - l)
        j = jit[y % len(jit)]
        for x in range(l, r):
            c.put(x, y, col(_tc_band((x - l) / span + j, tones)))
        if edge is not None:
            c.put(l, y, edge)
            c.put(r - 1, y, edge)


def _tc_bark_fissure(c, o, pre, left, right, col, tones, seed):
    """깊은 세로 균열 — 참나무 계열.

    가로 눈금을 그으면 사다리가 된다. 세로로 흐르다 가끔 옆으로 이어지는
    균열망이라야 껍질로 읽힌다. 균열은 어두운 단, 그 오른쪽(빛을 받는 판의
    왼쪽 면)은 한 단 밝게 — 좌상단 광원 규칙 그대로.
    """
    ys = sorted(left)
    if not ys:
        return
    y0, y1 = ys[0], ys[-1] + 1
    rnd = random.Random(seed * 31 + 5)
    lanes = o.get("barkLanes", max(5, o.get("grooves", 3) + 3))
    for lane in range(lanes):
        u = (lane + 0.5) / lanes + rnd.uniform(-0.045, 0.045)
        y = y0 + rnd.randrange(0, max(1, min(26, y1 - y0)))
        while y < y1 - 6:
            run = rnd.randint(14, 46)
            drift = rnd.uniform(-0.05, 0.05)
            for k in range(run):
                yy = y + k
                if yy not in left:
                    break
                l, r = left[yy], right[yy]
                span = max(1, r - l)
                uu = u + drift * (k / max(1, run))
                if not (0.05 < uu < 0.95):
                    continue
                x = int(l + span * uu)
                c.put(x, yy, col(tones[5]))
                if uu < 0.80:
                    c.put(x + 1, yy, col(_tc_band(uu, tones) + 1))
            if rnd.random() < 0.45 and (y + run) in left:
                yy = y + run
                l, r = left[yy], right[yy]
                span = max(1, r - l)
                wdt = int(span * rnd.uniform(0.06, 0.16))
                x = int(l + span * u)
                for dx in range(wdt):
                    xx = x + (dx if rnd.random() < 0.5 else -dx)
                    if l < xx < r:
                        c.put(xx, yy, col(tones[5]))
                        if yy + 1 in left and left[yy + 1] < xx < right[yy + 1]:
                            c.put(xx, yy + 1, col(_tc_band((xx - l) / span, tones) + 1))
            y += run + rnd.randint(3, 12)
            u += rnd.uniform(-0.03, 0.03)


def _tc_bark_plate(c, o, pre, left, right, col, tones, seed):
    """판상 수피 — 소나무 계열. 비늘처럼 조각난 판.

    줄 단위로 u 구간을 균등히 채우면 줄눈이 맞아 **벽돌담**이 된다. 판마다
    높이를 따로 주고 위·아래 모서리를 열마다 흔들어야 비늘로 읽힌다.
    """
    ys = sorted(left)
    if not ys:
        return
    y0, y1 = ys[0], ys[-1] + 1
    rnd = random.Random(seed * 37 + 9)
    lanes = o.get("plateLanes", 5)
    plates = []
    for lane in range(lanes):
        u = lane / lanes + rnd.uniform(0.0, 0.06)
        y = y0 + rnd.randrange(0, max(1, min(30, y1 - y0)))
        while y < y1 - 6:
            ph = rnd.randint(9, 20)
            pw = (1.0 / lanes) * rnd.uniform(0.78, 1.15)
            plates.append((u, min(0.97, u + pw), y, min(y + ph, y1), rnd.random()))
            y += ph + rnd.randint(1, 5)
    for u0, u1, ya, yb, pseed in plates:
        wob = random.Random(int(pseed * 1e6))
        kn = [wob.uniform(-1, 1) for _ in range(4)]

        def shift(t):
            return int(round(sum(k * math.sin(2 * math.pi * (i + 1) * t + k * 3)
                                 for i, k in enumerate(kn)) / len(kn) * 2.4))

        for yy in range(ya, yb):
            if yy not in left:
                continue
            l, r = left[yy], right[yy]
            span = max(1, r - l)
            t = (yy - ya) / max(1, yb - ya - 1)
            xa = int(l + span * u0) + shift(t * 1.7)
            xb = int(l + span * u1) + shift(t * 2.3 + 0.7)
            if xb <= xa:
                continue
            for x in (xa, xb):
                if l < x < r:
                    c.put(x, yy, col(tones[5]))
            if yy == ya or yy == yb - 1:
                for x in range(xa, xb + 1):
                    if not (l < x < r):
                        continue
                    uu = (x - l) / span
                    if yy == yb - 1:
                        c.put(x, yy, col(tones[5]))
                    elif uu < 0.80:
                        c.put(x, yy, col(_tc_band(uu, tones) + 1))
            elif yy == ya + 1:
                for x in range(xa + 1, min(xb, xa + 1 + int(span * 0.10))):
                    if l < x < r and (x - l) / span < 0.80:
                        c.put(x, yy, col(_tc_band((x - l) / span, tones) + 1))


def _tc_bark_lenticel(c, o, pre, left, right, col, tones, seed):
    """자작나무 — 매끈한 껍질에 가로 숨구멍 줄과 검은 상처."""
    ys = sorted(left)
    if not ys:
        return
    y0, y1 = ys[0], ys[-1] + 1
    rnd = random.Random(seed * 41 + 13)
    for _ in range(o.get("lenticels", 46)):
        y = rnd.randrange(y0 + 3, max(y0 + 4, y1 - 3))
        if y not in left:
            continue
        l, r = left[y], right[y]
        span = max(1, r - l)
        ln = max(2, int(span * rnd.uniform(0.10, 0.34)))
        x = int(l + span * rnd.uniform(0.06, 0.88))
        for dx in range(ln):
            if l < x + dx < r:
                c.put(x + dx, y, col(tones[5]))
        if rnd.random() < 0.5 and y + 1 in left:
            for dx in range(max(1, ln // 2)):
                if left[y + 1] < x + dx < right[y + 1]:
                    c.put(x + dx, y + 1, col(tones[4]))
    for _ in range(o.get("scars", 4)):
        y = rnd.randrange(y0 + 20, max(y0 + 21, y1 - 40))
        h = rnd.randint(9, 18)
        for dy in range(h):
            yy = y + dy
            if yy not in left:
                continue
            l, r = left[yy], right[yy]
            span = max(1, r - l)
            t = dy / max(1, h - 1)
            wdt = max(1, int(span * 0.09 * math.sin(math.pi * t) ** 0.9))
            x = int(l + span * rnd.uniform(0.30, 0.34))
            for dx in range(wdt):
                c.put(x + dx, yy, col(tones[5] if dx else tones[4]))


_TC_BARK = {"fissure": _tc_bark_fissure, "plate": _tc_bark_plate,
            "lenticel": _tc_bark_lenticel}


def _tc_knot(c, o, pre, left, right, cent, col, tones, ky, kw, kh):
    """옹이 — 어두운 심 + 링 + 좌상단 밝은 테두리."""
    if ky not in cent:
        return
    cx = int(cent[ky]) + o.get("knotOffset", -3)
    for dy in range(-kh - 2, kh + 3):
        for dx in range(-kw - 2, kw + 3):
            y = ky + dy
            if y not in left or not (left[y] < cx + dx < right[y]):
                continue
            e = (dx / max(1, kw)) ** 2 + (dy / max(1, kh)) ** 2
            if e <= 0.40:
                c.put(cx + dx, y, col(tones[5]))
            elif e <= 0.85:
                c.put(cx + dx, y, col(tones[4]))
            elif e <= 1.25:
                c.put(cx + dx, y, col(tones[5]))
            elif e <= 1.7 and dx + dy < 0:
                c.put(cx + dx, y, col(tones[1]))


def _tc_stub(c, o, pre, left, right, col, tones, by, side, length, thick):
    """가지 그루터기. 잘린 단면과 줄기에 지는 그림자가 있어야 붙어 보인다."""
    if by not in left:
        return
    for i in range(length):
        t = i / max(1, length - 1)
        th = max(3, int(thick * (1 - t * 0.4)))
        y = by - int(t * length * 0.40)
        x = (left[by] - i) if side < 0 else (right[by] + i)
        for k in range(th):
            tone = (tones[1] if k == 0 else
                    tones[5] if k >= th - 1 else
                    tones[2] if k < th / 2 else tones[4])
            c.put(x, y + k, col(tone))
    tip = (left[by] - length) if side < 0 else (right[by] + length)
    ty = by - int(length * 0.40)
    th = max(3, int(thick * 0.6))
    for k in range(th):
        c.put(tip, ty + k, col(tones[4] if 0 < k < th - 1 else tones[5]))
    for k in range(thick + 1):
        yy = by + thick + k
        if yy not in left:
            continue
        l, r = left[yy], right[yy]
        wdt = int((r - l) * 0.30)
        x0 = l + 1 if side < 0 else r - 1 - wdt
        for dx in range(wdt):
            if l < x0 + dx < r:
                c.put(x0 + dx, yy,
                      col(_tc_band((x0 + dx - l) / max(1, r - l), tones) - 2))


def _tc_moss(c, o, pre, left, right, seed):
    """이끼 — 가장자리가 너덜너덜한 매트.

    매끈한 반원으로 그리면 나뭇잎을 붙여 놓은 것처럼 보인다. 행마다 폭을
    1~2px 흔들고, 밝은 단은 윗면에 통으로 깔지 않고 점점이 얹는다.
    """
    if not o.get("moss"):
        return
    mr = pre["ramps"][o["moss"]]
    ys = sorted(left)
    y0, y1 = ys[0], ys[-1] + 1
    rnd = random.Random(seed * 71 + 11)
    for _ in range(o.get("mossCount", 5)):
        lo, hi = y0 + 8, max(y0 + 9, y1 - 46)
        if hi <= lo:
            continue
        my = rnd.randrange(lo, hi)
        mh = rnd.randint(16, 40)
        depth = rnd.uniform(0.14, 0.26)
        side = -1 if rnd.random() < 0.78 else 1
        ragged = [rnd.randint(-1, 1) for _ in range(mh)]
        for dy in range(mh):
            yy = my + dy
            if yy not in left:
                continue
            lobe = math.sin(math.pi * (dy / max(1, mh - 1))) ** 0.42
            span = max(1, right[yy] - left[yy])
            ww = max(0, int(span * depth * lobe) + ragged[dy])
            if ww <= 0:
                continue
            bx = left[yy] + 1 if side < 0 else right[yy] - 1 - ww
            for k in range(ww):
                x = bx + k
                if not (left[yy] <= x <= right[yy]):
                    continue
                tone = 1
                if dy < 3 and rnd.random() < 0.55:
                    tone = 3
                elif rnd.random() < 0.22:
                    tone = 2
                elif rnd.random() < 0.10:
                    tone = 0
                c.put(x, yy, resolve(mr[tone], pre))


# 담쟁이 잎 — 3갈래. 좌상단이 밝고 우하단이 어둡다.
_TC_IVY_LEAF = (("h.h.h", "hbbbh", ".bbd.", "..d.."),
                (".h.h.h.", "hhbbbhh", "hbbbbdh", ".bbbbd.", "..bbd..", "...d..."))
_TC_IVY_TONE = {"h": 3, "b": 2, "d": 0}


def _tc_ivy(c, o, pre, left, right, cent, seed):
    """담쟁이덩굴 — 줄기를 감아 오른다.

    2D 측면도에서 '감았다'를 만드는 건 원근이 아니라 **가려짐**이다. 진폭을
    줄기 폭보다 크게 잡아 실루엣 밖으로 나간 구간을 그리지 않으면, 뒤로
    돌아갔다 다시 앞으로 나오는 것으로 읽힌다.
    """
    ir = pre["ramps"][o.get("ivy", "leaf")]
    ys = sorted(cent)
    if not ys:
        return
    y0, y1 = ys[0], ys[-1] + 1
    rnd = random.Random(seed * 131 + 23)

    def put(x, y, tone):
        c.put(x, y, resolve(ir[max(0, min(4, tone))], pre))

    for _ in range(o.get("ivyStrands", 0)):
        top = y0 + rnd.randint(10, max(11, (y1 - y0) // 4))
        per = rnd.uniform(58, 96)
        phase = rnd.uniform(0, 6.28)
        over = rnd.uniform(1.15, 1.55)
        every = rnd.randint(5, 8)
        shade = 0
        n = 0
        for y in range(y1 - 1, top, -1):
            if y not in cent:
                continue
            l, r = left[y], right[y]
            half = max(2, (r - l) / 2)
            xi = int(round(cent[y] + math.sin(2 * math.pi * y / per + phase) * half * over))
            behind = not (l + 1 <= xi <= r - 2)
            if not behind:
                put(xi, y, 1)
                if rnd.random() < 0.35:
                    put(xi + 1, y, 0)
                if rnd.random() < 0.14:
                    put(xi - 1, y, 0)
            n += 1
            if n % every == 0 and not behind and rnd.random() < 0.82:
                every = rnd.randint(4, 10)
                n = 0
                shade = rnd.choice((0, 0, 0, -1, 1))
                grid = _TC_IVY_LEAF[1 if rnd.random() < 0.55 else 0]
                gw, gh = len(grid[0]), len(grid)
                sx, sy = xi - gw // 2 + rnd.randint(-1, 1), y - gh // 2
                for gy, row in enumerate(grid):
                    for gx, ch in enumerate(row):
                        if ch == ".":
                            continue
                        px, py = sx + gx, sy + gy
                        if py in left and left[py] - 2 <= px <= right[py] + 1:
                            put(px, py, _TC_IVY_TONE[ch] + shade)


def _tc_roots(c, o, pre, left, right, col, tones, legs):
    """밑동 뿌리. 폭만 넓히면 나팔이고, 부피를 가진 갈래여야 뿌리다."""
    ys = sorted(left)
    if not ys:
        return
    y1 = ys[-1] + 1
    top = max(ys[0], y1 - o.get("rootH", 0))
    if top >= y1:
        return
    w1 = o.get("w", [14, 20])[1]
    for side, reach, fat in legs:
        for y in range(top, y1):
            if y not in left:
                continue
            t = (y - top) / max(1, y1 - top)
            grow = (t ** 1.8) * reach * w1 * 0.9
            th = max(3, int((1 - t * 0.25) * w1 * 0.20 * fat))
            x0 = (left[y] - grow) if side < 0 else (right[y] + grow)
            for k in range(th):
                u = k / max(1, th - 1)
                tone = (tones[1] if u < 0.18 else tones[2] if u < 0.42
                        else tones[4] if u < 0.78 else tones[5])
                c.put(int(x0) + (k if side < 0 else -k), y, col(tone))


def op_tree_column(c, o, pre):
    """화면을 세로로 관통하는 고목.

    `bark`로 수종을 고른다 — `fissure`(참나무·깊은 균열), `plate`(소나무·비늘),
    `lenticel`(자작나무·가로 숨구멍). `trunks`와 `converge`로 쌍둥이 줄기를,
    `ivyStrands`로 담쟁이를 얹는다.
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    o = dict(o)
    o.setdefault("y0", 0)
    if not o.get("y1"):
        o["y1"] = c.h
    tones = _tc_tones(o.get("base", 2), o.get("lit", 4), o.get("dark", 0))
    seed = o.get("seed", 3)
    bark = _TC_BARK.get(o.get("bark", "fissure"), _tc_bark_fissure)

    trunks = o.get("trunks") or [[0, 1.0]]
    drawn = []
    for i, (dx, ws) in enumerate(trunks):
        left, right, cent = _tc_spine(o, dx, ws)
        _tc_body(c, o, pre, left, right, col, tones, seed + i * 3)
        bark(c, o, pre, left, right, col, tones, seed + i * 3)
        drawn.append((left, right, cent))

    # 부착물은 주 줄기에 건다.
    left, right, cent = drawn[0]
    knots = list(o.get("knots", ())) or list(o.get("hollows", ()))
    for k in knots:
        _tc_knot(c, o, pre, left, right, cent, col, tones, k[0], k[1], k[2])
    for s in o.get("stubs", ()):
        _tc_stub(c, o, pre, left, right, col, tones, s[0], s[1], s[2], s[3])
    if o.get("rootH"):
        legs = o.get("roots") or (((-1, .9, 1.0), (1, .8, .9)) if len(trunks) > 1
                                  else ((-1, .95, 1.0), (-1, .5, .7),
                                        (1, .8, .9), (1, .38, .6)))
        for (l_, r_, _), _t in zip(drawn, trunks):
            _tc_roots(c, o, pre, l_, r_, col, tones, legs)
    _tc_moss(c, o, pre, left, right, seed)
    if o.get("ivyStrands"):
        for (l_, r_, cn_) in drawn:
            _tc_ivy(c, o, pre, l_, r_, cn_, seed)


def op_branch_platform(c, o, pre):
    """이끼 낀 나뭇가지 발판 — 레퍼런스 구조의 뼈대.

    윗면은 밝은 이끼(잎 램프)라 캐릭터가 설 자리가 눈에 바로 들어오고,
    몸통은 따뜻한 목재라 초록 일변도로 흐르지 않는다. 아랫면은 그림자.
    양 끝은 좁아져 가지처럼 보이게 한다.
    """
    wood = pre["ramps"][o.get("wood", "wood")]
    moss = pre["ramps"][o.get("moss", "leaf")]
    x0, y, w = o["x"], o["y"], o["w"]
    th = o.get("thickness", 7)
    mt = o.get("mossH", 3)
    wb, wl, wd = o.get("base", 2), o.get("lit", 3), o.get("dark", 0)
    mb, ml = o.get("mossBase", 2), o.get("mossLit", 4)
    rnd = random.Random(o.get("seed", 5))
    taper = o.get("taper", 6)
    for i in range(w):
        x = x0 + i
        # 양 끝이 좁아진다
        edge = min(i, w - 1 - i)
        shrink = 0 if edge >= taper else int(round((taper - edge) / taper * (th - 2)))
        top = y + shrink // 2
        bot = y + th - shrink + shrink // 2
        for yy in range(top, bot):
            c.put(x, yy, resolve(wood[wb], pre))
        c.put(x, bot - 1, resolve(wood[wd], pre))
        if bot - top > 3:
            c.put(x, top + mt, resolve(wood[wl], pre))
        # 이끼 윗면 — 울퉁불퉁하게
        bump = (rnd.random() < 0.35) and edge > 1
        for k in range(mt + (1 if bump else 0)):
            yy = top - (1 if bump else 0) + k
            c.put(x, yy, resolve(moss[ml if k == 0 else mb], pre))
    # 아래로 늘어지는 그림자
    for i in range(w):
        if bayer(x0 + i, y + th, 0.55):
            c.put(x0 + i, y + th, resolve(wood[wd], pre))


def op_rope_bridge(c, o, pre):
    """로프 다리 — 늘어진 현수선 + 판자 슬랫 + 양끝 기둥.

    직선으로 그으면 다리가 아니라 선반이다. 중앙이 처져야(sag) 로프로 읽힌다.
    """
    wood = pre["ramps"][o.get("wood", "wood")]
    x0, x1, y = o["x0"], o["x1"], o["y"]
    sag = o.get("sag", 8)
    step = o.get("plank", 4)
    rope_i, plank_i, dark_i = o.get("rope", 1), o.get("plank_i", 3), o.get("dark", 0)
    span = max(1, x1 - x0)

    def curve(x):
        t = (x - x0) / span
        return y + int(round(sag * 4 * t * (1 - t)))

    # 손잡이 로프(위) + 바닥 로프
    for x in range(x0, x1 + 1):
        cy = curve(x)
        c.put(x, cy, resolve(wood[rope_i], pre))
        c.put(x, cy - o.get("rail", 9), resolve(wood[rope_i], pre))
    # 판자 슬랫
    for x in range(x0 + 2, x1 - 1, step):
        cy = curve(x)
        for k in range(o.get("plankW", 2)):
            for dy in range(o.get("plankH", 3)):
                c.put(x + k, cy + dy, resolve(wood[plank_i], pre))
            c.put(x + k, cy + o.get("plankH", 3), resolve(wood[dark_i], pre))
        # 손잡이와 잇는 줄
        if (x - x0) % (step * 3) == 0:
            for yy in range(cy - o.get("rail", 9), cy):
                c.put(x, yy, resolve(wood[rope_i], pre))
    # 양끝 기둥
    for px in (x0, x1):
        for yy in range(curve(px) - o.get("rail", 9) - 3, curve(px) + 4):
            c.put(px, yy, resolve(wood[plank_i], pre))
            c.put(px + 1, yy, resolve(wood[dark_i], pre))


def op_ladder(c, o, pre):
    """사다리 — 수직 이동 경로가 있다는 신호."""
    wood = pre["ramps"][o.get("wood", "wood")]
    x, y0, y1 = o["x"], o["y0"], o["y1"]
    w = o.get("w", 9)
    for yy in range(y0, y1):
        c.put(x, yy, resolve(wood[3], pre))
        c.put(x + 1, yy, resolve(wood[1], pre))
        c.put(x + w - 2, yy, resolve(wood[3], pre))
        c.put(x + w - 1, yy, resolve(wood[0], pre))
    for yy in range(y0 + 2, y1, o.get("step", 5)):
        for xx in range(x + 1, x + w - 1):
            c.put(xx, yy, resolve(wood[2], pre))
            c.put(xx, yy + 1, resolve(wood[0], pre))


OPS = {"fill": op_fill, "rect": op_rect, "vgradient": op_vgradient, "hills": op_hills,
       "canopy": op_hills, "band": op_band, "stamp": op_stamp, "scatter": op_scatter,
       "tile": op_tile, "clouds": op_clouds, "specks": op_specks, "rays": op_rays,
       "scanshade": op_scanshade, "vignette": op_vignette, "fringe": op_fringe,
       "autoshade": op_autoshade, "ground_plane": op_ground_plane,
       "scatter_depth": op_scatter_depth, "contact_shadow": op_contact_shadow,
       "texture": op_texture,
       "foliage": op_foliage, "panel": op_panel, "glow": op_glow,
       "clearing": op_clearing, "tree_column": op_tree_column,
       "branch_platform": op_branch_platform, "rope_bridge": op_rope_bridge,
       "ladder": op_ladder}


def render_scene(scene):
    import copy
    pre = copy.deepcopy(preset(scene["preset"]))
    # scene.json이 램프를 덮어쓸 수 있다. 밝기만 바꾸고 싶은데 프리셋을 새로
    # 만들어야 했던 문제 때문이다 — 프리셋은 여러 배경이 공유하므로 조용히
    # 바꾸면 안 되고, 그렇다고 배경 하나 때문에 키를 늘리는 것도 과하다.
    for name, ramp in (scene.get("ramps") or {}).items():
        if not isinstance(ramp, list) or not ramp:
            raise SystemExit(f"scene.ramps.{name}: hex 리스트여야 한다")
        pre["ramps"][name] = ramp
    if scene.get("ramps"):
        from bgcore import validate_preset
        validate_preset(scene["preset"] + "(scene override)", pre)
    w, h = scene.get("canvas", list(CANVAS))
    seamless = scene.get("seamless", False)
    layers = []
    for spec in scene["layers"]:
        c = Canvas(w, h, seamless)
        for o in spec.get("ops", []):
            fn = OPS.get(o["op"])
            if fn is None:
                raise SystemExit(f"unknown op {o['op']!r} — {sorted(OPS)}")
            fn(c, o, pre)
        layers.append((spec, c.img))
    return pre, layers


def composite(layers, size):
    from PIL import Image
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    for _, img in layers:
        out.alpha_composite(img)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scene")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--preview", help="확대 미리보기 PNG 경로(검수용, 에셋 아님)")
    ap.add_argument("--scale", type=int, default=3)
    args = ap.parse_args()

    with open(args.scene, encoding="utf-8") as f:
        scene = json.load(f)
    pre, layers = render_scene(scene)
    w, h = scene.get("canvas", list(CANVAS))
    comp = composite(layers, (w, h))

    os.makedirs(args.out_dir, exist_ok=True)
    bid = scene["id"]
    meta_layers = []
    for spec, img in layers:
        fn = f"{bid}_{spec['name']}.png"
        img.save(os.path.join(args.out_dir, fn))
        opaque = img.getchannel("A").getextrema()[0] == 255
        meta_layers.append({"name": spec["name"], "file": fn, "z": spec.get("z", 0),
                            "parallax": spec.get("parallax", 0.0), "opaque": opaque})
    comp.save(os.path.join(args.out_dir, f"{bid}_composite.png"))

    used = sorted({to_hex(p) for p in comp.getdata() if p[3]})
    meta = {"id": bid, "name": scene.get("name", bid), "preset": scene["preset"],
            "kind": pre.get("kind", "outdoor"),
            "layout": scene.get("layout", pre.get("layout", "ground")),
            "width": w, "height": h, "seamless": scene.get("seamless", False),
            "horizon": scene.get("horizon"), "groundTop": scene.get("groundTop"),
            "petAnchor": scene.get("petAnchor"),
            "composite": f"{bid}_composite.png", "layers": meta_layers,
            "palette": {"outlineReserved": "#2C2438", "colors": used,
                        "rampOverride": sorted(scene.get("ramps", {}))}}
    with open(os.path.join(args.out_dir, f"{bid}.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "scene.json"), "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False, indent=2)

    if args.preview:
        comp.convert("RGB").resize((w * args.scale, h * args.scale), 0).save(args.preview)
        print(f"preview: {args.preview} (x{args.scale})")
    print(f"written: {args.out_dir}  layers={len(meta_layers)} colors={len(used)}")


if __name__ == "__main__":
    main()
