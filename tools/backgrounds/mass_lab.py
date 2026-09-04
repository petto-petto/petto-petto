#!/usr/bin/env python3
"""잎덩어리·지면 실험대.

배경 전체를 굽지 않고 이 둘만 격리해 반복한다. 승인된 결과를 `bg_render.py`의
`foliage` / `ground_plane`으로 옮긴다. 나무를 `tree_column`으로 옮겼을 때와 같은
절차다.

규칙은 배경 스킬과 같다 — 색은 램프 참조만, 광원은 좌상단 고정, 안티에일리어싱
없음, 정수 픽셀.

    python3 tools/backgrounds/mass_lab.py sheet <out_prefix> [scale]
    python3 tools/backgrounds/mass_lab.py apply <scene.json> <out-dir> [preview.png]

`apply`는 새 구현을 꽂은 채로 실제 씬을 굽는다 — 게이트를 실제 배경에서 재기 위한
것이다. 랩에서만 예뻐 보이고 배경에 넣으면 게이트가 깨지는 일을 막는다.
"""

import math
import random
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2] / ".claude/skills/background-generator"
sys.path.insert(0, str(SKILL / "scripts"))

from PIL import Image, ImageDraw  # noqa: E402

import bg_render as R  # noqa: E402
from bgcore import bayer, preset, resolve  # noqa: E402

FW, FH = 300, 150          # 잎덩어리 판
GW, GH = 300, 110          # 지면 판


# ================================================================ 잎덩어리

def foliage_v2(c, o, pre):
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
        step = R.snap_period(c.w, step)

    kn = [rnd.uniform(-1, 1) for _ in range(4)]

    def crest(x):
        t = (x - x0) / max(1, w)
        return sum(k * math.sin(2 * math.pi * (i + 1) * t * o.get("crestFreq", 1.6)
                                + k * 3) for i, k in enumerate(kn)) / len(kn)

    lp = [rnd.uniform(0, 6.3) for _ in range(3)]
    lw = max(24.0, w / o.get("litClumps", 3.2))
    ca = o.get("crest", 0.30)

    lobes = []
    y = y0
    while y <= y0 + h:
        x = x0 if c.seamless else x0 - r1
        while x < (x0 + w if c.seamless else x0 + w + r1):
            jx = x + (rnd.randint(-2, 2) if not c.seamless else 0)
            jy = y + rnd.randint(-2, 2) + int(round(crest(x) * ca * h))
            lobes.append((jy, jx, rnd.randint(r0, r1),
                          rnd.uniform(0, 6.3), rnd.uniform(0, 6.3)))
            x += step
        y += max(3, step - 2)
    # 바닥 줄은 크레스트를 받지 않는다. 윗변만 올리면 아래에 구멍이 남는다.
    x = x0 - r1
    while x < x0 + w + r1:
        lobes.append((y0 + h - rnd.randint(0, max(1, r0 // 2)), x + rnd.randint(-2, 2),
                      rnd.randint(r0, r1), rnd.uniform(0, 6.3), rnd.uniform(0, 6.3)))
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
        lit_rim = g < o.get("litSpan", 0.45)
        deep = g > 0.82

        prof = [rr * (1.0 + 0.20 * math.sin(3 * a * math.tau / 48 + k3)
                      + 0.11 * math.sin(5 * a * math.tau / 48 + k5))
                for a in range(48)]

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
        if lit_rim and rnd.random() < 0.5:
            for _ in range(rnd.randint(1, 2)):
                ang = rnd.uniform(math.pi * 1.15, math.pi * 1.85)
                rad = prof[int((ang % math.tau) / math.tau * 48) % 48]
                sx = lx + int(round(math.cos(ang) * rad))
                sy = ly + int(round(math.sin(ang) * rad))
                for k in range(rnd.randint(1, 2)):
                    c.put(sx + int(round(math.cos(ang) * k)),
                          sy + int(round(math.sin(ang) * k)), col(rim + d))

    # 마른 잔가지 — 덩어리가 식물이라는 신호.
    for _ in range(o.get("twigs", 3)):
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


# ================================================================ 지면

def ground_v2(c, o, pre):
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


# ================================================================ 실행

FOLIAGE_SPEC = {
    "box": [0, 24, FW, 78], "ramp": "mid", "base": 1, "rim": 3, "shadow": 0,
    "r": [15, 27], "spacing": 1.1, "rimW": 6, "depthRange": 1, "seed": 23,
    "fillBelow": FH, "crest": 0.30, "crestFreq": 1.6, "twigs": 4, "litSpan": 0.45,
}
GROUND_SPEC = {
    "y": 6, "h": GH - 6, "ramp": "wood", "far": 3, "near": 0, "cell": [4, 30],
    "seed": 5, "edge": "leaf.2", "edgeH": 6, "furrow0": 1, "furrowShift": 2,
    "furrowStrength": 0.7, "markShift": -1,
    "patches": 150, "pebbles": 26, "pebbleMax": 2, "debris": 10,
}


def render(fn, spec, w, h, pre, bgramp="sky", bgidx=1):
    c = R.Canvas(w, h, False)
    bg = resolve(pre["ramps"][bgramp][bgidx], pre)
    for y in range(h):
        for x in range(w):
            c.put(x, y, bg)
    fn(c, spec, pre)
    return c.img.convert("RGB")


def sheet(panels, out, scale):
    pad, gap, top = 10, 14, 22
    w = sum(p[1].width * scale for p in panels) + gap * (len(panels) - 1) + pad * 2
    h = max(p[1].height for p in panels) * scale + top + pad
    img = Image.new("RGB", (w, h), (18, 20, 18))
    d = ImageDraw.Draw(img)
    x = pad
    for name, p in panels:
        big = p.resize((p.width * scale, p.height * scale), Image.NEAREST)
        img.paste(big, (x, top))
        d.text((x + 2, 6), name, fill=(240, 235, 220))
        x += big.width + gap
    img.save(out)
    print(f"{out}  {img.size[0]}x{img.size[1]}")


def install():
    """새 구현을 op 표에 꽂는다.

    원경 잎덩어리(`crest` 키가 없는 것)는 기존 구현 그대로 둔다 — 원경의 윗변이
    곧 하늘의 아랫경계라, 흔들면 하늘이 조각나고 조각난 하늘은 좌우 광원 방향이
    없어 게이트 판정이 디더 잡음에 좌우된다.
    """
    orig = R.op_foliage

    def dispatch(c, o, pre):
        (foliage_v2 if "crest" in o else orig)(c, o, pre)

    R.OPS["foliage"] = dispatch
    R.OPS["ground_plane"] = ground_v2


def main():
    mode = sys.argv[1]
    if mode == "sheet":
        prefix = sys.argv[2]
        scale = int(sys.argv[3]) if len(sys.argv) > 3 else 3
        pre = preset(sys.argv[4] if len(sys.argv) > 4 else "petroom_grove")
        f_now = render(R.op_foliage, FOLIAGE_SPEC, FW, FH, pre)
        f_new = render(foliage_v2, FOLIAGE_SPEC, FW, FH, pre)
        g_now = render(R.op_ground_plane, GROUND_SPEC, GW, GH, pre, "mid", 1)
        g_new = render(ground_v2, GROUND_SPEC, GW, GH, pre, "mid", 1)
        for nm, im in (("foliage_now", f_now), ("foliage_new", f_new),
                       ("ground_now", g_now), ("ground_new", g_new)):
            im.save(f"{prefix}_{nm}.png")
        sheet([("foliage 현재", f_now), ("foliage 개선안", f_new)],
              f"{prefix}_foliage.png", scale)
        sheet([("ground 현재", g_now), ("ground 개선안", g_new)],
              f"{prefix}_ground.png", scale)
    elif mode == "apply":
        install()
        scene, out = sys.argv[2], sys.argv[3]
        argv = ["bg_render.py", scene, "--out-dir", out]
        if len(sys.argv) > 4:
            argv += ["--preview", sys.argv[4], "--scale", "2"]
        sys.argv = argv
        R.main()
    else:
        raise SystemExit("mode: sheet | apply")


if __name__ == "__main__":
    main()
