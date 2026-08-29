#!/usr/bin/env python3
"""PNG -> ASCII grid 역변환.

pixel-pet-creator가 만드는 PNG는 무손실이고 색이 legend의 hex 그대로 찍힌
것뿐이라 (안티에일리어싱 없음), 이 변환은 정보 손실 없이 grid.py 포맷으로
되돌아간다. 그 전제가 깨졌는지는 exact_match_rate로 드러난다 — 100%가 아니면
외부에서 편집됐거나(손그림, 리사이즈 스무딩) 이 파이프라인 밖에서 온 PNG다.
그 경우 자동으로 진행하지 말고 사용자에게 알린다.

Usage:
    python3 png_to_grid.py card.png --legend "K=#2C2438,B=#7FC8E8,..." --out card.txt
    python3 png_to_grid.py card.png --legend-from pet.json --out card.txt

--legend-from은 pet.json의 palette 필드(body/sub/accent 등)에서 legend를 자동
구성한다. 정확한 문자 매핑은 pet.json에 없으므로, palette.py derive 규칙
(shadow = L*0.80, highlight = L*1.15)으로 그림자/하이라이트 색도 함께 만들어
후보에 넣는다. 그래도 어긋나는 색이 있으면 --legend로 직접 넘긴다.
"""
import argparse
import colorsys
import json
import re
import sys

OUTLINE = "#2C2438"
SHADOW_FACTOR = 0.80
HIGHLIGHT_FACTOR = 1.15


def _scale_l(hexcol, factor):
    h = hexcol.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.0, min(1.0, ll * factor))
    r2, g2, b2 = colorsys.hls_to_rgb(hh, ll, ss)
    return "#{:02X}{:02X}{:02X}".format(round(r2 * 255), round(g2 * 255), round(b2 * 255))


def legend_from_pet_json(path):
    """pet.json의 palette에서 legend 후보를 만든다. 문자 배정은 관례를 따른다:
    K=outline, B=body, S=body shadow, H=body highlight,
    C1/C2...=sub colours, D1/D2...=sub shadows, A=accent, W=#FFFFFF(있으면)."""
    data = json.load(open(path, encoding="utf-8"))
    palette = data.get("palette", data)  # pet.json이 palette를 최상위에 둘 수도 있음
    body = palette["body"]
    subs = palette.get("sub", [])
    if isinstance(subs, str):
        subs = [s.strip() for s in subs.split(",") if s.strip()]
    accents = palette.get("accent", [])
    if isinstance(accents, str):
        accents = [s.strip() for s in accents.split(",") if s.strip()]

    legend = {"K": OUTLINE, "B": body, "S": _scale_l(body, SHADOW_FACTOR),
              "H": _scale_l(body, HIGHLIGHT_FACTOR), "W": "#FFFFFF"}
    for i, s in enumerate(subs):
        c = "C" if i == 0 else f"C{i+1}"
        d = "D" if i == 0 else f"D{i+1}"
        legend[c] = s
        legend[d] = _scale_l(s, SHADOW_FACTOR)
    for i, a in enumerate(accents):
        legend["A" if i == 0 else f"A{i+1}"] = a
    return legend


def png_to_grid(png_path, legend):
    from PIL import Image
    hex_to_char = {}
    for ch, hexcol in legend.items():
        h = hexcol.lstrip("#").upper()
        rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        hex_to_char[rgb] = ch

    img = Image.open(png_path).convert("RGBA")
    w, h = img.size
    rows, unmatched = [], []
    for y in range(h):
        row = []
        for x in range(w):
            r, g, b, a = img.getpixel((x, y))
            if a == 0:
                row.append(".")
                continue
            key = (r, g, b)
            if key in hex_to_char:
                row.append(hex_to_char[key])
                continue
            best_ch, best_dist = None, None
            for rgb, ch in hex_to_char.items():
                d = sum((a1 - b1) ** 2 for a1, b1 in zip(rgb, key))
                if best_dist is None or d < best_dist:
                    best_dist, best_ch = d, ch
            row.append(best_ch or "?")
            unmatched.append((x, y, key, best_ch, best_dist))
        rows.append("".join(row))

    total = w * h
    rate = 100.0 * (total - len(unmatched)) / total
    return rows, unmatched, rate, (w, h)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("png")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--legend", help="K=#2C2438,B=#7FC8E8,...")
    src.add_argument("--legend-from", help="pet.json 경로 — palette에서 legend 자동 구성")
    ap.add_argument("--out", help="grid.py 포맷으로 저장할 경로 (생략하면 stdout)")
    ap.add_argument("--allow-mismatch", action="store_true",
                    help="exact_match_rate < 100%%여도 nearest-colour로 강행 (기본은 중단)")
    args = ap.parse_args()

    legend = (legend_from_pet_json(args.legend_from) if args.legend_from
              else dict(p.split("=") for p in args.legend.split(",")))

    rows, unmatched, rate, size = png_to_grid(args.png, legend)

    sys.stderr.write(f"size={size}  exact_match_rate={rate:.2f}%  "
                     f"unmatched_pixels={len(unmatched)}\n")
    if unmatched and not args.allow_mismatch:
        sys.stderr.write(
            "\nFIX  PNG의 픽셀 중 legend 색과 정확히 일치하지 않는 것이 있다 — 이 "
            "PNG는 pixel-pet-creator/editor가 만든 것이 아니거나(손편집·리사이즈로 "
            "번짐) legend가 잘못됐다. 아래는 처음 몇 개다:\n")
        for x, y, key, ch, dist in unmatched[:10]:
            sys.stderr.write(f"  ({x},{y}) rgb={key} -> 가장 가까운 {ch} "
                             f"(거리^2={dist})\n")
        sys.stderr.write(
            "\n원본이 아닌 것으로 보이면 이 편집을 중단하고 pixel-pet-creator로 "
            "다시 그리는 것을 검토할 것. 그래도 강행하려면 --allow-mismatch.\n")
        sys.exit(1)

    out_text = ("[legend]\n" + "\n".join(f"{ch} = {hexcol}" for ch, hexcol in legend.items())
                + "\n[grid]\n" + "\n".join(rows) + "\n")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out_text)
        sys.stderr.write(f"written: {args.out}\n")
    else:
        print(out_text)


if __name__ == "__main__":
    main()
