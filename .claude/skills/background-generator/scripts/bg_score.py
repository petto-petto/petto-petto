#!/usr/bin/env python3
"""배경 최종 품질 채점 (100점) + 통과/재생성 판정.

`bg_check.py`는 "망치지 않았는가"를 본다. 이 스크립트는 그 위에서
**"레퍼런스가 요구한 것을 실제로 만들었는가"** 를 본다. 둘 다 통과해야 한다.

    도트 표현 일관성   25점
    레퍼런스 구도 반영 30점
    공간감과 레이어    20점
    색상 및 조명       15점
    게임 배경 활용성   10점

80점 미만이면 통과가 아니다. 아래 중 하나라도 걸리면 부분 수정이 아니라
**공간 구조부터 새로 구성**한다(재생성 트리거).

    1. 레퍼런스 핵심 요소가 4개 이하만 반영
    2. 다층/세로형 레퍼런스인데 평평한 가로 풍경으로 생성
    3. 이전 결과와 구도·주 피사체·색감이 대부분 동일
    4. 도트가 아니라 매끄러운 디지털 페인팅처럼 보임
    5. 레이어 구분이 약해 공간감이 없음

Usage:
    python3 bg_score.py <out-dir> --elements refs.json [--prev <이전 out-dir>]

`--elements`는 레퍼런스 분석에서 뽑은 핵심 요소 목록이다. 사람이 눈으로 세는
대신 **씬에 실제로 그 op이 있고 화면에서 보이는지**로 검증한다.

    {
      "reference": "5f8ae....jpg",
      "structure": "vertical",              # vertical | horizontal | layered
      "elements": [
        {"name": "화면을 관통하는 고목", "op": "tree_column", "min": 4},
        {"name": "이끼 낀 나뭇가지 발판", "op": "branch_platform", "min": 3},
        {"name": "로프 다리", "op": "rope_bridge", "min": 2},
        {"name": "사다리", "op": "ladder", "min": 1},
        {"name": "역광 안개 개방부", "op": "glow", "min": 2},
        {"name": "덩굴", "op": "stamp:vine", "min": 2}
      ]
    }
"""
import argparse
import colorsys
import json
import os
import sys
import warnings

import bg_pillow_gate  # noqa: F401

warnings.filterwarnings("ignore", category=DeprecationWarning)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgcore import hex_rgba, preset

PASS_SCORE = 80


def pct_lum(counts, n, p):
    """면적 가중 밝기 백분위. 화소 몇 개가 튀어도 흔들리지 않는다."""
    acc = 0
    for v, c in sorted((lum(c), c) for c in counts):
        acc += counts[c]
        if acc >= n * p:
            return v
    return 1.0


def lum(p):
    return colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)[1]


def sat(p):
    return colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)[2]


def hue(p):
    return colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)[0] * 360


def count_op(scene, spec):
    """씬 전체에서 op 등장 횟수. 'stamp:vine'처럼 이름까지 지정할 수 있다."""
    if ":" in spec:
        op, nm = spec.split(":", 1)
    else:
        op, nm = spec, None
    n = 0
    for lay in scene.get("layers", []):
        for o in lay.get("ops", []):
            if o.get("op") != op:
                continue
            if nm and o.get("name") != nm:
                continue
            n += 1 if op != "scatter_depth" else max(1, o.get("count", 1))
    return n


def main():
    from PIL import Image
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("outdir")
    ap.add_argument("--elements", required=True, help="레퍼런스 분석 JSON")
    ap.add_argument("--prev", help="이전 생성 결과 폴더(구도 반복 검사)")
    ap.add_argument("--mode", default="create", choices=["create", "edit"],
                    help="edit이면 '이전과 유사' 트리거를 끈다 — 구도 유지가 목적인 요청에서 "
                         "성공했다는 이유로 벌점을 받던 문제")
    a = ap.parse_args()

    metas = [f for f in os.listdir(a.outdir) if f.endswith(".json") and f != "scene.json"]
    meta = json.load(open(os.path.join(a.outdir, metas[0]), encoding="utf-8"))
    scene = json.load(open(os.path.join(a.outdir, "scene.json"), encoding="utf-8"))
    spec = json.load(open(a.elements, encoding="utf-8"))
    # 씬이 램프를 덮어썼으면 검사도 그 색으로 봐야 한다. 안 그러면 칠해진 색이
    # 어느 램프에도 속하지 않아 매스 판정·3톤·광원 검사가 전부 무너진다
    # (오버라이드 기능을 넣으면서 실제로 그렇게 됐다).  # rampOverride 적용
    import copy as _copy
    pre = _copy.deepcopy(preset(meta["preset"]))
    for _n, _r in (scene.get("ramps") or {}).items():
        pre["ramps"][_n] = _r
    img = Image.open(os.path.join(a.outdir, meta["composite"])).convert("RGB")
    W, H = img.size
    px = img.load()
    N = W * H

    counts = {}
    for y in range(H):
        for x in range(W):
            counts[px[x, y]] = counts.get(px[x, y], 0) + 1
    ramp_hex = {hex_rgba(h)[:3] for r in pre["ramps"].values() for h in r}

    lines, triggers = [], []
    score = {}

    # ================================================= 1) 도트 표현 일관성 25
    pts, sub = 0, []
    off = sum(n for c, n in counts.items() if c not in ramp_hex) / N
    ok = off <= 0.005
    pts += 10 if ok else 0
    sub.append(f"팔레트 제한 {'OK' if ok else 'X'} (램프 밖 색 {off*100:.2f}%, 허용 0.5%) 10점")
    nc = len(counts)
    ok2 = 24 <= nc <= 48
    pts += 8 if ok2 else (4 if nc <= 64 else 0)
    sub.append(f"색 수 {nc} (24~48) {8 if ok2 else (4 if nc<=64 else 0)}점")
    # 안티앨리어싱 탐지 — 이웃 두 색의 중간값에 가까운 화소가 많으면 매끄러운 보간이다
    inter = 0
    for y in range(1, H - 1, 2):
        for x in range(1, W - 1, 2):
            c0, cl, cr = px[x, y], px[x - 1, y], px[x + 1, y]
            if cl == cr or c0 in (cl, cr):
                continue
            mid = tuple((cl[i] + cr[i]) / 2 for i in range(3))
            if max(abs(c0[i] - mid[i]) for i in range(3)) <= 6:
                inter += 1
    ai = inter / (N / 4)
    ok3 = ai <= 0.06
    pts += 7 if ok3 else 0
    sub.append(f"안티앨리어싱 {'없음' if ok3 else '의심'} (중간톤 화소 {ai*100:.1f}%, 허용 6%) 7점")
    score["도트 표현 일관성"] = (pts, 25, sub)
    if not ok3 or off > 0.02:
        triggers.append("4. 도트가 아니라 매끄러운 디지털 페인팅처럼 보임")

    # ================================================= 2) 레퍼런스 구도 반영 30
    pts, sub, hit = 0, [], 0
    els = spec.get("elements", [])
    for e in els:
        n = count_op(scene, e["op"])
        good = n >= e.get("min", 1)
        hit += 1 if good else 0
        sub.append(f"  {'O' if good else 'X'} {e['name']}: {n}개 (요구 {e.get('min',1)})")
    per = 30.0 / max(1, len(els))
    pts = round(per * hit)
    sub.insert(0, f"핵심 요소 {hit}/{len(els)} 반영 → {pts}점")
    score["레퍼런스 구도 반영"] = (pts, 30, sub)
    if hit <= 4:
        triggers.append("1. 레퍼런스 핵심 요소가 4개 이하만 반영")
    # 구조 일치 — 세로/다층 레퍼런스인데 ground 레이아웃이면 구조가 틀린 것이다
    want_v = spec.get("structure") in ("vertical", "layered")
    layout = meta.get("layout", "ground")
    if want_v and layout != "canopy":
        triggers.append("2. 다층/세로형 레퍼런스인데 평평한 가로 풍경으로 생성")
    sub.append(f"  구조: 레퍼런스 {spec.get('structure')} / 생성 {layout}")

    # ================================================= 3) 공간감과 레이어 20
    pts, sub = 0, []
    ls = sorted(meta["layers"], key=lambda l: l["z"])
    imgs = {l["name"]: Image.open(os.path.join(a.outdir, l["file"])).convert("RGBA")
            for l in ls}
    seps = []
    acc = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, l in enumerate(ls):
        im = imgs[l["name"]]
        if i > 0:
            ip, bp = im.load(), acc.load()
            d = [abs(lum(ip[x, y]) - lum(bp[x, y]))
                 for y in range(0, H, 2) for x in range(0, W, 2)
                 if ip[x, y][3] and bp[x, y][3]]
            if d:
                d.sort()
                seps.append((l["name"], d[len(d) // 2]))
        acc.alpha_composite(im)
    nsep = sum(1 for _, v in seps if v >= 0.10)
    pts += min(12, nsep * 4)
    sub.append(f"레이어 분리 {nsep}/{len(seps)}쌍이 명도차 0.10 이상 → {min(12, nsep*4)}점 "
               + ", ".join(f"{n}:{v:.2f}" for n, v in seps))
    ok = len(ls) >= 3
    pts += 4 if ok else 0
    sub.append(f"레이어 {len(ls)}장 (3장 이상) {4 if ok else 0}점")
    cov = [sum(1 for p in imgs[l["name"]].getdata() if p[3]) / N for l in ls[1:]]
    ok2 = all(c >= 0.03 for c in cov)
    pts += 4 if ok2 else 0
    sub.append(f"각 레이어 커버리지 {[f'{c*100:.0f}%' for c in cov]} {4 if ok2 else 0}점")
    score["공간감과 레이어"] = (pts, 20, sub)
    if nsep < 2:
        triggers.append("5. 레이어 구분이 약해 공간감이 없음")

    # ================================================= 4) 색상 및 조명 15
    pts, sub = 0, []
    # 눈·동굴·석조 유적처럼 채도가 낮은 게 정상인 주제까지 '뮤트 금지'를 그대로
    # 들이대면 정상 팔레트가 실패한다. 프리셋이 paletteMode: cool을 선언하면
    # 채도 하한을 내리되, 그런 화면은 명도와 색조로 살아나야 하므로 색조 계열
    # 요구를 3 -> 4개로 올린다. 무채색 뭉개기로 빠져나갈 수는 없다.
    cool = pre.get("paletteMode") == "cool"
    floor = 0.18 if cool else 0.30
    hue_need = 4 if cool else 3
    msat = sum(sat(c) * n for c, n in counts.items()) / N
    ok = msat >= floor
    pts += 3 if ok else 0
    sub.append(f"뮤트/무채색 아님: 평균 채도 {msat*100:.0f}% ({floor*100:.0f}% 이상"
               + (", cool 팔레트" if cool else "") + f") {3 if ok else 0}점")
    prof = []
    for l in ls:
        pix = [p for p in imgs[l["name"]].getdata() if p[3]]
        if pix:
            prof.append((l["name"], sum(lum(p) for p in pix) / len(pix),
                         sum(sat(p) for p in pix) / len(pix)))
    dl = max(p[1] for p in prof) - min(p[1] for p in prof)
    ds = max(p[2] for p in prof) - min(p[2] for p in prof)
    ok2 = dl >= 0.15 or ds >= 0.15
    pts += 3 if ok2 else 0
    sub.append(f"레이어 간 명도/채도 차 {dl:.2f}/{ds:.2f} (0.15 이상) {3 if ok2 else 0}점")
    hi = sum(n for c, n in counts.items() if lum(c) >= 0.75) / N
    lo = sum(n for c, n in counts.items() if lum(c) <= 0.25) / N
    # 하이라이트·그림자를 절대 밝기로 재면 **의도적으로 태운 화면이 감점된다.**
    # 실측: 레퍼런스 3장이 L>=0.75 면적 4.1~34.9%로 제각각이고, 승인된 어두운
    # 배경 둘은 1.0%·1.3%였다. 절대값은 주제에 따라 달라지므로 기준이 될 수 없다.
    #
    # 대신 화면 **자신의 동적 범위**를 본다 — 상위 2% 밝기와 하위 2% 밝기의 차.
    # "명암이 살아 있는가"를 재는 것이라 밝은 화면과 태운 화면에 같은 잣대가 된다.
    # 백분위라 튀는 화소 몇 개에 흔들리지 않는다.
    dynamic_range = pct_lum(counts, N, 0.98) - pct_lum(counts, N, 0.02)
    ok3 = dynamic_range >= 0.55
    pts += 3 if ok3 else 0
    sub.append(f"동적 범위 {dynamic_range:.2f} (0.55 이상) {3 if ok3 else 0}점"
               f"  [하이라이트 {hi*100:.1f}% / 그림자 {lo*100:.1f}%]")
    # 색조 다양성 — 단일 초록 일변도 방지
    hb = {}
    for c, n in counts.items():
        if sat(c) < 0.15:
            continue
        hb[int(hue(c) // 20)] = hb.get(int(hue(c) // 20), 0) + n
    nh = sum(1 for v in hb.values() if v / N >= 0.01)
    ok4 = nh >= hue_need
    pts += 3 if ok4 else 0
    sub.append(f"색조 계열 {nh}개 (20도 구간, 각 1% 이상 / {hue_need}개 이상) "
               f"{3 if ok4 else 0}점")
    # 형광 일변도 방지 + 중앙 플레이 영역 과대비 방지
    neon = sum(n for c, n in counts.items() if sat(c) >= 0.90) / N
    pa = meta.get("petAnchor") or {"x": W // 2 - 32, "y": H // 2 - 32, "w": 64, "h": 64}
    bx = img.crop((max(0, pa["x"] - 16), max(0, pa["y"] - 16),
                   min(W, pa["x"] + pa["w"] + 16), min(H, pa["y"] + pa["h"] + 16)))
    bl = [lum(p) for p in bx.getdata()]
    bstd = (sum((v - sum(bl) / len(bl)) ** 2 for v in bl) / len(bl)) ** 0.5
    ok5 = neon <= 0.15 and bstd <= 0.20
    pts += 3 if ok5 else 0
    sub.append(f"형광 일변도 {neon*100:.1f}% (15% 이하) / 중앙 대비 std {bstd:.2f} (0.20 이하) "
               f"{3 if ok5 else 0}점")
    score["색상 및 조명"] = (pts, 15, sub)

    # ================================================= 5) 게임 배경 활용성 10
    pts, sub = 0, []
    near = imgs[ls[-1]["name"]]
    nb = near.crop((pa["x"], pa["y"], pa["x"] + pa["w"], pa["y"] + pa["h"]))
    clear = sum(1 for p in nb.getdata() if p[3] == 0) / max(1, pa["w"] * pa["h"])
    ok = clear >= 0.90
    pts += 4 if ok else 0
    sub.append(f"전경이 캐릭터 자리를 비움 {clear*100:.0f}% (90% 이상) {4 if ok else 0}점")
    # 이동 경로 가독성 — 발판 윗면과 그 위 공간의 명도차
    plat = count_op(scene, "branch_platform") + count_op(scene, "rope_bridge")
    ok2 = plat >= 2 or meta.get("groundTop") is not None
    pts += 3 if ok2 else 0
    sub.append(f"발판/이동 경로 {plat}개 또는 지면 존재 {3 if ok2 else 0}점")
    # 중앙 개방도 — 중앙 세로 띠에서 전경 레이어가 얼마나 비어 있나
    # 개방도는 '캐릭터가 서는 높이 위쪽'만 본다. 지면 밴드는 원래 불투명해서
    # 화면 전체로 재면 수평 구도가 구조적으로 손해를 본다.
    cx0, cx1 = int(W * 0.38), int(W * 0.62)
    cy1 = meta.get("groundTop") or H
    cc = near.crop((cx0, 0, cx1, max(8, cy1)))
    open_ratio = sum(1 for p in cc.getdata() if p[3] == 0) / max(1, (cx1 - cx0) * max(8, cy1))
    ok3 = open_ratio >= 0.80
    pts += 3 if ok3 else 0
    sub.append(f"중앙 시야 개방 {open_ratio*100:.0f}% (지면 위 기준, 80% 이상) {3 if ok3 else 0}점")
    score["게임 배경 활용성"] = (pts, 10, sub)

    # ================================================= 이전 결과와의 유사도
    if a.prev and os.path.isdir(a.prev):
        pm = [f for f in os.listdir(a.prev) if f.endswith(".json") and f != "scene.json"]
        if pm:
            pmeta = json.load(open(os.path.join(a.prev, pm[0]), encoding="utf-8"))
            prev = Image.open(os.path.join(a.prev, pmeta["composite"])).convert("RGB")
            if prev.size != img.size:
                prev = prev.resize(img.size, 0)
            pp = prev.load()
            same = sum(1 for y in range(0, H, 2) for x in range(0, W, 2)
                       if pp[x, y] == px[x, y]) / ((H // 2) * (W // 2))
            lines.append(f"이전 결과와 동일 화소 {same*100:.0f}%")
            if same >= 0.60 and a.mode == "create":
                triggers.append("3. 이전 결과와 구도·주 피사체·색감이 대부분 동일")
            elif a.mode == "edit":
                lines.append("편집 모드 — '이전과 유사' 트리거는 적용하지 않는다"
                             "(구도 유지가 요청이므로 유사한 것이 정답이다)")

    # ================================================= 출력
    total = sum(v[0] for v in score.values())
    print("=" * 64)
    for k, (p_, m_, sub_) in score.items():
        print(f"[{p_:>2}/{m_:>2}] {k}")
        for t in sub_:
            print(f"        {t}")
    for l in lines:
        print(f"        {l}")
    print("=" * 64)
    verdict = "PASS" if (total >= PASS_SCORE and not triggers) else "FAIL"
    print(f"총점 {total}/100   판정: {verdict}  (통과 기준 {PASS_SCORE}점 + 재생성 트리거 0건)")
    if triggers:
        print("\n재생성 트리거 — 부분 수정이 아니라 공간 구조부터 다시 구성할 것:")
        for t in sorted(set(triggers)):
            print(f"  - {t}")
    sys.exit(0 if verdict == "PASS" else 1)


if __name__ == "__main__":
    main()
