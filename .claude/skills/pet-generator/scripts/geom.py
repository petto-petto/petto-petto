#!/usr/bin/env python3
"""그리드/스프라이트에서 정량 지표를 뽑는 공용 함수."""
import colorsys
import math


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hls(h):
    r, g, b = (c / 255 for c in hex_rgb(h))
    return colorsys.rgb_to_hls(r, g, b)


def scale_l(h, f):
    hh, ll, ss = hls(h)
    r, g, b = colorsys.hls_to_rgb(hh, max(0.0, min(1.0, ll * f)), ss)
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def hue_gap(a, b):
    ha, hb = hls(a)[0] * 360, hls(b)[0] * 360
    d = abs(ha - hb) % 360
    return min(d, 360 - d)


def components(points):
    """4-연결 덩어리 개수."""
    pts, seen, n = set(points), set(), 0
    for p in pts:
        if p in seen:
            continue
        n += 1
        stack = [p]
        seen.add(p)
        while stack:
            x, y = stack.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, y + dy)
                if q in pts and q not in seen:
                    seen.add(q)
                    stack.append(q)
    return n


def perimeter(points):
    pts = set(points)
    return sum(1 for (x, y) in pts
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
               if (x + dx, y + dy) not in pts)


def complexity(points):
    """둘레 / 같은 면적 원의 둘레. 원=1.0, 삐죽할수록 크다."""
    a = len(points)
    if not a:
        return 0.0
    return perimeter(points) / (2 * math.sqrt(math.pi * a))


def _anchor(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys)


def iou(a, b):
    """bbox 좌상단 기준으로 정렬한 뒤의 실루엣 겹침 비율."""
    if not a or not b:
        return 0.0
    ax, ay = _anchor(a)
    bx, by = _anchor(b)
    A = {(x - ax, y - ay) for x, y in a}
    B = {(x - bx, y - by) for x, y in b}
    return len(A & B) / len(A | B)


def aligned_diff(fa, fb, search=3):
    """두 프레임을 최적 오프셋으로 맞춘 뒤 남는 차이 비율 (0.0~1.0).

    fa, fb 는 {(x, y): colour} 딕셔너리. 스프라이트를 통째로 민 프레임은
    정렬하면 0이 되므로, 평행이동이 아닌 '실제로 다시 그린 양'만 남는다.
    """
    if not fa:
        return 0.0
    best = None
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            shifted = {(x + dx, y + dy): c for (x, y), c in fb.items()}
            keys = set(fa) | set(shifted)
            d = sum(1 for k in keys if fa.get(k) != shifted.get(k))
            best = d if best is None else min(best, d)
    return best / len(fa)


def classify(legend, body_hex):
    """legend 를 outline / body / shadow / highlight / sub / accent 로 나눈다.

    body 에서 파생되는 색(명도 배율)은 자동으로 그림자·하이라이트로 인식하고,
    나머지 유채색 중 몸통색과 색상환 90도 이상 떨어진 것을 액센트로 본다.
    """
    from budget import OUTLINE
    shadow = scale_l(body_hex, 0.80).upper()
    highlight = scale_l(body_hex, 1.15).upper()
    roles = {}
    for ch, hexcol in legend.items():
        h = hexcol.upper()
        if h == OUTLINE.upper():
            roles[ch] = "outline"
        elif h == body_hex.upper():
            roles[ch] = "body"
        elif h == shadow:
            roles[ch] = "shadow"
        elif h == highlight:
            roles[ch] = "highlight"
        elif hue_gap(h, body_hex) >= 90:
            roles[ch] = "accent"
        else:
            roles[ch] = "sub"
    return roles, shadow, highlight


def proportions(rows, transparent="."):
    """등신(머리 대비 전체 높이)과 최대폭 위치를 잰다.

    '머리가 몸통보다 크다'는 이 도감의 아트 스타일 전체를 지탱하는 규칙인데,
    지금까지 프로즈로만 적혀 있어서 한 번도 강제되지 않았다. 실제로 progression.py
    의 IoU 하한을 맞추려고 머리를 줄이고 몸통을 키우면 IoU는 통과하고 캐릭터는
    말상이 된다 — 그 사고를 여기서 잡는다.

    반환값
        H            실루엣 전체 높이
        widest_pos   가장 넓은 행의 위치 (0=정수리, 1=발바닥)
        neck         목선 y (검출 실패 시 None)
        ratio        등신 = 전체 높이 / 머리 높이 (목선 검출 실패 시 None)
    """
    prof = []
    for y, row in enumerate(rows):
        xs = [x for x, c in enumerate(row) if c != transparent]
        if xs:
            prof.append((y, max(xs) - min(xs) + 1))
    if not prof:
        return None
    top, bot = prof[0][0], prof[-1][0]
    H = bot - top + 1
    w = {y: v for y, v in prof}

    # 머리 폭은 위쪽 40% 안에서 잰다. 귀·갈기·뿔이 머리 위에 얹히는 구조라
    # 이 구간의 최대폭이 곧 '머리 덩어리 폭'이다.
    band = top + max(2, int(H * 0.4))
    hi = max(v for y, v in prof if y <= band)
    ymax = min(y for y, v in prof if y <= band and v == hi)
    gmax = max(v for _, v in prof)
    gy = min(y for y, v in prof if v == gmax)

    # 목선 = 머리 최대폭 아래에서 처음 나타나는 뚜렷한 잘록함
    neck = None
    for y in range(ymax + 2, bot):
        v = w.get(y, 0)
        if v and v <= w.get(y - 1, 10 ** 6) and v <= w.get(y + 1, 10 ** 6) and v < hi * 0.8:
            neck = y
            break

    return {
        "top": top, "bot": bot, "H": H,
        "head_width": hi, "head_width_y": ymax,
        "max_width": gmax, "max_width_y": gy,
        "widest_pos": (gy - top) / H,
        "neck": neck,
        "ratio": (H / (neck - top)) if neck and neck > top else None,
    }


def symmetry(rows, roles, transparent="."):
    """좌우 대칭 — 축 어긋남과 장식 배치 대칭을 잰다.

    32px 캔버스의 대칭축은 픽셀 경계(예: x=15.5)다. 그래서 좌우 대칭이어야 할
    요소는 **짝수 폭**이어야 중앙에 놓인다. 3px짜리 블레이즈나 홀수 개 구슬은
    원리적으로 1px 밀리고, 얼굴에서 그게 제일 먼저 보인다.

    두 가지를 따로 잰다.

    axis_drift  머리 축과 발 축의 어긋남. 부위마다 축이 다르면 자세가 아니라
                "부위가 미끄러진 것"으로 읽힌다(실측 사고: 머리 17.5 / 몸통 13.5 /
                다리 15.5로 갈린 스프라이트가 무너져 보인다는 지적을 받았다).
    deco_symmetry  장식(보조색·액센트) 픽셀이 좌우 짝을 이루는 비율.
                거울 위치가 **실루엣 밖**이면 제외한다 — 꼬리처럼 한쪽에만 붙는
                부속물을 실패로 잡지 않기 위해서다. 거울 위치가 **그림자·하이라이트**
                여도 제외한다 — 좌상단 광원 때문에 생기는 정상적인 비대칭이다.
                남는 건 순수한 '배치 실수'뿐이다.

    roles 는 classify() 가 준 {문자: 역할} 매핑.
    """
    prof = []
    for y, row in enumerate(rows):
        xs = [x for x, c in enumerate(row) if c != transparent]
        if xs:
            prof.append((y, min(xs), max(xs)))
    if not prof:
        return None
    top, bot = prof[0][0], prof[-1][0]
    H = bot - top + 1
    band = top + max(2, int(H * 0.4))
    upper = [t for t in prof if t[0] <= band]
    hi = max(b - a + 1 for _, a, b in upper)
    hy, ha, hb = next(t for t in upper if t[2] - t[1] + 1 == hi)
    head_axis = (ha + hb) / 2
    _, fa, fb = prof[-1]
    foot_axis = (fa + fb) / 2

    grid = {(x, y): c for y, row in enumerate(rows)
            for x, c in enumerate(row) if c != transparent}
    deco = {p for p, c in grid.items() if roles.get(c) in ("sub", "accent")}
    considered, mismatched = 0, []
    for (x, y) in deco:
        mx = int(round(2 * head_axis - x))
        m = grid.get((mx, y))
        if m is None:                                   # 부속물 — 반대쪽에 몸이 없다
            continue
        if roles.get(m) in ("shadow", "highlight"):     # 광원 때문 — 정상
            continue
        considered += 1
        if (mx, y) not in deco:
            mismatched.append((x, y))
    ratio = 1 - len(mismatched) / considered if considered else 1.0
    return {
        "head_axis": head_axis, "head_axis_y": hy,
        "foot_axis": foot_axis,
        "axis_drift": abs(head_axis - foot_axis),
        "deco_symmetry": ratio,
        "deco_considered": considered,
        "deco_mismatched": sorted(mismatched, key=lambda p: (p[1], p[0])),
    }
