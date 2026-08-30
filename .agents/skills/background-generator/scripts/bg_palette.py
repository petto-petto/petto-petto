#!/usr/bin/env python3
"""배경 팔레트 — 프리셋 조회 / 새 램프 파생 / 레퍼런스 이미지에서 초안 추출.

  show    --preset forest
  derive  --base '#5BC657' --steps 5
      캐릭터 규칙과 같은 상대 명도 연산(x0.80 / x1.15)을 5단으로 확장한 램프.
  from-image ref.jpg [--k 12] [--name my_mood]
      "이런 분위기" 레퍼런스가 새로 들어왔을 때 프리셋 초안(JSON)을 뽑는다.
      결과를 references/presets.json에 붙여넣기 전에 사람이 역할을 배정할 것 —
      스크립트는 밝기순 군집만 하지 sky/far/mid/near가 뭔지 모른다.
"""
import argparse
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
import colorsys
import json
import os
import sys

import bg_pillow_gate  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgcore import hex_rgba, preset, presets, to_hex

SHADOW, HIGHLIGHT = 0.80, 1.15


def hls_of(h):
    r, g, b = [c / 255 for c in hex_rgba(h)[:3]]
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, l, s


def from_hls(h, l, s):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, max(0.0, min(1.0, l)), max(0.0, min(1.0, s)))
    return to_hex((r * 255, g * 255, b * 255))


def derive_ramp(base, steps=5):
    """index 2를 base로 두고 아래는 x0.80씩, 위는 x1.15씩. 캐릭터 규칙과 같은 연산."""
    h, l, s = hls_of(base)
    mid = steps // 2
    out = []
    for i in range(steps):
        d = i - mid
        ll = l * (HIGHLIGHT ** d if d > 0 else SHADOW ** (-d))
        # 뒤로 갈수록(밝을수록) 채도를 약간 빼 공기원근에 맞춘다
        ss = s * (1 - 0.08 * max(0, d))
        out.append(from_hls(h, ll, ss))
    return out


def cmd_show(a):
    p = preset(a.preset)
    print(f"# {a.preset} — {p['label']}")
    print(f"  source: {p.get('source','-')}   mood: {', '.join(p.get('mood',[]))}")
    for name, ramp in p["ramps"].items():
        line = "  ".join(f"{i}:{c}" for i, c in enumerate(ramp))
        print(f"  {name:<7} {line}")
    print(f"  defaults: {p.get('defaults', {})}")
    print("  예약색  #2C2438 (캐릭터 외곽선) — 배경 전체의 3% 초과 금지")


def cmd_derive(a):
    ramp = derive_ramp(a.base, a.steps)
    for i, c in enumerate(ramp):
        h, l, s = hls_of(c)
        mark = "  <- base" if i == a.steps // 2 else ""
        print(f"  {i}: {c}  H{h:5.0f} S{s*100:3.0f} L{l*100:3.0f}{mark}")
    print(f'\n  "ramp": {json.dumps(ramp)}')


def cmd_shift(a):
    """램프의 명도/채도를 옮기되 **폭은 유지**해 scene.ramps 오버라이드를 찍는다.

    "더 화사하게 해줘"를 단계를 위로 미는 식으로 처리하면 램프 상단이 압축돼
    매스가 평평해진다(광원 일관성이 69%까지 떨어졌다). 밝기는 각 단에 더하고,
    단 사이 간격은 그대로 두어야 입체감이 남는다.
    """
    pre = preset(a.preset)
    names = [n.strip() for n in a.ramps.split(",")] if a.ramps else list(pre["ramps"])
    out = {}
    for n in names:
        ramp = pre["ramps"].get(n)
        if not ramp:
            raise SystemExit(f"램프 {n!r} 없음 — {list(pre['ramps'])}")
        ls = [hls_of(c)[1] for c in ramp]
        span = max(ls) - min(ls)
        new = []
        for c in ramp:
            h, l, sa = hls_of(c)
            nl = min(0.97, max(0.03, l + a.light))
            new.append(from_hls(h + a.hue, nl, min(1.0, max(0.0, sa * (1 + a.sat)))))
        ns = [hls_of(c)[1] for c in new]
        keep = span - (max(ns) - min(ns))
        print(f"# {n}: 명도폭 {span:.3f} -> {max(ns)-min(ns):.3f}"
              + ("  (폭 유지)" if abs(keep) < 0.03 else "  ** 폭이 줄었다 — light 값을 낮출 것"),
              file=sys.stderr)
        out[n] = new
    print(json.dumps({"ramps": out}, ensure_ascii=False, indent=2))


def cmd_from_image(a):
    from PIL import Image
    im = Image.open(a.image).convert("RGB")
    q = im.quantize(colors=a.k, method=Image.MEDIANCUT).convert("RGB")
    total = im.size[0] * im.size[1]
    cols = sorted(q.getcolors(a.k * 4), reverse=True)
    entries = []
    for n, c in cols:
        h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in c])
        entries.append({"hex": to_hex(c), "share": n / total, "H": h * 360, "L": l, "S": s})
    print(f"# {os.path.basename(a.image)}  {im.size[0]}x{im.size[1]}  k={a.k}")
    for e in sorted(entries, key=lambda e: -e["share"]):
        print(f"  {e['hex']}  {e['share']*100:5.1f}%  H{e['H']:5.0f} S{e['S']*100:3.0f} L{e['L']*100:3.0f}")

    by_l = sorted(entries, key=lambda e: e["L"])
    picks = [by_l[min(len(by_l) - 1, round(i * (len(by_l) - 1) / 4))]["hex"] for i in range(5)]
    dominant = max(entries, key=lambda e: e["share"] * (0.5 + e["S"]))["hex"]
    draft = {a.name: {
        "label": "TODO — 한 줄 설명",
        "source": os.path.basename(a.image),
        "mood": ["TODO", "키워드"],
        "ramps": {
            "sky": picks[::-1] if by_l[0]["L"] > 0.4 else picks,
            "far": derive_ramp(picks[3]),
            "mid": derive_ramp(dominant),
            "near": derive_ramp(picks[1]),
            "wood": derive_ramp(picks[2]),
            "accent": derive_ramp(max(entries, key=lambda e: e["S"])["hex"]),
            "light": derive_ramp(picks[4]),
        },
        "defaults": {"horizon": 56, "groundTop": 92}}}
    print("\n# presets.json 초안 — 역할 배정은 사람이 확인할 것")
    print(json.dumps(draft, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("show"); s.add_argument("--preset", required=True); s.set_defaults(fn=cmd_show)
    s = sub.add_parser("list"); s.set_defaults(fn=lambda a: [
        print(f"  {k:<9} {v['label']}\n            mood: {', '.join(v.get('mood', []))}")
        for k, v in presets().items()])
    s = sub.add_parser("derive"); s.add_argument("--base", required=True)
    s.add_argument("--steps", type=int, default=5); s.set_defaults(fn=cmd_derive)
    s = sub.add_parser("shift", help="scene.ramps 오버라이드 생성 (밝게/채도 조정)")
    s.add_argument("--preset", required=True)
    s.add_argument("--ramps", help="쉼표 구분. 생략하면 전부")
    s.add_argument("--light", type=float, default=0.0, help="각 단에 더할 명도 (예: 0.08)")
    s.add_argument("--sat", type=float, default=0.0, help="채도 배율 증감 (예: 0.15)")
    s.add_argument("--hue", type=float, default=0.0)
    s.set_defaults(fn=cmd_shift)
    s = sub.add_parser("from-image"); s.add_argument("image")
    s.add_argument("--k", type=int, default=12); s.add_argument("--name", default="custom")
    s.set_defaults(fn=cmd_from_image)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
