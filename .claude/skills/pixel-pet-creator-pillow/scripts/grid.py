#!/usr/bin/env python3
"""Turn an ASCII sprite grid into piskel draw_pixels payloads, and sanity-check it.

Why go through a text grid instead of calling draw_pixels with coordinates you
worked out in your head: at 32x32 you are placing several hundred pixels, and a
silhouette you cannot see is a silhouette you cannot judge. Writing the grid as
32 lines of 32 characters lets you *look* at the creature before it exists, fix
the shape while fixing it is free, and hand the coordinate bookkeeping to this
script.

Grid file format:

    [legend]
    K = #2C2438      # outline (project-fixed)
    B = #7FC8E8      # body
    S = #66A0BA      # body shadow
    W = #FFFFFF
    [grid]
    ................................   <- 32 rows of 32 chars, '.' = transparent
    ...

Usage:
    python3 grid.py pet.txt                 # validate + stats + per-colour counts
    python3 grid.py pet.txt --emit K        # compact JSON pixel array for one colour
    python3 grid.py pet.txt --emit-all      # every colour, ready to paste
    python3 grid.py pet.txt --render        # print the grid back with a ruler

Feed --emit output to piskel draw_pixels as {"projectId": ..., "color": "#...",
"pixels": [...]} — one call per colour, so a full sprite is 5-8 calls.
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TRANSPARENT = "."
OUTLINE_HEX = "#2C2438"


def _lightness(hex_str):
    import colorsys
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)[1]


def load(path, width, height):
    legend, rows, section = {}, [], None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        stripped = line.strip()
        if stripped.lower() == "[legend]":
            section = "legend"
            continue
        if stripped.lower() == "[grid]":
            section = "grid"
            continue
        if section == "legend":
            if not stripped or stripped.startswith("#"):
                continue
            m = re.match(r"^(\S)\s*=\s*(#?[0-9A-Fa-f]{3,8})", stripped)
            if not m:
                raise SystemExit(f"bad legend line: {stripped!r}")
            ch, hexcol = m.group(1), m.group(2)
            if not hexcol.startswith("#"):
                hexcol = "#" + hexcol
            legend[ch] = hexcol.upper()
        elif section == "grid":
            if not stripped:
                continue
            rows.append(line.split("#")[0].rstrip())
    if not legend:
        raise SystemExit("no [legend] section found")
    if not rows:
        raise SystemExit("no [grid] section found")
    errs = []
    if len(rows) != height:
        errs.append(f"grid has {len(rows)} rows, expected {height}")
    for y, r in enumerate(rows):
        if len(r) != width:
            errs.append(f"row {y} has {len(r)} chars, expected {width}")
    if errs:
        raise SystemExit("GRID SHAPE ERROR:\n  " + "\n  ".join(errs))
    return legend, rows


def analyse(legend, rows, width, height):
    problems, notes = [], []
    unknown = {}
    filled = []
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == TRANSPARENT:
                continue
            if ch not in legend:
                unknown.setdefault(ch, []).append((x, y))
                continue
            filled.append((x, y, ch))
    if unknown:
        for ch, pts in unknown.items():
            problems.append(f"character {ch!r} is not in the legend "
                            f"({len(pts)} pixels, first at {pts[0]})")
    if not filled:
        problems.append("grid is entirely transparent")
        return problems, notes, {}

    xs = [p[0] for p in filled]
    ys = [p[1] for p in filled]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    notes.append(f"bounding box  x {x0}-{x1} ({x1 - x0 + 1}px wide), "
                 f"y {y0}-{y1} ({y1 - y0 + 1}px tall)")
    notes.append(f"filled pixels {len(filled)} / {width * height} "
                 f"({100 * len(filled) // (width * height)}% coverage)")

    if x0 == 0 or y0 == 0 or x1 == width - 1 or y1 == height - 1:
        problems.append("sprite touches the canvas edge; leave at least 1px of "
                        "margin so the outline is never clipped when scaled")

    # outline should enclose the silhouette
    outline_chars = {ch for ch, hexcol in legend.items() if hexcol.upper() == OUTLINE_HEX}
    if not outline_chars:
        problems.append(f"legend has no entry for the fixed outline colour {OUTLINE_HEX} — "
                        f"it is global and cannot be adjusted per character")
    rogue_dark = [f"{ch}={hexcol}" for ch, hexcol in legend.items()
                  if hexcol.upper() != OUTLINE_HEX and _lightness(hexcol) < 0.25]
    if rogue_dark:
        problems.append(f"legend declares dark colours that are not the outline: "
                        f"{', '.join(rogue_dark)} — use {OUTLINE_HEX} for every outline pixel")
    if outline_chars:
        grid = {(x, y): ch for x, y, ch in filled}
        leaks = []
        for (x, y), ch in grid.items():
            if ch in outline_chars:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) not in grid:
                    leaks.append((x, y, ch))
                    break
        if leaks:
            sample = ", ".join(f"({x},{y})={ch}" for x, y, ch in leaks[:8])
            problems.append(f"{len(leaks)} silhouette-edge pixels are not the outline "
                            f"colour: {sample}{' ...' if len(leaks) > 8 else ''}")
        else:
            notes.append("outline fully encloses the silhouette")

    # connectivity — a creature is one piece. Checked with 4-connectivity because a
    # limb joined only at a diagonal corner looks attached in the text grid but reads
    # as a floating blob once the sprite is drawn at 1x.
    solid_set = {(x, y) for x, y, _ in filled}

    def _components(neigh):
        seen, out = set(), []
        for start in solid_set:
            if start in seen:
                continue
            stack, comp = [start], []
            seen.add(start)
            while stack:
                px_, py_ = stack.pop()
                comp.append((px_, py_))
                for dx, dy in neigh:
                    n = (px_ + dx, py_ + dy)
                    if n in solid_set and n not in seen:
                        seen.add(n)
                        stack.append(n)
            out.append(comp)
        return sorted(out, key=len, reverse=True)

    ortho = _components(((1, 0), (-1, 0), (0, 1), (0, -1)))
    if len(ortho) > 1:
        diag = _components([(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1) if (a, b) != (0, 0)])
        strays = ortho[1:]
        desc = ", ".join(f"{len(c)}px near {min(c)}" for c in strays[:5])
        big = [c for c in strays if len(c) >= 8]
        if big and len(diag) == 1:
            problems.append(f"a part touches the body only at a diagonal corner "
                            f"({desc}) — at 1x that hairline join disappears and the part "
                            f"looks detached. Widen the join to at least 1 full pixel")
        elif big:
            problems.append(f"silhouette is in {len(ortho)} separate pieces ({desc}) — "
                            f"a limb floating free of the body reads as a rendering bug. "
                            f"Attach it, or remove it")
        else:
            notes.append(f"{len(strays)} tiny detached cluster(s): {desc}")
            notes.append("  (fine only if these are deliberate sparks/runes)")
    else:
        notes.append("silhouette is one connected piece")

    # horizontal symmetry, measured on the silhouette only
    cx = (x0 + x1) / 2
    matched = mirrored = 0
    solid = {(x, y) for x, y, _ in filled}
    for (x, y) in solid:
        mx = int(round(2 * cx - x))
        if 0 <= mx < width:
            mirrored += 1
            if (mx, y) in solid:
                matched += 1
    if mirrored:
        pct = 100 * matched // mirrored
        notes.append(f"silhouette symmetry {pct}% about x={cx:.1f}")
        if pct < 70:
            notes.append("  (low symmetry is fine for a 3/4 view, suspicious for a front view)")

    # 등신 — 등급·단계와 무관한 전역 아트 규칙이므로 플래그 없이 항상 검사한다
    import budget
    import geom
    pr = geom.proportions(rows, TRANSPARENT)
    if pr:
        rt = f"{pr['ratio']:.2f}" if pr["ratio"] else "측정불가"
        notes.append(f"등신 {rt} (상한 {budget.MAX_HEAD_BODY_RATIO:.1f})  "
                     f"최대폭 {pr['max_width']}px @ 위치 {pr['widest_pos']:.2f} "
                     f"(상한 {budget.MAX_WIDEST_ROW_POS:.2f})")
        if pr["widest_pos"] > budget.MAX_WIDEST_ROW_POS:
            problems.append(
                f"가장 넓은 덩어리가 아래쪽에 있다 (위치 {pr['widest_pos']:.2f}, 상한 "
                f"{budget.MAX_WIDEST_ROW_POS:.2f}) — 몸통이 머리보다 넓다는 뜻이다. "
                f"이 도감은 머리가 가장 큰 덩어리인 크리처로 통일돼 있다. "
                f"머리를 키우거나 몸통·다리를 줄일 것")
        elif pr["ratio"] and pr["ratio"] > budget.MAX_HEAD_BODY_RATIO:
            problems.append(
                f"등신 {pr['ratio']:.2f} — 상한 {budget.MAX_HEAD_BODY_RATIO:.1f}. "
                f"머리(정수리~목선 {pr['neck'] - pr['top']}행)에 비해 몸이 길다. "
                f"다리를 줄이거나(2~3행) 머리를 키운다. "
                f"단계가 올라가도 등신은 완화되지 않는다")
        elif pr["ratio"] is None:
            notes.append("  (목선을 못 찾았다 — 머리와 몸통 사이가 잘록하지 않다는 뜻이니 "
                         "1~2px 잘록하게 만들 것)")

    counts = {}
    for _, _, ch in filled:
        counts[ch] = counts.get(ch, 0) + 1
    return problems, notes, counts


def ornament(legend, rows, grade, stage, body_hex):
    """등급 x 단계 장식 예산 검사 (budget.py).

    색 수 상한만으로는 세 단계를 같은 색 수로 통과시킬 수 있고, 면적 비율만으로는
    '무늬가 몇 조각으로 보이는가'를 못 본다. 여기서 하한을 건다.
    """
    import budget
    import geom
    g = budget.check(grade)
    problems, notes = [], []
    roles, shadow, highlight = geom.classify(legend, body_hex)

    pts = {(x, y): ch for y, r in enumerate(rows)
           for x, ch in enumerate(r) if ch != TRANSPARENT}
    area = len(pts)
    if not area:
        return ["grid is empty"], []
    used = {ch for ch in pts.values()}
    deco = {p for p, ch in pts.items() if roles.get(ch) in ("sub", "accent")}
    accent = {p for p, ch in pts.items() if roles.get(ch) == "accent"}

    ncol = len(used)
    lo, hi = budget.MIN_COLORS[g][stage], budget.MAX_COLORS[g]
    comps = geom.components(deco)
    cplx = geom.complexity(set(pts))
    acc_pct = 100 * len(accent) / area

    notes.append(f"[{g} S{stage}] 색 {ncol} (필요 {lo}~{hi})  "
                 f"장식성분 {comps} (필요 {budget.MIN_DECO_COMPONENTS[g][stage]}+)  "
                 f"복잡도 {cplx:.2f} (필요 {budget.MIN_COMPLEXITY[g][stage]:.2f}+)  "
                 f"액센트 {acc_pct:.0f}% (필요 {budget.MIN_ACCENT_PCT[g][stage]}%+)")

    if ncol < lo:
        problems.append(f"색 {ncol}종 — {g} S{stage} 하한 {lo}종. 단계가 올라가면 색이 "
                        f"늘어야 진화로 읽힌다 (상한은 {hi}종)")
    if ncol > hi:
        problems.append(f"색 {ncol}종 — {g} 상한 {hi}종 초과. 가장 적게 쓰인 색을 인접 톤에 흡수")
    if comps < budget.MIN_DECO_COMPONENTS[g][stage]:
        problems.append(f"장식 연결성분 {comps}개 — {g} S{stage} 하한 "
                        f"{budget.MIN_DECO_COMPONENTS[g][stage]}개. 면적을 넓히는 게 아니라 "
                        f"무늬 '조각 수'를 늘려야 한다 (줄무늬 한 줄 추가 = +1)")
    if cplx < budget.MIN_COMPLEXITY[g][stage]:
        problems.append(f"실루엣 복잡도 {cplx:.2f} — {g} S{stage} 하한 "
                        f"{budget.MIN_COMPLEXITY[g][stage]:.2f}. 둥근 덩어리에 가깝다는 뜻이니 "
                        f"갈기·뿔·꼬리처럼 실루엣 밖으로 나가는 부위를 세울 것")
    sym = geom.symmetry(rows, roles, TRANSPARENT)
    if sym:
        notes.append(f"축 드리프트 {sym['axis_drift']:.1f}px "
                     f"(머리 {sym['head_axis']} / 발 {sym['foot_axis']}, 상한 "
                     f"{budget.MAX_AXIS_DRIFT:.1f})  "
                     f"장식 대칭 {sym['deco_symmetry']:.0%} "
                     f"(하한 {budget.MIN_DECO_SYMMETRY:.0%}, 검사 {sym['deco_considered']}px)")
        if sym["axis_drift"] > budget.MAX_AXIS_DRIFT:
            problems.append(
                f"머리 축({sym['head_axis']})과 발 축({sym['foot_axis']})이 "
                f"{sym['axis_drift']:.1f}px 어긋난다 — 상한 {budget.MAX_AXIS_DRIFT:.1f}px. "
                f"32px에서 이건 자세가 아니라 부위가 미끄러진 것으로 읽힌다. "
                f"머리·몸통·다리를 같은 축에 맞추고, 실루엣 변화는 부위 추가로 낼 것")
        if sym["deco_symmetry"] < budget.MIN_DECO_SYMMETRY:
            spot = ", ".join(f"({x},{y})" for x, y in sym["deco_mismatched"][:6])
            problems.append(
                f"장식 대칭 {sym['deco_symmetry']:.0%} — 하한 "
                f"{budget.MIN_DECO_SYMMETRY:.0%}. 좌우 짝이 없는 장식 픽셀: {spot}"
                f"{' ...' if len(sym['deco_mismatched']) > 6 else ''}. "
                f"대칭축이 픽셀 경계라 중앙 요소는 **짝수 폭**이어야 한다 "
                f"(3px 블레이즈 → 4px, 구슬 3개 → 4개). "
                f"한쪽에만 붙는 부속물과 광원 그림자는 이 검사에서 이미 제외돼 있다")

    if acc_pct < budget.MIN_ACCENT_PCT[g][stage]:
        problems.append(f"액센트 면적 {acc_pct:.0f}% — {g} S{stage} 하한 "
                        f"{budget.MIN_ACCENT_PCT[g][stage]}%. 액센트는 몸통색과 색상환 90도 "
                        f"이상 떨어진 고채도 색이다(밝기만 올린 색은 하이라이트로 잡힌다)")
    return problems, notes


def pixels_for(rows, ch):
    return [{"x": x, "y": y}
            for y, r in enumerate(rows)
            for x, c in enumerate(r) if c == ch]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gridfile")
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--height", type=int, default=32)
    ap.add_argument("--emit", help="legend character to emit as a pixel array")
    ap.add_argument("--emit-all", action="store_true")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--grade", help="common/rare/epic — 주면 장식 예산까지 검사")
    ap.add_argument("--stage", type=int, choices=(1, 2, 3))
    ap.add_argument("--body", help="몸통 메인색 hex (--grade 와 함께 필수)")
    args = ap.parse_args()
    if args.grade and not (args.stage and args.body):
        raise SystemExit("--grade 를 쓰려면 --stage 와 --body 도 필요하다")

    legend, rows = load(args.gridfile, args.width, args.height)

    if args.emit:
        if args.emit not in legend:
            raise SystemExit(f"{args.emit!r} is not in the legend")
        print(json.dumps({"color": legend[args.emit],
                          "pixels": pixels_for(rows, args.emit)}, separators=(",", ":")))
        return
    if args.emit_all:
        for ch, hexcol in legend.items():
            pts = pixels_for(rows, ch)
            if not pts:
                continue
            print(f"\n--- {ch} = {hexcol} ({len(pts)} px) ---")
            print(json.dumps({"color": hexcol, "pixels": pts}, separators=(",", ":")))
        return

    if args.render:
        print("     " + "".join(str(x % 10) for x in range(args.width)))
        for y, r in enumerate(rows):
            print(f"{y:3}  {r}")
        print()

    problems, notes, counts = analyse(legend, rows, args.width, args.height)
    if args.grade:
        op, on = ornament(legend, rows, args.grade, args.stage, args.body)
        problems += op
        notes += on
    for n in notes:
        print("      " + n)
    print()
    for ch, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"      {ch} = {legend.get(ch, '??')}  {n} px")
    print()
    if problems:
        for p in problems:
            print("FIX   " + p)
        print("\nRESULT: FIX THE GRID (edit the text file, re-run — it is free to iterate here)")
        sys.exit(1)
    print("RESULT: grid is clean — emit the pixel arrays and draw")


if __name__ == "__main__":
    main()
