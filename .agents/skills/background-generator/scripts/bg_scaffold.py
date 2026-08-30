#!/usr/bin/env python3
"""프리셋과 캔버스 크기를 골라 바로 렌더 가능한 scene.json 초안을 찍어준다.

빈 파일에서 시작하지 않는다 — 게이트를 통과하는 구도(4레이어, 물러나는 지면,
깊이 단서 여섯 개)를 이미 갖춘 초안을 받아 거기서 고친다.

크기는 고정이 아니다. 모든 상수가 캔버스 높이에 비례해 스케일된다
(`bgcore.geom`). 스탬프만 정수배 확대라 애매한 배율에서 상대 크기가 흔들리는데,
그건 뿌리는 개수로 메운다.

Usage:
    python3 bg_scaffold.py --preset forest --id bg_004 --slug misty_grove \
        --name "안개 숲" --root ~/Projects/picxel-game > /tmp/bg_004.json
    python3 bg_scaffold.py --preset sky --size 560x240 --id bg_005 ...
"""
import argparse
import random
import json
import os
import sys

import bg_pillow_gate  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgcore import CANVAS, geom, preset, size_note



# 지형별 식생·소품. 팔레트만 갈아입히면 '보라색 숲'을 동굴이라 부르게 된다 —
# 색은 주제를 절반만 만든다. 나머지 절반은 무엇이 서 있느냐다.
TERRAIN_PROPS = {
    "forest":  {"tall": "tree_pine", "round": "tree_round", "low": "bush",
                "floor": ["grass_tuft", "flower"], "foliage": True},
    "swamp":   {"tall": "tree_pine", "round": "tree_round", "low": "bush",
                "floor": ["grass_tuft", "mushroom"], "foliage": True},
    "sky":     {"tall": "tree_pine", "round": "tree_round", "low": "bush",
                "floor": ["grass_tuft", "flower"], "foliage": True},
    "snow":    {"tall": "tree_pine", "round": None, "low": "rock",
                "floor": ["grass_tuft"], "foliage": True, "ground": "light"},
    "desert":  {"tall": "cactus", "round": None, "low": "rock",
                "floor": ["grass_tuft"], "foliage": False, "ground": "wood"},
    "ruins":   {"tall": "spire", "round": None, "low": "rock",
                "floor": ["grass_tuft"], "foliage": False},
    "cave":    {"tall": "spire", "round": None, "low": "rock",
                "floor": [], "foliage": False, "ground": "near"},
    "volcano": {"tall": "spire", "round": None, "low": "rock",
                "floor": [], "foliage": False, "ground": "near"},
    "ocean":   {"tall": None, "round": "tree_round", "low": "rock",
                "floor": ["grass_tuft"], "foliage": True},
}


def terrain_props(pre_name):
    """프리셋의 terrain(없으면 mood로 추론)에 맞는 소품 세트."""
    pre = preset(pre_name)
    t = pre.get("terrain")
    if not t:
        blob = " ".join(pre.get("mood", [])) + " " + pre.get("label", "") + " " + pre_name
        for key, props in TERRAIN_PROPS.items():
            if key in blob.lower():
                t = key
                break
    if not t:
        src = pre.get("source", "")
        t = "forest" if "mood:" not in src else "forest"
    return TERRAIN_PROPS.get(t, TERRAIN_PROPS["forest"])


def darker_ramp(pre_name, a, b):
    """두 램프 중 0단이 더 어두운 쪽 이름."""
    import colorsys
    from bgcore import hex_rgba
    R = preset(pre_name)["ramps"]

    def L(h):
        r, g, bb = (c / 255 for c in hex_rgba(h)[:3])
        return colorsys.rgb_to_hls(r, g, bb)[1]
    return a if L(R[a][0]) <= L(R[b][0]) else b


def auto_tone(pre, ground_hint=None):
    """팔레트를 실측해 레이어별 램프 단계를 고른다.

    톤 인덱스를 프리셋마다 손으로 박아 두면 새 프리셋마다 '원경이 하늘과 붙는다',
    '지면이 중경과 붙는다'를 다시 겪는다. 그래서 실측해서 고른다.

    고를 때 보는 건 **단일 단이 아니라 실제로 칠해지는 3단의 평균**이다.
    op들이 base / base+1 / base+2 를 함께 쓰기 때문에, base 하나만 보고 고르면
    렌더된 매스의 평균 명도가 의도보다 한참 위로 뜬다(실제로 다섯 팔레트가
    똑같이 far dL=0.025로 실패했다 — 팔레트가 아니라 이 선택이 문제였다).

    그리고 base+2가 램프 끝에서 잘리지 않게 인덱스를 0..len-3으로 제한한다.
    잘리면 그 매스는 단색이 되어 3톤·광원 검사가 동시에 무너진다.
    """
    import colorsys
    from bgcore import hex_rgba

    def L(h):
        r, g, b = (c / 255 for c in hex_rgba(h)[:3])
        return colorsys.rgb_to_hls(r, g, b)[1]

    R = pre["ramps"]
    STEP = 0.20                       # 레이어 간 목표 명도 간격

    def trio(ramp, i):
        return sum(L(ramp[min(len(ramp) - 1, i + k)]) for k in range(3)) / 3.0

    def choose(ramp, target):
        # base-2 ~ base+2 가 모두 램프 안에 있어야 한다. 끝에 붙이면 foliage의
        # spread가 잘려 로브 절반이 단색이 되고, 광원 창 검사가 50%로 떨어진다.
        lo_i, hi_i = 1, max(1, len(ramp) - 3)
        return min(range(lo_i, hi_i + 1), key=lambda i: abs(trio(ramp, i) - target))

    sky_l = trio(R["sky"], max(0, len(R["sky"]) - 3))
    fi = choose(R["far"], sky_l - STEP)
    mi = choose(R["mid"], trio(R["far"], fi) - STEP)
    # 지면은 한 단이 아니라 먼 쪽(밝음)~가까운 쪽(어두움) 구간 전체가 칠해진다.
    # 그래서 '가까운 쪽 단'이 아니라 **구간 평균**을 목표에 맞춘다. 끝 단만 보고
    # 고르면 실제 평균이 목표보다 한 단 위로 떠서 중경과 붙는다.
    gp = ground_hint if (ground_hint and ground_hint in R) else ("wood" if "wood" in R else "near")
    gr = R[gp]
    # 지면 뒤에 실제로 깔려 있는 건 중경의 '평균'이 아니라 중경 잎덩어리가
    # fillBelow로 깐 **그림자 톤(base-1)** 이다. 평균을 기준으로 잡으면 지면이
    # 그 그림자 톤과 명도가 겹쳐 분리가 깨진다(실측: dL 0.078).
    target = L(R["mid"][max(0, mi - 1)]) - STEP

    def band_mean(near_i):
        far_i = max(0, min(len(gr) - 1, near_i + 3))
        a_, b_ = min(near_i, far_i), max(near_i, far_i)
        return sum(L(gr[k]) for k in range(a_, b_ + 1)) / (b_ - a_ + 1)

    ni = min(range(len(gr)), key=lambda i: abs(band_mean(i) - target))
    # 지면의 가장 어두운 단을 램프 바닥(0단)까지 내리지 않는다. 0단을 지면이
    # 다 써 버리면 그 위에 얹을 접지 그림자가 지면과 같은 색이 되어 사라진다
    # (어두운 지형 — 동굴·화산에서 실제로 그림자가 1%까지 떨어졌다).
    ni = max(1, ni)
    lo = max(0, min(len(gr) - 1, ni + 3))      # 지면은 먼 쪽(위)이 밝다
    return {"far": (fi, min(len(R["far"]) - 1, fi + 2)),
            "mid": (mi, min(len(R["mid"]) - 1, mi + 2)),
            "gp": (gp, lo, ni)}


def outdoor(pre_name, d, W, H):
    """야외 4레이어 기본 구도 — 사이드뷰 + 바닥 깊이.

    소실점은 없다. 깊이는 여섯 단서를 겹쳐 만든다.
      1. 크기 기울기   scatter_depth가 뒤쪽 요소를 작게 찍는다
      2. 겹침          같은 op이 y 순으로 그려 앞이 뒤를 가린다
      3. 명도 계단     레이어마다 램프 인덱스를 벌린다
      4. 대기 원근     뒤로 갈수록 하늘색에 가깝게
      5. 지면 압축     ground_plane이 위로 갈수록 셀·결을 좁힌다
      6. 접지 그림자   수목 그림자 띠 + contact_shadow
    여기에 foliage/panel이 매스 안쪽에 3톤을 넣어 평평함을 없앤다.
    """
    g = geom(W, H)
    px, cnt, sc = g["px"], g["count"], g["stamp"]
    # 손으로 맞춰 검증한 프리셋은 그대로 쓰고, 새 프리셋은 팔레트를 실측해 고른다.
    TONE = {"forest": {"far": (1, 3), "mid": (1, 3), "gp": ("wood", 3, 0)},
            "sky":    {"far": (0, 2), "mid": (3, 4), "gp": ("wood", 1, 0)}}
    P = terrain_props(pre_name)
    t = TONE.get(pre_name) or auto_tone(preset(pre_name), P.get("ground"))

    horizon = px(d.get("horizon", 56))
    gt = px(d.get("groundTop", 92))
    if pre_name == "sky":
        # 밝은 하늘 프리셋은 '펫 뒤가 열린 하늘'이 기본 — 수목선을 아래로
        far_base, mid_base = gt - px(15), gt - px(8)
    else:
        far_base, mid_base = horizon - px(8), gt - px(18)
    pet = {"x": W // 2 - 16 * sc, "y": gt - 32 * sc, "w": 32 * sc, "h": 32 * sc}
    avoid = [pet["x"], pet["x"] + pet["w"]]

    # ---- sky ---------------------------------------------------------
    sky = [{"op": "vgradient", "ramp": "sky", "from": 4, "to": 0,
            "y0": 0, "y1": H, "block": 2}]
    if pre_name == "sky":
        cw = px(16)
        sky += [{"op": "clouds", "color": "light.4", "mid": "light.3",
                 "shade": "light.2",
                 "blobs": [[int(W * f), px(y), cw, px(5)]
                           for f, y in ((0.16, 20), (0.22, 22), (0.76, 30),
                                        (0.82, 32), (0.45, 44))]},
                {"op": "scatter", "name": "cloud_small", "y": px(58),
                 "anchor": "top", "align": "center", "scale": sc,
                 "xs": [int(W * 0.08), int(W * 0.90)], "shade": -1, "flipAlt": True}]
    else:
        sky += [{"op": "rays", "xs": [int(W * f) for f in (0.08, 0.34, 0.66)],
                 "y0": 0, "y1": H, "slope": 2.4, "width": max(2, px(2)),
                 "strength": 0.22, "color": "light.4"}]

    # ---- far ---------------------------------------------------------
    far = [{"op": "hills", "base": far_base, "amp": px(4), "period": int(W * 0.54),
            "phase": 0.4, "color": f"far.{t['far'][0]}",
            "edge": f"far.{t['far'][1]}", "edgeH": px(2), "to": H},
           {"op": "foliage",
            "box": [0, far_base, W, max(px(6), mid_base - far_base - px(6))],
            "ramp": "far",
            "base": t['far'][0] + (1 if pre_name == "forest" else 0),
            "rim": t['far'][1] + (1 if pre_name == "forest" else 0),
            "shadow": max(0, t['far'][0] - (0 if pre_name == "forest" else 1)),
            "r": [px(4), px(6)], "spacing": 1.0, "rimW": px(2),
            "depthRange": 1, "seed": 21, "fillBelow": H},
           {"op": "scatter_depth", "name": P["tall"] or "rock", "y0": far_base + px(6),
            "y1": mid_base + px(4), "count": cnt(5), "scale": [sc, sc],
            "shade": [3, 2], "seed": 31, "avoid": avoid},
           {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    if pre_name == "forest":
        far.insert(0, {"op": "foliage", "box": [0, 0, W, px(5)], "ramp": "far",
                       "base": 0, "rim": 2, "shadow": 0,
                       "r": [px(4), px(7)], "spacing": 0.95, "rimW": px(2),
                       "depthTone": False, "seed": 2})

    # ---- mid ---------------------------------------------------------
    mid = [{"op": "fringe", "from": "bottom", "base": mid_base, "r": px(9),
            "spacing": px(13), "jitter": px(3), "seed": 4, "to": H,
            "color": f"mid.{t['mid'][0]}", "edge": f"mid.{t['mid'][1]}",
            "edgeH": px(2)},
           {"op": "foliage",
            "box": [0, mid_base - px(2), W, max(px(8), gt - mid_base + px(2))],
            "ramp": "mid", "base": t['mid'][0], "rim": t['mid'][1],
            "shadow": max(0, t['mid'][0] - 1), "r": [px(5), px(9)],
            "spacing": 1.1, "rimW": px(2), "depthRange": 1, "seed": 23,
            "fillBelow": H},
           {"op": "scatter_depth", "name": P["round"] or P["low"],
            "y0": mid_base + px(2), "y1": gt, "count": cnt(4),
            "scale": [sc, sc], "shade": [2, 0], "seed": 33, "avoid": avoid},
           {"op": "scatter_depth", "name": P["low"], "y0": mid_base + px(6),
            "y1": gt, "count": cnt(7), "scale": [sc, sc + 1], "shade": [1, 0],
            "seed": 35, "avoid": avoid},
           *([{"op": "scatter_depth", "name": P["floor"][-1], "y0": mid_base + px(8),
               "y1": gt, "count": cnt(5), "scale": [sc, sc], "shade": [0, 1],
               "seed": 39}] if len(P["floor"]) > 1 else []),
           {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    if pre_name == "sky":
        mid.insert(2, {"op": "stamp", "name": "platform", "x": int(W * 0.74),
                       "y": mid_base - px(8), "align": "center", "scale": sc})

    # ---- near --------------------------------------------------------
    gp_ramp, gp_far, gp_near = t["gp"]
    near = [{"op": "ground_plane", "y": gt, "h": H - gt, "ramp": gp_ramp,
             "far": gp_far, "near": gp_near, "cell": [max(2, int(round(3 * (g["s"] ** 0.2)))), px(10)], "seed": 5,
             "edge": "leaf.2", "edgeH": px(2), "furrow0": 1,
             "furrowShift": 2, "furrowStrength": 0.7, "markShift": -1},
            {"op": "vgradient", "ramp": "near", "from": 0, "to": 2,
             "box": [0, gt + px(2), W, px(6)], "dither": True},
            *([{"op": "scatter_depth", "name": P["floor"][0], "y0": gt + px(3),
                "y1": H - px(2), "count": cnt(14), "scale": [sc, sc + 1],
                "shade": [0, 1], "seed": 37}] if P["floor"] else
              [{"op": "scatter_depth", "name": "rock", "y0": gt + px(3),
                "y1": H - px(2), "count": cnt(7), "scale": [sc, sc + 1],
                "shade": [1, 0], "seed": 37}]),
            {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1,
             "only": ["leaf", "accent"]}]
    if pre_name != "forest":
        # 바위는 wood 램프 3색을 더 쓴다 — 프레이밍 거목이 있는 forest에서는
        # near 레이어 색 상한을 넘긴다.
        near.insert(3, {"op": "scatter_depth", "name": "rock", "y0": gt + px(4),
                        "y1": H - px(4), "count": cnt(4), "scale": [sc, sc + 1],
                        "shade": [0, -1], "seed": 45})
    if pre_name == "forest":
        tw = max(px(12), int(W * 0.052))
        near = [{"op": "rect", "x": 0, "y": 0, "w": tw, "h": H, "color": "near.0"},
                {"op": "rect", "x": 0, "y": 0, "w": px(2), "h": H, "color": "near.2"},
                {"op": "rect", "x": tw - px(2), "y": 0, "w": px(2), "h": H,
                 "color": "near.1"},
                {"op": "texture", "box": [0, 0, tw, H], "color": "near.1",
                 "marks": "grain", "density": 0.05, "seed": 41},
                {"op": "rect", "x": W - tw, "y": 0, "w": tw, "h": H,
                 "color": "near.0"},
                {"op": "rect", "x": W - tw, "y": 0, "w": px(2), "h": H,
                 "color": "near.2"},
                {"op": "rect", "x": W - px(2), "y": 0, "w": px(2), "h": H,
                 "color": "near.1"},
                {"op": "texture", "box": [W - tw, 0, tw, H], "color": "near.1",
                 "marks": "grain", "density": 0.05, "seed": 43},
                {"op": "stamp", "name": "vine", "x": tw + px(4), "y": 0,
                 "anchor": "top", "scale": sc},
                {"op": "stamp", "name": "vine", "x": W - tw - px(4), "y": 0,
                 "anchor": "top", "flip": True, "scale": sc}] + near
    return sky, far, mid, near, horizon, gt, pet


def interior(d, W, H):
    """실내 4레이어 — 사이드뷰(정면 벽) + 마루 깊이.

    실내에는 대기 원근이 없다. 깊이는 가림 순서, 레이어 간 명도차,
    ground_plane이 만드는 마루 압축으로 낸다.
    """
    g = geom(W, H)
    px, cnt, sc = g["px"], g["count"], g["stamp"]
    horizon = px(d.get("horizon", 46))
    gt = px(d.get("groundTop", 88))
    wains = gt - px(30)
    pet = {"x": W // 2 - 16 * sc, "y": gt - 32 * sc, "w": 32 * sc, "h": 32 * sc}

    sky = [{"op": "panel", "box": [0, 0, W, wains], "ramp": "sky", "base": 2,
            "seam": 0, "light": 3, "boardH": px(6), "jointEvery": px(32),
            "seed": 51, "vary": 1, "grain": 0.012, "grainShift": 3},
           {"op": "panel", "box": [0, wains, W, gt - wains], "ramp": "wood",
            "base": 3, "seam": 1, "light": 4, "boardH": px(7),
            "jointEvery": px(18), "seed": 53, "vary": 1, "grain": 0.010,
            "grainShift": 4},
           {"op": "rect", "x": 0, "y": wains - px(2), "w": W, "h": px(2),
            "color": "wood.4"},
           {"op": "ground_plane", "y": gt, "h": H - gt, "ramp": "mid",
            "far": 4, "near": 0, "cell": [max(2, int(round(4 * (g["s"] ** 0.2)))), px(12)], "seed": 55,
            "edge": "wood.0", "edgeH": px(2), "furrow0": 1,
            "furrowShift": 2, "furrowStrength": 0.6, "markShift": -1}]
    # 창은 실내 명도 상단 구간을 채우는 유일하게 큰 밝은 요소다. 폭이 넓어지면
    # 개수를 늘려야 밝은 구간 면적 비율이 유지된다(명도 구간 게이트).
    nwin = max(2, int(round(W / 190.0)))
    wxs = [int(W * (i + 0.5) / nwin) for i in range(nwin)]
    far = [{"op": "stamp", "name": "window_lit", "x": x, "y": px(6),
            "anchor": "top", "align": "center", "scale": sc * 2} for x in wxs]
    far += [{"op": "stamp", "name": "picture", "x": int((wxs[0] + wxs[1]) / 2)
             if nwin > 1 else int(W * 0.75), "y": px(10), "anchor": "top",
             "align": "center", "scale": sc * 2},
            {"op": "stamp", "name": "shelf", "x": W // 2, "y": wains - px(2),
             "align": "center", "scale": sc},
            {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    mid = [{"op": "stamp", "name": "rug", "x": int(W * 0.50), "y": H - 1,
            "align": "center", "scale": sc},
           {"op": "glow", "x": int(W * 0.28), "y": gt - px(11), "rx": px(15),
            "ry": px(11), "color": "light.4", "strength": 0.30, "gamma": 2.0},
] + [{"op": "glow", "x": x, "y": px(34), "rx": px(26), "ry": px(24),
                 "color": "light.3", "strength": 0.22, "gamma": 2.2}
                for x in [int(W * (i + 0.5) / max(2, int(round(W / 190.0))))
                          for i in range(max(2, int(round(W / 190.0))))]] + [
           {"op": "scatter_depth", "name": "lamp", "y0": gt + px(1),
            "y1": gt + px(4), "count": 1, "scale": [sc, sc], "shade": [0, 0],
            "seed": 57, "x0": int(W * 0.22), "x1": int(W * 0.34)},
           {"op": "contact_shadow", "x": int(W * 0.28), "y": gt + px(3),
            "w": px(12), "h": px(2), "color": "mid.0", "strength": 0.6},
           {"op": "scatter_depth", "name": "plant_pot", "y0": gt + px(2),
            "y1": gt + px(8), "count": 2, "scale": [sc, sc], "shade": [0, 0],
            "seed": 59, "x0": int(W * 0.66), "x1": int(W * 0.80)},
           {"op": "contact_shadow", "x": int(W * 0.71), "y": gt + px(7),
            "w": px(14), "h": px(2), "color": "mid.0", "strength": 0.6},
           {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    near = [{"op": "vgradient", "ramp": "near", "from": 0, "to": 2,
             "box": [0, 0, W, px(7)], "dither": True},
            {"op": "stamp", "name": "crate", "x": int(W * 0.06), "y": H - px(2),
             "align": "center", "scale": sc * 2, "shade": -2},
            {"op": "stamp", "name": "plant_pot", "x": int(W * 0.94),
             "y": H - px(2), "align": "center", "scale": sc, "shade": 0},
            {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    return sky, far, mid, near, horizon, gt, pet


def canopy(pre_name, d, W, H):
    """다층 수직 정글 — 지평선이 없는 구조.

    레퍼런스에서 뽑은 공간 구조를 그대로 뼈대로 쓴다.
      - 화면을 세로로 관통하는 고목 (전경 좌우 2 + 중경 3~4)
      - 여러 높이의 이끼 낀 나뭇가지 발판 (4층)
      - 발판 사이를 잇는 로프 다리 (2~3) + 사다리 1
      - 중앙 뒤쪽은 역광 안개로 비워 캐릭터가 뜨게 한다
    수평 지면이 없으므로 groundTop은 '펫이 서는 발판의 윗면'을 가리킨다.
    """
    g = geom(W, H)
    px, cnt, sc = g["px"], g["count"], g["stamp"]

    # 4개 층. 아래로 갈수록 앞이라 두껍고 진하다.
    tiers = [int(H * f) for f in (0.18, 0.40, 0.62, 0.84)]
    gt = tiers[-1]                                   # 펫이 서는 층
    pet = {"x": W // 2 - 16 * sc, "y": gt - 32 * sc, "w": 32 * sc, "h": 32 * sc}
    ow = int(W * 0.15)                               # 중앙 개방 반폭
    cx0, cx1 = W // 2 - ow, W // 2 + ow

    # ---- sky : 역광 안개. 중앙이 가장 밝다 ------------------------------
    sky = [{"op": "vgradient", "ramp": "sky", "from": 2, "to": 0,
            "y0": 0, "y1": H, "block": 2},
           {"op": "glow", "x": W // 2, "y": int(H * 0.45), "rx": int(W * 0.24),
            "ry": int(H * 0.62), "color": "sky.4", "strength": 0.9, "gamma": 1.2},
           {"op": "glow", "x": W // 2, "y": int(H * 0.42), "rx": int(W * 0.13),
            "ry": int(H * 0.40), "color": "light.4", "strength": 1.0, "gamma": 1.4},
           {"op": "rays", "xs": [int(W * f) for f in (0.30, 0.44, 0.58, 0.70)],
            "y0": 0, "y1": H, "slope": 3.2, "width": max(2, px(3)),
            "strength": 0.30, "color": "light.3"},
           {"op": "rays", "xs": [int(W * f) for f in (0.36, 0.52, 0.64)],
            "y0": 0, "y1": H, "slope": 2.6, "width": max(2, px(2)),
            "strength": 0.22, "color": "light.1"}]

    # ---- far : 안개에 씻긴 원경 줄기 -------------------------------------
    far = []
    for i, (fx, fw) in enumerate(((0.44, 0.030), (0.57, 0.026))):
        far.append({"op": "tree_column", "x": int(W * fx), "ramp": "far",
                    "w": [int(W * fw), int(W * (fw + 0.012))],
                    "base": 2, "lit": 3, "dark": 1,
                    "sway": int(W * 0.010), "period": int(H * 0.6), "phase": i * 1.3,
                    "grooves": 2, "seed": 60 + i, "flare": int(H * 0.03),
                    "flareTop": int(H * 0.02)})
    far += [{"op": "glow", "x": int(W * 0.34), "y": int(H * 0.55),
             "rx": int(W * 0.10), "ry": int(H * 0.30), "color": "light.2",
             "strength": 0.45, "gamma": 1.8},
            {"op": "glow", "x": int(W * 0.66), "y": int(H * 0.35),
             "rx": int(W * 0.09), "ry": int(H * 0.26), "color": "light.1",
             "strength": 0.38, "gamma": 1.8},
            {"op": "foliage", "box": [0, 0, W, px(10)], "ramp": "far",
             "base": 1, "rim": 3, "shadow": 0, "r": [px(5), px(9)],
             "spacing": 1.0, "rimW": px(2), "depthTone": False, "seed": 61},
            {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]

    # ---- mid : 주 줄기 + 발판 + 다리 -------------------------------------
    mid = []
    trunks = [(0.105, 0.062), (0.190, 0.048), (0.268, 0.055), (0.345, 0.040),
              (0.655, 0.042), (0.732, 0.056), (0.812, 0.047), (0.895, 0.064)]
    for i, (tx, tw) in enumerate(trunks):
        mid.append({"op": "tree_column", "x": int(W * tx), "ramp": "mid",
                    "w": [int(W * tw), int(W * (tw + 0.016))],
                    "base": 2, "lit": 4, "dark": 0,
                    "sway": int(W * 0.014), "period": int(H * 0.75),
                    "phase": i * 0.9 + 0.4, "grooves": 3, "seed": 70 + i,
                    "edge": "mid.0", "moss": "leaf", "mossCount": 5,
                    "flare": int(H * 0.05), "flareTop": int(H * 0.035)})
    # 발판 — 층마다 중앙 개방부를 남기고 좌우로 놓는다.
    # 높이를 층마다 조금씩 흔든다: 완전히 수평으로 정렬하면 선반이 된다.
    jog = [0, int(H * 0.025), -int(H * 0.02), int(H * 0.015)]
    spans = []
    for ti, ty in enumerate(tiers):
        if ti % 2 == 0:
            spans += [(ti, 0, cx0 - int(W * 0.02), jog[ti % 4]),
                      (ti, cx1 + int(W * 0.02), W, -jog[ti % 4])]
        else:
            spans += [(ti, int(W * 0.06), cx0 + int(W * 0.03), -jog[ti % 4]),
                      (ti, cx1 - int(W * 0.03), int(W * 0.94), jog[ti % 4])]
    # 펫이 서는 층은 중앙까지 이어 준다(설 자리가 있어야 게임 배경이다)
    spans.append((len(tiers) - 1, cx0 - int(W * 0.03), cx1 + int(W * 0.03), 0))

    def clumps(sx0, sx1, seed):
        """잎을 통짜로 깔면 울타리가 된다 — 2~3덩어리로 끊어서 사이를 비운다."""
        rnd = random.Random(seed)
        w = sx1 - sx0
        n = 2 if w < int(W * 0.22) else 3
        out, x = [], sx0
        for k in range(n):
            seg = int(w / n)
            cw = int(seg * rnd.uniform(0.62, 0.88))
            out.append((x + rnd.randint(0, max(1, seg - cw)), cw))
            x += seg
        return out

    for ti, sx0, sx1, dy in spans:
        if sx1 - sx0 < int(W * 0.08):
            continue
        ty = tiers[ti] + dy
        mid.append({"op": "branch_platform", "x": sx0, "y": ty, "w": sx1 - sx0,
                    "thickness": max(5, int(H * 0.030) + ti), "mossH": max(2, int(H * 0.013)),
                    "base": 2, "lit": 3, "dark": 0, "mossBase": 2,
                    "mossLit": 4, "taper": max(4, int(W * 0.012)), "seed": 80 + ti})
        lh = max(4, int(H * 0.045))
        for ci, (cxs, cw) in enumerate(clumps(sx0, sx1, 300 + ti * 11 + sx0)):
            # 펫이 서는 자리에는 잎을 얹지 않는다 — 열린 시야 확보
            if ti == len(tiers) - 1 and cxs < pet["x"] + pet["w"] and cxs + cw > pet["x"]:
                continue
            mid.append({"op": "foliage", "box": [cxs, ty - lh, cw, lh],
                        "ramp": "leaf", "base": 2, "rim": 4, "shadow": 0,
                        "r": [max(3, int(H * 0.020)), max(5, int(H * 0.038))],
                        "spacing": 0.92, "rimW": 2, "depthTone": False,
                        "seed": 110 + ti * 7 + ci})
            # 청록 잎을 섞어 단일 초록으로 흐르지 않게 한다
            if (ti + ci) % 3 == 0:
                mid.append({"op": "foliage",
                            "box": [cxs + cw // 3, ty - lh + 2, max(5, cw // 4), lh - 4],
                            "ramp": "accent", "base": 0, "rim": 1, "shadow": 0,
                            "r": [max(2, int(H * 0.010)), max(3, int(H * 0.018))],
                            "spacing": 1.3, "rimW": 1, "depthTone": False,
                            "seed": 200 + ti * 5 + ci})
        # 발판 아래로 늘어지는 덩굴
        mid.append({"op": "stamp", "name": "vine", "x": sx0 + int((sx1 - sx0) * 0.22),
                    "y": ty + max(5, int(H * 0.030)), "anchor": "top", "scale": sc})

    # 로프 다리 — 층 사이 개방부를 건넌다
    mid += [{"op": "rope_bridge", "x0": cx0 - int(W * 0.015), "x1": cx1 + int(W * 0.015),
             "y": tiers[1] - px(2), "sag": px(9), "plank": max(3, px(4)),
             "rail": px(9), "plankW": max(2, int(W * 0.006)), "plankH": max(3, int(H * 0.022)),
             "rope": 1, "plank_i": 3, "dark": 0},
            {"op": "rope_bridge", "x0": int(W * 0.06), "x1": cx0 + int(W * 0.02),
             "y": tiers[2] - px(2), "sag": px(7), "plank": max(3, px(4)),
             "rail": px(8), "plankW": max(2, int(W * 0.006)), "plankH": max(3, int(H * 0.022)),
             "rope": 1, "plank_i": 3, "dark": 0}]
    if len(tiers) > 3:
        mid.append({"op": "rope_bridge", "x0": cx1 - int(W * 0.02), "x1": int(W * 0.94),
                    "y": tiers[0] - px(2), "sag": px(6), "plank": max(3, px(4)),
                    "rail": px(8), "plankW": max(2, int(W * 0.006)), "plankH": max(3, int(H * 0.022)),
                    "rope": 1, "plank_i": 3, "dark": 0})
    mid.append({"op": "ladder", "x": int(W * 0.47), "y0": tiers[0],
                "y1": tiers[1], "w": max(7, px(9)), "step": max(4, px(5))})
    # 발판 위 식물 — 이동 경로를 눈에 띄게 한다
    mid.append({"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1,
                "only": ["leaf", "accent"]})

    # ---- near : 화면 밖으로 잘리는 전경 고목 -----------------------------
    near = []
    for i, (nx, nw0, nw1, holl) in enumerate(
            ((0.015, 0.10, 0.13, [(int(H * 0.30), 9, 13), (int(H * 0.72), 8, 11)]),
             (0.985, 0.11, 0.14, [(int(H * 0.46), 10, 14)]))):
        near.append({"op": "tree_column", "x": int(W * nx), "ramp": "near",
                     "w": [int(W * nw0), int(W * nw1)], "base": 2, "lit": 4, "dark": 0,
                     "sway": int(W * 0.008), "period": int(H * 1.0), "phase": i * 2.0,
                     "grooves": 3, "seed": 50 + i, "edge": "near.0", "moss": "leaf",
                     "mossCount": 6, "flare": int(H * 0.06), "flareTop": int(H * 0.05),
                     "hollows": holl})
    near += [{"op": "stamp", "name": "vine", "x": int(W * 0.11), "y": tiers[0],
              "anchor": "top", "scale": sc},
             {"op": "stamp", "name": "vine", "x": int(W * 0.90), "y": tiers[1],
              "anchor": "top", "scale": sc, "flip": True},
             {"op": "stamp", "name": "vine", "x": int(W * 0.66), "y": tiers[2],
              "anchor": "top", "scale": sc},
             {"op": "foliage", "box": [0, 0, W, px(6)], "ramp": "near",
              "base": 1, "rim": 3, "shadow": 0, "r": [px(6), px(10)],
              "spacing": 1.0, "rimW": px(2), "depthTone": False, "seed": 55},
             {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1}]
    return sky, far, mid, near, tiers[0], gt, pet


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", required=True)
    ap.add_argument("--id", required=True, help="예: bg_001")
    ap.add_argument("--slug", required=True, help="영문 소문자+숫자+언더스코어")
    ap.add_argument("--name", required=True, help="한국어 표시명")
    ap.add_argument("--size", default="280x120", help="WxH (기본 280x120)")
    ap.add_argument("--root", help="프로젝트 루트 — 저장 경로를 함께 출력")
    ap.add_argument("--seamless", action="store_true")
    a = ap.parse_args()

    try:
        W, H = (int(v) for v in a.size.lower().split("x"))
    except ValueError:
        raise SystemExit(f"--size 형식은 WxH (받은 값: {a.size!r})")
    note = size_note(W, H)
    if note and note.startswith("거부"):
        raise SystemExit(note)
    if note:
        sys.stderr.write(f"# {note}\n")

    p = preset(a.preset)
    d = p.get("defaults", {})
    layout = p.get("layout", "ground")
    if layout == "canopy":
        sky, far, mid, near, horizon, gt, pet = canopy(a.preset, d, W, H)
    elif a.preset == "interior" or p.get("kind") == "interior":
        sky, far, mid, near, horizon, gt, pet = interior(d, W, H)
    else:
        sky, far, mid, near, horizon, gt, pet = outdoor(a.preset, d, W, H)

    scene = {"id": a.id, "name": a.name, "preset": a.preset, "canvas": [W, H],
             "layout": layout,
             "seamless": a.seamless, "horizon": horizon, "groundTop": gt,
             "petAnchor": pet,
             "layers": [{"name": "sky", "z": 0, "parallax": 0.0, "ops": sky},
                        {"name": "far", "z": 1, "parallax": 0.25, "ops": far},
                        {"name": "mid", "z": 2, "parallax": 0.55, "ops": mid},
                        {"name": "near", "z": 3, "parallax": 1.0, "ops": near}]}
    print(json.dumps(scene, ensure_ascii=False, indent=2))
    if a.root:
        out = os.path.join(a.root, "assets", "backgrounds", f"{a.id}_{a.slug}")
        sys.stderr.write(
            f"\n# 캔버스 {W}x{H}  수평선 {horizon}  지면 {gt}  스탬프 배율 x{geom(W,H)['stamp']}\n"
            f"# 저장 경로\n#   {out}/\n"
            f"#     scene.json  {a.id}.json  {a.id}_composite.png\n"
            f"#     {a.id}_sky.png  {a.id}_far.png  {a.id}_mid.png  {a.id}_near.png\n"
            f"# 렌더\n#   python3 scripts/bg_render.py <이 json> --out-dir {out} "
            f"--preview /tmp/{a.id}_prev.png\n"
            f"# 검사\n#   python3 scripts/bg_check.py {out}\n")


if __name__ == "__main__":
    main()
