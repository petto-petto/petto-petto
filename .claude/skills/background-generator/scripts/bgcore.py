#!/usr/bin/env python3
"""bg_* 스크립트 공용 — 프리셋 로딩, 색 해석, 디더, 스탬프 로딩."""
import json
import os
import re

import bg_pillow_gate  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PRESET_PATH = os.path.join(ROOT, "references", "presets.json")
STAMP_ROOT = os.path.join(ROOT, "stamps")

CANVAS = (280, 120)          # 기본값일 뿐 고정이 아니다. 크기는 scene.json이 정한다
REF_H = 120                  # 게이트·구도 상수를 캘리브레이션한 기준 높이
SAFE_H = (80, 360)           # 이 밖은 게이트 기준이 검증되지 않은 구간
MIN_H, MIN_W = 64, 96        # 4레이어 + 지면 밴드가 물리적으로 안 들어가는 하한


def geom(w, h):
    """캔버스 크기 -> 스케일 계수 묶음.

    세로 배분(수평선·지면 밴드)이 구도의 전부라 기준은 **높이**다. 폭은 요소
    개수(가로로 몇 개를 뿌리나)에만 쓴다.

    stamp는 정수배 확대만 가능하다(도트가 깨진다). 그래서 1.5배 같은 배율에서는
    스탬프가 캔버스보다 상대적으로 커지거나 작아진다 — 그 차이는 요소 개수로
    메운다(count).
    """
    s = h / REF_H
    return {
        "s": s,
        "stamp": max(1, int(round(s))),          # 스탬프 정수 확대 배율
        "px": lambda v: max(1, int(round(v * s))),   # 세로 방향 절대 px
        "count": lambda n: max(1, int(round(n * (w / 280.0) * (1.0 / max(0.5, s))))),
    }


def size_note(w, h):
    """검증 구간 밖이면 경고 문자열, 안이면 None."""
    if h < MIN_H or w < MIN_W:
        return (f"거부: {w}x{h}는 너무 작다 (최소 {MIN_W}x{MIN_H}). "
                "4레이어 + 지면 밴드가 물리적으로 안 들어간다")
    lo, hi = SAFE_H
    if not (lo <= h <= hi):
        return (f"경고: 높이 {h}px는 게이트 기준을 검증한 구간({lo}~{hi}) 밖이다. "
                "생성은 진행하되 bg_check 결과를 눈으로 한 번 더 확인할 것")
    return None
PET_OUTLINE = "#2C2438"          # 캐릭터 전용 — 배경에서는 예약색
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def presets():
    with open(PRESET_PATH, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def preset(name):
    p = presets()
    if name not in p:
        raise SystemExit(f"unknown preset {name!r} — {list(p)}")
    validate_preset(name, p[name])
    p[name].setdefault("layout", "ground")
    return p[name]


def validate_preset(name, pre):
    """한 프리셋 안에서 같은 hex가 두 램프에 있으면 안 된다.

    색을 램프로 되돌리는 연산(autoshade, bg_check의 매스 판정)이 전부 hex ->
    (램프, 단계) 역맵에 의존한다. 중복이 있으면 그 색이 엉뚱한 램프로 잡혀
    3톤·광원 게이트가 실제와 다른 값을 낸다. 실제로 interior의 near.4와
    far.2가 같은 #7C4327이라 far 매스가 단색으로 잡혔었다.
    """
    seen, dup = {}, []
    for rn, ramp in pre["ramps"].items():
        for i, h in enumerate(ramp):
            h = h.upper()
            if h in seen:
                dup.append(f"{h}: {seen[h]} == {rn}.{i}")
            seen[h] = f"{rn}.{i}"
    if dup:
        raise SystemExit(f"preset {name!r}: 램프 간 중복 hex\n  " + "\n  ".join(dup))
    return True


def hex_rgba(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def to_hex(rgb):
    return "#" + "".join(f"{max(0, min(255, int(round(c)))):02X}" for c in rgb[:3])


def resolve(color, pre):
    """'#RRGGBB' 또는 'ramp.index' (예: 'mid.2') 를 RGBA 튜플로."""
    if color is None:
        return None
    if isinstance(color, (list, tuple)):
        c = tuple(int(v) for v in color)
        return c if len(c) == 4 else c + (255,)
    c = str(color).strip()
    if c.startswith("#"):
        return hex_rgba(c)
    m = re.match(r"^([a-zA-Z_]+)\.(-?\d+)$", c)
    if not m:
        raise SystemExit(f"bad color ref {color!r} — '#RRGGBB' 또는 'ramp.i' 형식")
    ramp = pre["ramps"].get(m.group(1))
    if ramp is None:
        raise SystemExit(f"unknown ramp {m.group(1)!r} — {list(pre['ramps'])}")
    i = max(0, min(len(ramp) - 1, int(m.group(2))))
    return hex_rgba(ramp[i])


def shift(color, pre, delta):
    """'mid.2' + delta -> 'mid.3'. 리터럴 hex면 그대로."""
    c = str(color).strip()
    m = re.match(r"^([a-zA-Z_]+)\.(-?\d+)$", c)
    if not m or delta == 0:
        return color
    return f"{m.group(1)}.{int(m.group(2)) + delta}"


def bayer(x, y, t):
    """t(0~1) 비율만큼 켜지는 4x4 ordered dither."""
    if t <= 0:
        return False
    if t >= 1:
        return True
    return t * 16 > BAYER4[y % 4][x % 4]


def load_stamp(name):
    """stamps/**/name.txt -> (legend dict, rows list). legend 값은 'ramp.i' 또는 hex."""
    for sub in ("", "outdoor", "interior"):
        path = os.path.join(STAMP_ROOT, sub, f"{name}.txt")
        if os.path.isfile(path):
            return _parse_stamp(path)
    avail = []
    for sub in ("outdoor", "interior"):
        d = os.path.join(STAMP_ROOT, sub)
        if os.path.isdir(d):
            avail += [f"{sub}/{f[:-4]}" for f in sorted(os.listdir(d)) if f.endswith(".txt")]
    raise SystemExit(f"stamp {name!r} 없음. 사용 가능: {avail}")


def _parse_stamp(path):
    legend, rows, section = {}, [], None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        s = line.strip()
        if s.lower() == "[legend]":
            section = "legend"; continue
        if s.lower() == "[grid]":
            section = "grid"; continue
        if section == "legend":
            if not s or s.startswith("#"):
                continue
            m = re.match(r"^(\S)\s*=\s*(\S+)", s)
            if not m:
                raise SystemExit(f"{path}: bad legend line {s!r}")
            legend[m.group(1)] = m.group(2)
        elif section == "grid":
            if not s:
                continue
            rows.append(line.split("  #")[0].rstrip("\n"))
    if not rows:
        raise SystemExit(f"{path}: [grid] 비어 있음")
    w = max(len(r) for r in rows)
    rows = [r.ljust(w, ".") for r in rows]
    return legend, rows


def list_stamps():
    out = {}
    for sub in ("outdoor", "interior"):
        d = os.path.join(STAMP_ROOT, sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".txt"):
                legend, rows = _parse_stamp(os.path.join(d, f))
                out[f[:-4]] = (sub, len(rows[0]), len(rows))
    return out
