#!/usr/bin/env python3
"""펫룸 배경 scene.json 빌더.

같은 구도를 (a) 낮/밤 프리셋, (b) 반딧불이 위상(frame)만 바꿔 다시 찍기 위해
scene.json을 손으로 쓰지 않고 여기서 만든다.

구도 요구사항(인터뷰 브리프):
  - 좌우 양 끝 거대 고목 기둥 + 늘어진 덩굴, 중앙 하단은 펫 배회용으로 비움
  - 중경에 이끼 바위와 돌 발판, 지면에 버섯·통나무·풀·꽃·덤불
  - 반딧불이 발광 모트 (프레임마다 위치가 바뀐다)
  - 대비축: 원경 안개 <-> 전경 짙은 어둠
  - 광원 좌상단 고정
"""

import json
import math
import sys

W, H = 960, 360
HORIZON = 162
GROUND_TOP = 282
# 펫이 서는 자리 — 여기 위로는 큰 오브젝트를 놓지 않는다.
PET_BOX = (432, 528)
AVOID = [396, 564]


def fireflies(phase, count, box, ramp_color, seed_base):
    """반딧불이 한 무리. phase가 바뀌면 같은 무리가 조금씩 떠 있는 위치를 바꾼다.

    프레임마다 완전히 새로 뿌리면 깜빡이는 게 아니라 화면이 갈아엎어진다.
    seed는 고정하고 box만 미세하게 흔들어 '같은 벌레가 떠다니는' 것으로 읽히게 한다.
    """
    x, y, w, h = box
    dx = round(6 * math.sin(phase))
    dy = round(4 * math.cos(phase * 1.3))
    return {
        "op": "specks",
        "box": [x + dx, y + dy, w, h],
        "count": count,
        "color": ramp_color,
        "seed": seed_base,
    }


def firefly_glows(phase, spots):
    """반딧불이 중 몇 마리는 발광 헤일로를 갖는다. 반경이 위상에 따라 숨쉰다."""
    ops = []
    for i, (gx, gy, color, r) in enumerate(spots):
        breathe = 0.5 + 0.5 * math.sin(phase + i * 1.7)
        rx = max(2, round(r * (0.55 + 0.45 * breathe)))
        ops.append(
            {
                "op": "glow",
                "x": gx + round(5 * math.sin(phase + i)),
                "y": gy + round(4 * math.cos(phase * 0.9 + i)),
                "color": color,
                "rx": rx,
                "ry": rx,
                "strength": 0.30 + 0.22 * breathe,
                "gamma": 1.9,
            }
        )
    return ops


def build(preset, bg_id, name, phase=0.0, night=False):
    # 밤에는 반딧불이가 주역이라 더 많이·더 밝게, 낮에는 떠다니는 발광 포자로 절제한다.
    mote_color = "light.3" if night else "light.4"
    mote_count = 34 if night else 20
    accent_color = "accent.2" if night else "accent.2"

    # ---- sky : 안개 하늘 + 좌상단 빛내림 --------------------------------
    # 낮은 하늘 램프 3단까지, 밤은 2단까지만 쓴다 — 밤에 순백 하늘이 뜨면 달밤이
    # 아니라 흐린 낮이 된다. 대신 달 글로우 한 겹으로 색 수 하한(6색)을 채운다.
    if night:
        sky = [
            {"op": "vgradient", "ramp": "sky", "from": 3, "to": 0,
             "y0": 0, "y1": 232, "block": 2},
            {"op": "rect", "x": 0, "y": 232, "w": W, "h": H - 232,
             "color": "sky.0"},
            # 달 — 광원이 좌상단이므로 달도 좌상단에 둔다.
            {"op": "glow", "x": 186, "y": 52, "color": "light.4",
             "rx": 88, "ry": 74, "strength": 0.98, "gamma": 1.5},
            {"op": "rays", "xs": [120, 236, 402, 590], "y0": 0, "y1": 96,
             "slope": 2.4, "width": 9, "strength": 0.30, "color": "light.3"},
            {"op": "rays", "xs": [176, 330, 512], "y0": 0, "y1": 88,
             "slope": 2.4, "width": 13, "strength": 0.16, "color": "light.2"},
        ]
    else:
        sky = [
            {"op": "vgradient", "ramp": "sky", "from": 3, "to": 0,
             "y0": 0, "y1": H, "block": 2},
            # 광원이 좌상단이므로 광선을 왼쪽에 몰아 준다.
            {"op": "rays", "xs": [88, 232, 396, 604], "y0": 0, "y1": 96,
             "slope": 2.4, "width": 7, "strength": 0.26, "color": "light.4"},
            {"op": "rays", "xs": [150, 318, 500], "y0": 0, "y1": 88,
             "slope": 2.4, "width": 11, "strength": 0.12, "color": "light.2"},
        ]

    # ---- far : 안개에 씻긴 원경 ------------------------------------------
    far = [
        {"op": "foliage", "box": [0, 0, W, 15], "ramp": "far", "base": 0,
         "rim": 2, "shadow": 0, "r": [12, 21], "spacing": 0.95, "rimW": 6,
         "depthTone": False, "seed": 2},
    ]
    # 원경 줄기 — 가늘고 옅다. 크기 기울기(깊이 단서 4)의 '먼 쪽' 표본.
    for i, (fx, fw0, fw1) in enumerate(((380, 24, 32), (604, 20, 27))):
        far.append({"op": "tree_column", "x": fx, "ramp": "far",
                    "w": [fw0, fw1], "y0": 0, "y1": 236,
                    "base": 1, "lit": 2, "dark": 0,
                    "sway": 9, "period": 216, "phase": i * 1.3,
                    "grooves": 3, "seed": 60 + i, "flare": 11, "flareTop": 7})
    far += [
        {"op": "hills", "base": 138, "amp": 12, "period": 518, "phase": 0.4,
         "color": "far.0", "edge": "far.2", "edgeH": 6, "to": H},
        {"op": "foliage", "box": [-16, 144, 316, 66], "ramp": "far", "base": 0,
         "rim": 2, "shadow": 0, "r": [11, 17], "spacing": 1.0, "rimW": 6,
         "depthRange": 1, "seed": 21, "fillBelow": H},
        {"op": "foliage", "box": [352, 130, 292, 80], "ramp": "far", "base": 0,
         "rim": 2, "shadow": 0, "r": [14, 21], "spacing": 1.05, "rimW": 6,
         "depthRange": 1, "seed": 24, "fillBelow": H},
        {"op": "foliage", "box": [682, 148, 294, 62], "ramp": "far", "base": 0,
         "rim": 2, "shadow": 0, "r": [10, 16], "spacing": 0.95, "rimW": 6,
         "depthRange": 1, "seed": 27, "fillBelow": H},
        {"op": "scatter_depth", "name": "tree_pine", "y0": 178, "y1": 248,
         "count": 7, "scale": [3, 3], "shade": [1, 0], "seed": 31,
         "avoid": AVOID},
        # 역광 안개 개방부 — 원경이 '뒤로 뚫려 있다'는 신호.
        {"op": "glow", "x": 300, "y": 190, "rx": 96, "ry": 74,
         "color": "light.2", "strength": 0.40, "gamma": 1.8},
        {"op": "glow", "x": 690, "y": 172, "rx": 84, "ry": 64,
         "color": "light.1", "strength": 0.34, "gamma": 1.8},
        {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1},
    ]

    # ---- mid : 중경 잎벽 + 고목 + 이끼 바위 + 돌 발판 --------------------
    mid = []
    # 중경 고목 — 뒤에 먼저 그려서 아래쪽 잎벽이 밑동을 덮게 한다(겹침 단서).
    for i, (mx, mw0, mw1) in enumerate(((156, 40, 56), (806, 44, 61))):
        mid.append({"op": "tree_column", "x": mx, "ramp": "wood",
                    "w": [mw0, mw1], "y0": 0, "y1": 300,
                    "base": 2, "lit": 3, "dark": 1,
                    "sway": 13, "period": 270, "phase": i * 0.9 + 0.4,
                    "grooves": 5, "seed": 70 + i, "edge": "wood.0",
                    "moss": "leaf", "mossCount": 7, "flare": 18, "flareTop": 12})
    mid += [
        {"op": "scatter_depth", "name": "tree_round", "y0": 202, "y1": 252,
         "count": 5, "scale": [3, 3], "shade": [2, 0], "seed": 33,
         "avoid": AVOID},
        {"op": "fringe", "from": "bottom", "base": 228, "r": 27, "spacing": 39,
         "jitter": 9, "seed": 4, "to": H, "color": "mid.1", "edge": "mid.3",
         "edgeH": 6},
        {"op": "foliage", "box": [-20, 228, 330, 54], "ramp": "mid", "base": 1,
         "rim": 3, "shadow": 0, "r": [14, 24], "spacing": 1.1, "rimW": 6,
         "depthRange": 1, "seed": 23, "fillBelow": H},
        {"op": "foliage", "box": [346, 216, 300, 66], "ramp": "mid", "base": 1,
         "rim": 3, "shadow": 0, "r": [17, 29], "spacing": 1.15, "rimW": 6,
         "depthRange": 1, "seed": 26, "fillBelow": H},
        {"op": "foliage", "box": [676, 232, 304, 50], "ramp": "mid", "base": 1,
         "rim": 3, "shadow": 0, "r": [13, 23], "spacing": 1.05, "rimW": 6,
         "depthRange": 1, "seed": 29, "fillBelow": H},
        # 돌 발판 — 중경 좌우에만. 중앙에 놓으면 펫 자리를 가린다.
        {"op": "stamp", "name": "platform", "x": 236, "y": 258,
         "anchor": "bottom", "align": "center", "scale": 3, "shade": 1},
        {"op": "stamp", "name": "platform", "x": 726, "y": 250,
         "anchor": "bottom", "align": "center", "scale": 3, "shade": 0},
        # 이끼 바위 — 크기 두 종으로 뿌려 크기 기울기를 만든다.
        {"op": "scatter_depth", "name": "rock_mossy", "y0": 240, "y1": 282,
         "count": 8, "scale": [1, 2], "shade": [2, 0], "seed": 47,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "bush_leafy", "y0": 246, "y1": 282,
         "count": 9, "scale": [1, 2], "shade": [1, 0], "seed": 35,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "bush", "y0": 236, "y1": 262,
         "count": 7, "scale": [2, 2], "shade": [2, 1], "seed": 43,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "flower", "y0": 252, "y1": 282,
         "count": 9, "scale": [2, 3], "shade": [0, 1], "seed": 39},
        {"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1},
    ]

    # ---- near : 좌우 거대 고목 + 덩굴 + 지면 + 바닥 소품 + 반딧불이 ------
    near = []
    # 화면 밖으로 잘리는 전경 고목. rect로 세우면 전봇대로 읽히므로 tree_column.
    for i, (nx, nw0, nw1, holl) in enumerate((
            (18, 76, 104, [[108, 9, 13], [259, 8, 11]]),
            (914, 60, 78, [[166, 10, 14]]))):
        near.append({"op": "tree_column", "x": nx, "ramp": "wood",
                     "w": [nw0, nw1], "y0": 0, "y1": H,
                     "base": 1, "lit": 2, "dark": 0,
                     "sway": 8, "period": 360, "phase": i * 2.0,
                     "grooves": 6, "seed": 50 + i, "edge": "near.0",
                     "moss": "leaf", "mossCount": 9,
                     "flare": 22, "flareTop": 18, "hollows": holl})
    near += [
        {"op": "stamp", "name": "vine", "x": 84, "y": 0, "anchor": "top",
         "scale": 3},
        {"op": "stamp", "name": "vine", "x": 878, "y": 0, "anchor": "top",
         "flip": True, "scale": 3},
        {"op": "stamp", "name": "vine", "x": 148, "y": 0, "anchor": "top",
         "scale": 2},
        {"op": "ground_plane", "y": GROUND_TOP, "h": H - GROUND_TOP,
         "ramp": "wood", "far": 3, "near": 0, "cell": [4, 30], "seed": 5,
         "edge": "leaf.2", "edgeH": 6, "furrow0": 1, "furrowShift": 2,
         "furrowStrength": 0.7, "markShift": -1},
        # 수목선 바로 아래 그림자 띠 — 접지 단서.
        {"op": "vgradient", "ramp": "near", "from": 0, "to": 2,
         "box": [0, 288, W, 18], "dither": True},
        # 바닥 소품 — 중앙은 비우고 좌우로. 지면이 단색 슬래브로 읽히는 걸 막는다.
        {"op": "scatter_depth", "name": "log_mossy", "y0": 300, "y1": 344,
         "count": 4, "scale": [1, 2], "shade": [1, 0], "seed": 53,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "mushroom_cluster", "y0": 294, "y1": 352,
         "count": 9, "scale": [1, 2], "shade": [0, -1], "seed": 55,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "mushroom", "y0": 292, "y1": 322,
         "count": 8, "scale": [1, 2], "shade": [0, -2], "seed": 57,
         "avoid": AVOID},
        {"op": "scatter_depth", "name": "grass_tuft", "y0": 291, "y1": 354,
         "count": 22, "scale": [2, 3], "shade": [0, 1], "seed": 37},
        {"op": "contact_shadow", "x": 236, "y": 300, "w": 72, "h": 5,
         "color": "near.0", "strength": 0.55},
        {"op": "contact_shadow", "x": 660, "y": 318, "w": 96, "h": 6,
         "color": "near.0", "strength": 0.55},
    ]
    # ---- 반딧불이 (프레임마다 바뀌는 유일한 부분) -------------------------
    near += [
        fireflies(phase, mote_count, [40, 96, 880, 168], mote_color, 71),
        fireflies(phase * 1.4 + 1.1, mote_count // 2, [120, 210, 720, 96],
                  accent_color, 73),
    ]
    near += firefly_glows(phase, [
        (196, 168, "light.4", 7),
        (392, 214, accent_color, 6),
        (568, 150, "light.4", 6),
        (742, 236, accent_color, 7),
        (300, 262, "light.4", 5),
    ])
    near.append({"op": "autoshade", "depth": 1, "highlight": 1, "shadow": 1,
                 "only": ["leaf", "accent"]})

    return {
        "id": bg_id,
        "name": name,
        "preset": preset,
        "canvas": [W, H],
        "layout": "ground",
        "seamless": False,
        "horizon": HORIZON,
        "groundTop": GROUND_TOP,
        "petAnchor": {"x": PET_BOX[0], "y": 186, "w": 96, "h": 96},
        "layers": [
            {"name": "sky", "z": 0, "parallax": 0.0, "ops": sky},
            {"name": "far", "z": 1, "parallax": 0.25, "ops": far},
            {"name": "mid", "z": 2, "parallax": 0.55, "ops": mid},
            {"name": "near", "z": 3, "parallax": 1.0, "ops": near},
        ],
    }


if __name__ == "__main__":
    preset = sys.argv[1]
    bg_id = sys.argv[2]
    name = sys.argv[3]
    phase = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    night = len(sys.argv) > 5 and sys.argv[5] == "night"
    json.dump(build(preset, bg_id, name, phase, night),
              sys.stdout, ensure_ascii=False, indent=2)
