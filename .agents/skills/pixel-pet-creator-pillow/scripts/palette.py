#!/usr/bin/env python3
"""Palette math + verification for pixel-pet-creator.

  derive  --body '#7FC8E8' [--sub '#FFD166,#FFFFFF'] [--grade rare]
      Print the working palette: the project-fixed outline, the shadow
      (body lightness x 0.80) and highlight (x 1.15), plus each sub colour's
      shadow. With --grade it also prints that grade's budget.

  verify  --body '#7FC8E8' --sub '#FFD166' --grade rare --used '<from get_used_colors>'
      Check what the sprite actually uses. Exit 0 = clear to export, 1 = do not
      export until fixed.

      --used takes hex values, optionally with pixel counts:
          '#2C2438,#7FC8E8,#42AEDD'              -> identity checks only
          '#2C2438:310,#7FC8E8:305,#42AEDD:272'  -> identity AND area checks

      Pass the counts. get_used_colors already reports them, and area is where
      sprites quietly go wrong: the palette can be perfectly legal while the
      shadow covers 3% of the body (flat, reads as a sticker) or a sub colour
      covers 16% (the belly becomes the character). Those failures are invisible
      to a colour-identity check but obvious in the finished art.

Lightness is HSL L. "20% darker" is a relative multiply (L * 0.80) so that dark
and light body colours behave the same way; subtracting a fixed amount would
crush dark colours to black and barely touch light ones.
"""

import argparse
import colorsys
import sys

OUTLINE = "#2C2438"
SHADOW_FACTOR = 0.80
HIGHLIGHT_FACTOR = 1.15
L_TOLERANCE = 0.05
HUE_TOLERANCE = 30.0
DARK_L = 0.25

# Area bands, as a fraction of the sprite's non-outline (i.e. coloured) pixels
# unless stated otherwise. Derived from sprites that read well at 1x.
SHADE_HARD_MIN = 0.10   # below this the sprite is flat; blocks export
SHADE_MIN = 0.15        # comfortable floor
SHADE_MAX = 0.45        # above this the shadow has eaten the body
SUB_MAX = 0.12          # any single sub colour, as a fraction of all opaque px
SUB_TOTAL_MAX = 0.30    # all sub colours together
OUTLINE_MIN = 0.15      # of all opaque px; below this the parts merge
OUTLINE_MAX = 0.40

BUDGET = {"common": {"max_colors": 6, "subs": 1},
          "rare": {"max_colors": 8, "subs": 2},
          "epic": {"max_colors": 11, "subs": 3}}


def parse_hex(s):
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) == 8:
        s = s[:6]
    if len(s) != 6:
        raise ValueError(f"not a hex colour: {s}")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def to_hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c))):02X}" for c in rgb)


def to_hls(hex_str):
    r, g, b = (c / 255 for c in parse_hex(hex_str))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, l, s


def from_hls(h_deg, l, s):
    r, g, b = colorsys.hls_to_rgb((h_deg % 360) / 360, max(0.0, min(1.0, l)), s)
    return to_hex((r * 255, g * 255, b * 255))


def scale_lightness(hex_str, factor):
    h, l, s = to_hls(hex_str)
    return from_hls(h, l * factor, s)


def hue_distance(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def split(arg):
    return [x for x in (arg or "").replace(" ", "").split(",") if x]


def parse_used(arg):
    """-> (ordered hex list, {hex: count} or {} when no counts were given)."""
    colours, counts = [], {}
    for token in split(arg):
        for sep in (":", "="):
            if sep in token:
                h, _, n = token.partition(sep)
                try:
                    counts[to_hex(parse_hex(h))] = int(n)
                except ValueError:
                    pass
                token = h
                break
        try:
            colours.append(to_hex(parse_hex(token)))
        except ValueError:
            print(f"SKIP  파싱 불가: {token}")
    if len(counts) != len(colours):
        counts = {}  # partial counts are worse than none
    return colours, counts


def cmd_derive(args):
    body = args.body
    print(f"outline    {OUTLINE}   (전역 고정 — 캐릭터마다 다르게 쓸 수 없다)")
    print(f"body       {to_hex(parse_hex(body))}   (종 단위 고정 — Stage 2·3도 이 색)")
    print(f"shadow     {scale_lightness(body, SHADOW_FACTOR)}   (body L x {SHADOW_FACTOR})")
    print(f"highlight  {scale_lightness(body, HIGHLIGHT_FACTOR)}   (body L x {HIGHLIGHT_FACTOR})")
    for i, sub in enumerate(split(args.sub), 1):
        print(f"sub{i}       {to_hex(parse_hex(sub))}"
              f"   shadow {scale_lightness(sub, SHADOW_FACTOR)}")
    if args.grade:
        b = BUDGET[args.grade]
        print(f"\n{args.grade} 예산: 색 {b['max_colors']}종 이하 / 보조색 {b['subs']}개")
        if args.grade == "common":
            print("  하이라이트 생략 가능, 액센트색 없음")
        elif args.grade == "rare":
            print("  하이라이트 필수, 액센트색 1 (몸통색과 색상환 90도 이상)")
        else:
            print("  하이라이트 필수, 액센트색 2, 좌상단 림라이트 1px")
    print(f"\n면적 기준 (색 못지않게 중요)")
    print(f"  그림자   유채색 픽셀의 {int(SHADE_MIN*100)}~{int(SHADE_MAX*100)}% "
          f"({int(SHADE_HARD_MIN*100)}% 미만이면 export 차단)")
    print(f"  보조색   각 {int(SUB_MAX*100)}% 이하, 합계 {int(SUB_TOTAL_MAX*100)}% 이하 (전체 대비)")
    print(f"  외곽선   전체의 {int(OUTLINE_MIN*100)}~{int(OUTLINE_MAX*100)}%")
    return 0


def cmd_verify(args):
    body = to_hex(parse_hex(args.body))
    subs = [to_hex(parse_hex(s)) for s in split(args.sub)]
    used, counts = parse_used(args.used)
    if not used:
        print("FAIL  --used 가 비어 있다. piskel get_used_colors 부터 실행할 것")
        return 1

    expected_shadow = scale_lightness(body, SHADOW_FACTOR)
    expected_high = scale_lightness(body, HIGHLIGHT_FACTOR)
    sub_shadows = [scale_lightness(s, SHADOW_FACTOR) for s in subs]
    sub_highs = [scale_lightness(s, HIGHLIGHT_FACTOR) for s in subs]
    ok = True

    # ---- 1. outline: hard gate, no exceptions -----------------------------
    if OUTLINE in [c.upper() for c in used]:
        print(f"PASS  외곽선 {OUTLINE} 정확히 사용됨")
    else:
        darks = [c for c in used if to_hls(c)[1] < DARK_L]
        print(f"FAIL  외곽선 {OUTLINE} 이 없다"
              + (f" — 대신 쓰인 어두운 색: {', '.join(darks)}" if darks else ""))
        for d in darks:
            print(f"      -> piskel replace_color oldColor={d} newColor={OUTLINE} allFrames=true")
        ok = False
    rogue = [c for c in used if c.upper() != OUTLINE and to_hls(c)[1] < DARK_L]
    if rogue:
        print(f"FAIL  외곽선 자리에 다른 어두운 색이 섞여 있다: {', '.join(rogue)}")
        print(f"      전역 고정 팔레트는 캐릭터별로 조정할 수 없다. 전부 {OUTLINE} 로 교체할 것")
        for c in rogue:
            print(f"      -> piskel replace_color oldColor={c} newColor={OUTLINE} allFrames=true")
        ok = False
    elif OUTLINE in [c.upper() for c in used]:
        print("PASS  외곽선 이외의 어두운 색 없음")

    # ---- 2. body shadow tone ---------------------------------------------
    bh, bl, _ = to_hls(body)
    _, target_l, _ = to_hls(expected_shadow)
    cand = []
    for c in used:
        if c.upper() == OUTLINE or c == body or c in subs:
            continue
        h, l, _ = to_hls(c)
        if l < bl and hue_distance(h, bh) <= HUE_TOLERANCE:
            cand.append((abs(l - target_l), c, l))
    shadow_actual = None
    if not cand:
        print(f"WARN  몸통 그림자로 볼 색이 없다 (기대값 {expected_shadow})")
    else:
        cand.sort()
        delta, shadow_actual, actual_l = cand[0]
        if delta <= L_TOLERANCE:
            print(f"PASS  몸통 그림자 톤 {shadow_actual} 허용범위 내 (기대 {expected_shadow})")
        else:
            print(f"FAIL  몸통 그림자 {shadow_actual} 이탈 (L {actual_l:.2f} / 목표 {target_l:.2f}, "
                  f"허용 ±{L_TOLERANCE})")
            print(f"      -> piskel replace_color oldColor={shadow_actual} "
                  f"newColor={expected_shadow} allFrames=true")
            ok = False

    # ---- 3. colour budget -------------------------------------------------
    n = len(used)
    if args.grade:
        cap = BUDGET[args.grade]["max_colors"]
        if n <= cap:
            print(f"PASS  색 {n}종 ({args.grade} 상한 {cap})")
        else:
            print(f"FAIL  색 {n}종 — {args.grade} 상한 {cap} 초과")
            print("      가장 적게 쓰인 색부터 인접 톤으로 흡수시킬 것")
            ok = False
        if len(subs) > BUDGET[args.grade]["subs"]:
            print(f"FAIL  보조색 {len(subs)}개 — {args.grade} 상한 "
                  f"{BUDGET[args.grade]['subs']}개 초과")
            ok = False
    else:
        print(f"INFO  색 {n}종 (--grade 를 주면 등급 상한으로 검사한다)")

    # ---- 4. AREA — the part a colour list cannot see ----------------------
    if not counts:
        print("INFO  픽셀 수가 없어 면적 검사를 건너뛴다. get_used_colors 의 count를 "
              "'#RRGGBB:1234' 형태로 --used 에 함께 넘기면 검사한다")
    else:
        total = sum(counts.values())
        outline_px = counts.get(OUTLINE, 0)
        coloured = total - outline_px
        if coloured <= 0:
            print("FAIL  외곽선 말고는 칠해진 픽셀이 없다")
            ok = False
        else:
            # 4a. shading mass
            shade_px = counts.get(shadow_actual, 0) if shadow_actual else 0
            r = shade_px / coloured
            if args.allow_flat:
                print(f"INFO  그림자 {r:.0%} — --allow-flat 지정으로 검사 생략")
            elif r < SHADE_HARD_MIN:
                print(f"FAIL  그림자가 유채색 면적의 {r:.0%}뿐이다 "
                      f"({shade_px}/{coloured}px). 이 정도면 평면으로 읽혀 "
                      f"입체감이 없다")
                print(f"      외곽선에 닿는 1px 띠만 칠하지 말고, 광원 반대쪽 '면'을 "
                      f"덩어리로 덮을 것 — 목표 {SHADE_MIN:.0%}~{SHADE_MAX:.0%}")
                print(f"      의도한 플랫 셰이딩이면 --allow-flat 을 붙여 다시 실행")
                ok = False
            elif r < SHADE_MIN:
                print(f"WARN  그림자 {r:.0%} — 하한({SHADE_MIN:.0%})에 못 미친다. "
                      f"광원 반대쪽 면을 조금 더 덮는 편이 낫다")
            elif r > SHADE_MAX:
                print(f"WARN  그림자 {r:.0%} — 상한({SHADE_MAX:.0%}) 초과. "
                      f"그림자가 본체보다 넓으면 탁해 보인다")
            else:
                print(f"PASS  그림자 면적 {r:.0%} (기준 {SHADE_MIN:.0%}~{SHADE_MAX:.0%})")

            # 4b. sub colours must not take over the silhouette
            sub_total = 0
            for s in subs:
                s_px = counts.get(s, 0) + counts.get(scale_lightness(s, SHADOW_FACTOR), 0)
                sub_total += s_px
                sr = s_px / total
                if sr > SUB_MAX:
                    print(f"FAIL  보조색 {s} 이 전체의 {sr:.0%} — 상한 {SUB_MAX:.0%} 초과. "
                          f"보조색이 넓으면 그게 캐릭터의 주인공이 된다(배가 큰 소처럼 보이는 원인)")
                    print(f"      영역을 줄이거나, 이 색을 몸통 메인색으로 삼을지 다시 판단할 것")
                    ok = False
            if subs:
                tr = sub_total / total
                if tr > SUB_TOTAL_MAX:
                    print(f"FAIL  보조색 합계 {tr:.0%} — 상한 {SUB_TOTAL_MAX:.0%} 초과")
                    ok = False
                elif not any(counts.get(s, 0) / total > SUB_MAX for s in subs):
                    print(f"PASS  보조색 면적 합계 {tr:.0%} (상한 {SUB_TOTAL_MAX:.0%})")

            # 4c. body colour should still dominate
            body_px = counts.get(body, 0)
            if body_px and body_px != max(v for k, v in counts.items() if k.upper() != OUTLINE):
                top = max(((v, k) for k, v in counts.items() if k.upper() != OUTLINE))
                print(f"WARN  가장 넓은 색이 몸통색({body}, {body_px/total:.0%})이 아니라 "
                      f"{top[1]}({top[0]/total:.0%})이다. 종 정체성이 흐려진다")

            # 4d. outline mass — too little means parts merge into one blob
            orat = outline_px / total
            if orat < OUTLINE_MIN:
                print(f"WARN  외곽선이 전체의 {orat:.0%}뿐이다. 실루엣 바깥만 두르고 "
                      f"부위 사이(날개-몸통, 팔-몸통)에 선을 안 그으면 한 덩어리로 뭉친다")
            elif orat > OUTLINE_MAX:
                print(f"WARN  외곽선이 전체의 {orat:.0%}. 선이 두꺼워 색이 들어갈 자리가 없다")
            else:
                print(f"PASS  외곽선 면적 {orat:.0%} (기준 {OUTLINE_MIN:.0%}~{OUTLINE_MAX:.0%})")

    # ---- 5. strays --------------------------------------------------------
    allowed = {OUTLINE.upper(), body.upper(), expected_shadow.upper(), expected_high.upper()}
    allowed |= {s.upper() for s in subs} | {s.upper() for s in sub_shadows} | {s.upper() for s in sub_highs}
    strays = []
    for c in used:
        if c.upper() in allowed:
            continue
        if any(hue_distance(to_hls(c)[0], to_hls(a)[0]) <= HUE_TOLERANCE
               and abs(to_hls(c)[1] - to_hls(a)[1]) <= L_TOLERANCE for a in allowed):
            continue
        strays.append(c)
    if strays:
        print(f"WARN  선언한 팔레트 밖의 색: {', '.join(strays)}")
        print("      의도한 액센트/림라이트면 그대로. 실수로 섞인 톤이면 replace_color 로 정리")
    else:
        print("PASS  팔레트 이탈색 없음")

    if ok:
        print("\nRESULT: PASS — export 진행 가능")
    else:
        print("\nRESULT: FAIL — 고치고 get_used_colors 부터 다시. **통과 전에는 export 하지 않는다**")
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("derive")
    d.add_argument("--body", required=True)
    d.add_argument("--sub", default="")
    d.add_argument("--grade", choices=list(BUDGET))
    d.set_defaults(func=cmd_derive)

    v = sub.add_parser("verify")
    v.add_argument("--body", required=True)
    v.add_argument("--sub", default="")
    v.add_argument("--grade", choices=list(BUDGET))
    v.add_argument("--used", required=True,
                   help="from get_used_colors; '#RRGGBB' or '#RRGGBB:count'")
    v.add_argument("--allow-flat", action="store_true",
                   help="skip the shading-mass gate for a deliberately flat sprite")
    v.set_defaults(func=cmd_verify)

    args = p.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
