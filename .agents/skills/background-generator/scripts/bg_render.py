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
    """뒤로 물러나는 지면. 배경에 투시를 만드는 핵심 op.

    사이드뷰에는 소실점이 없지만 지면은 여전히 위로 갈수록 멀다. 세 가지를
    행마다 같이 움직여서 그 깊이를 만든다.
      - 톤: 위(먼 쪽)는 밝고 채도가 낮은 단, 아래(가까운 쪽)는 어두운 단
      - 텍스처 셀 폭: 위로 갈수록 좁아진다(수렴)
      - 가로 결 간격: 위로 갈수록 촘촘해진다(압축)
    """
    ramp = pre["ramps"][o["ramp"]]
    y0, h = o["y"], o["h"]
    fi, ni = o.get("far", 3), o.get("near", 0)
    cw0, cw1 = o.get("cell", [2, 7])
    rnd = random.Random(o.get("seed", 11))
    mark_i = o.get("markShift", -1)
    for row in range(h):
        y = y0 + row
        t = row / max(1, h - 1)
        f = fi + (ni - fi) * t
        lo, hi = int(math.floor(f)), int(math.ceil(f))
        lo = max(0, min(len(ramp) - 1, lo)); hi = max(0, min(len(ramp) - 1, hi))
        frac = f - math.floor(f)
        c_lo, c_hi = resolve(ramp[lo], pre), resolve(ramp[hi], pre)
        for x in range(c.w):
            c.put(x, y, c_hi if bayer(x, y, frac) else c_lo)
        # 세로 셀 경계 — 폭이 t에 따라 넓어진다
        cw = max(2, int(round(cw0 + (cw1 - cw0) * t)))
        if c.seamless:
            cw = snap_period(c.w, cw)
        base_i = max(0, min(len(ramp) - 1, int(round(f)) + mark_i))
        mark = resolve(ramp[base_i], pre)
        off = 0 if c.seamless else rnd.randrange(cw)
        for x in range(c.w):
            if (x + off + (row * 3 if not c.seamless else 0)) % cw == 0:
                c.put(x, y, mark)
    # 가로 결 — 아래로 갈수록 간격이 넓어진다(위쪽이 압축돼 보인다)
    step, row, k = o.get("furrow0", 2), 0, 0
    while row < h:
        y = y0 + row
        t = row / max(1, h - 1)
        f = fi + (ni - fi) * t
        band_i = max(0, min(len(ramp) - 1, int(round(f)) + o.get("furrowShift", 1)))
        col = resolve(ramp[band_i], pre)
        for x in range(c.w):
            if bayer(x, y, o.get("furrowStrength", 0.55)):
                c.put(x, y, col)
        k += 1
        step = o.get("furrow0", 2) + k
        row += step
    if o.get("edge"):
        ec = resolve(o["edge"], pre)
        for y in range(y0, y0 + o.get("edgeH", 2)):
            for x in range(c.w):
                c.put(x, y, ec)


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
    """겹친 잎 로브 덩어리 — 실루엣 하나가 아니라 '덩어리들'을 그린다.

    평평함의 진짜 원인은 큰 매스가 단색이라는 것이다. 실루엣 윤곽만 예쁘게
    따면 안쪽은 여전히 한 색이다. 이 op은 상자를 로브(원)로 채우고 로브마다
    좌상단 림라이트와 우하단 그림자를 붙인다 — 잎 하나하나가 아니라 잎
    '덩어리' 단위로 명암이 생겨서 구조적 엣지가 실제로 늘어난다.

    뒤(작은 y)의 로브부터 그려서 앞의 로브가 뒤를 가린다(겹침 = 깊이 단서).
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    x0, y0, w, h = o["box"]
    r0, r1 = o.get("r", [5, 9])
    base, rim, shad = o.get("base", 1), o.get("rim", 3), o.get("shadow", 0)
    rnd = random.Random(o.get("seed", 7))
    step = max(3, int(((r0 + r1) / 2) * o.get("spacing", 1.15)))
    jit = o.get("jitter", 2)
    if c.seamless:
        step = snap_period(c.w, step)
        jit = 0            # 지터가 있으면 좌우 끝 로브가 어긋난다
    lobes = []
    y = y0
    while y <= y0 + h:
        x = x0 if c.seamless else x0 - r1
        while x < (x0 + w if c.seamless else x0 + w + r1):
            rr = rnd.randint(r0, r1)
            jx = x + (rnd.randint(-2, 2) if not c.seamless else 0)
            jy = y + rnd.randint(-2, 2)
            lobes.append((jy, jx, rr))
            x += step
        y += max(3, step - 2)
    depth_tone = o.get("depthTone", True)
    av = o.get("avoid")
    for ly, lx, rr in sorted(lobes):
        if av and av[0] - rr <= lx <= av[1] + rr and av[2] - rr <= ly <= av[3] + rr:
            continue
        t = (ly - y0) / max(1, h)
        d = int(round((t - 0.5) * o.get("depthRange", 1))) if depth_tone else 0
        for dy in range(-rr, rr + 1):
            for dx in range(-rr, rr + 1):
                if dx * dx + dy * dy > rr * rr:
                    continue
                px, py = lx + dx, ly + dy
                if not (y0 - r1 <= py <= y0 + h + r1):
                    continue
                # 로브 안쪽까지 광원 방향으로 기울인다.
                # 테두리에만 림라이트를 넣고 안쪽을 단색으로 두면, 로브가 아무리
                # 많아도 국소 명암이 없어 '평평한 잎 벽'이 된다(bg_check의
                # 광원 창 검사가 정확히 이걸 잡는다).
                u = (dx + dy) / (2.0 * rr)          # -0.7(좌상) ~ +0.7(우하)
                step = int(round(-u * o.get("spread", 2.2)))
                edge = dx * dx + dy * dy > (rr - o.get("rimW", 2)) ** 2
                if edge and dx + dy < -rr * 0.30:
                    c.put(px, py, col(rim + d))
                elif edge and dx + dy > rr * 0.30:
                    c.put(px, py, col(shad + d))
                else:
                    c.put(px, py, col(base + d + step))
    if o.get("fillBelow"):
        # 덩어리 아래를 베이스색으로 메워 배경이 비치지 않게
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


def op_tree_column(c, o, pre):
    """화면을 세로로 관통하는 고목 줄기.

    직사각형으로 그리면 기둥·전봇대가 된다. 나무로 읽히려면 셋이 필요하다.
      - 굽이: 중심선이 사인으로 흔들리고 아래로 갈수록 굵어진다
      - 수피 결: 중심선과 같은 곡률의 세로 홈 2~3줄 (직선이면 나무결이 아니다)
      - 밑동/가지 벌어짐: 위아래 끝에서 폭이 급히 넓어진다
    좌상단 광원이라 왼쪽 가장자리가 밝고 오른쪽이 어둡다.
    """
    ramp = pre["ramps"][o["ramp"]]

    def col(i):
        return resolve(ramp[max(0, min(len(ramp) - 1, i))], pre)

    x0 = o["x"]
    w0, w1 = o.get("w", [14, 20])          # 위 폭 -> 아래 폭
    y0, y1 = o.get("y0", 0), o.get("y1", c.h)
    base, lit, dark = o.get("base", 2), o.get("lit", 4), o.get("dark", 0)
    sway, per = o.get("sway", 4), o.get("period", 90)
    edge = resolve(o["edge"], pre) if o.get("edge") else None
    phase = o.get("phase", 0.0)
    rnd = random.Random(o.get("seed", 3))
    span = max(1, y1 - y0)
    centers, widths = {}, {}
    for y in range(y0, y1):
        t = (y - y0) / span
        cx = x0 + sway * math.sin(2 * math.pi * (y - y0) / max(1e-6, per) + phase)
        w = w0 + (w1 - w0) * t
        # 밑동과 가지 벌어짐
        if t > 0.88:
            w += (t - 0.88) / 0.12 * o.get("flare", 6)
        if t < 0.08:
            w += (0.08 - t) / 0.08 * o.get("flareTop", 4)
        centers[y], widths[y] = cx, w
        l, r = int(round(cx - w / 2)), int(round(cx + w / 2))
        # 원통 단면 — 폭을 가로질러 밝기가 연속으로 떨어져야 기둥이 아니라
        # 나무로 읽힌다. 2px 하이라이트 + 3px 그림자만으로는 납작한 리본이 된다.
        span_w = max(1, r - l)
        for x in range(l, r):
            u = (x - l) / span_w
            if u < 0.12:
                idx = base
            elif u < 0.34:
                idx = lit
            elif u < 0.60:
                idx = base + 1
            elif u < 0.80:
                idx = base
            else:
                idx = dark
            c.put(x, y, col(idx))
        # 윤곽 — 안개 위에서 줄기가 떠 보이려면 양쪽에 어두운 테두리가 필요하다
        if edge is not None:
            c.put(l, y, edge)
            c.put(r - 1, y, edge)
    # 수피 결 — 줄기와 같은 곡률로 흐른다
    for gi in range(o.get("grooves", 3)):
        off = rnd.uniform(-0.28, 0.30)
        tone = base - 1 if gi % 2 == 0 else base + 1
        for y in range(y0, y1):
            if (y + gi * 7) % 11 < 8:       # 끊어진 결
                gx = int(round(centers[y] + off * widths[y]))
                c.put(gx, y, col(tone))
    # 줄기에 붙은 이끼 — 광원 쪽(왼쪽)에만
    if o.get("moss"):
        mr = pre["ramps"][o["moss"]]
        for _ in range(o.get("mossCount", 5)):
            my = rnd.randrange(y0 + 4, max(y0 + 5, y1 - 4))
            h = rnd.randint(3, 7)
            for dy in range(h):
                yy = my + dy
                if yy not in centers:
                    continue
                ww = int(widths[yy] * rnd.uniform(0.16, 0.30))
                lx = int(round(centers[yy] - widths[yy] / 2))
                for k in range(ww):
                    c.put(lx + 1 + k, yy,
                          resolve(mr[2 if dy % 2 else 3], pre))
    # 나무 구멍 — 레퍼런스의 어두운 동공
    for (hy, hw, hh) in o.get("hollows", []):
        if hy not in centers:
            continue
        cx = centers[hy]
        for dy in range(-hh, hh + 1):
            for dx in range(-hw, hw + 1):
                if (dx / hw) ** 2 + (dy / hh) ** 2 <= 1.0:
                    c.put(int(cx) + dx, hy + dy, col(0))
                elif (dx / hw) ** 2 + (dy / hh) ** 2 <= 1.35 and dx + dy < 0:
                    c.put(int(cx) + dx, hy + dy, col(base + 1))


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
