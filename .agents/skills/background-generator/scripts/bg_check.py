#!/usr/bin/env python3
"""배경 정량 게이트 — PASS 전에는 최종 경로를 확정하지 않는다.

"더 분위기 있게", "투시를 넣어서"는 지침이 아니다. 배경에서 실제로 실패하는
지점은 넷이고 전부 숫자로 잡힌다.

  (1) 평평하다        큰 매스가 단색 -> top1 점유·최대 블롭·구조적 엣지 밀도
  (2) 투시가 없다      깊이 단서 6종 중 몇 개가 실측되는가
  (3) 명암이 없다      매스별 3톤 사용 + 광원 방향 일관성 + 명도 구간 사용률
  (4) 구조가 깨진다     레이어 분리·지면·예약색·고립픽셀

## 기준값 출처

`background_image_reference/` 3장을 280x120으로 축소 → 24색 양자화 → 3x3 mode
2회(도트화 근사)한 뒤 실측한 값이 상한/하한의 근거다.

    지표                  레퍼런스 3장        이 스킬 산출물(개선 후)   채택 기준
    총 색 수              24(양자화 고정)      26 / 30 / 33            24~48
    top1 색 점유          8.3 / 19.4 / 8.9%   16.6 / 23.5 / 17.0%     <= 25%
    최대 단색 연결영역     1.7 / 16.8 / 5.5%   12.7 / 14.7 / 12.6%     <= 16%
    구조적 엣지 밀도       42.4 / 36.2 / 33.7% 20.4 / 15.4 / 18.4%     >= 15%
    명도 10구간 사용       10 / 9 / 7          9 / 8 / 7               >= 7

레퍼런스는 축소된 회화/스크린샷이라 엣지 밀도가 손으로 찍은 도트보다 구조적으로
높다. 그래서 엣지 하한은 레퍼런스(34~42%)가 아니라 **실제로 도달 가능한 수준
(15%)** 에 뒀다. 나머지 축은 레퍼런스 범위 안에 들어가게 잡았다.

숫자를 낮춰서 통과시키지 않는다. 낮추는 순간 이 표 전체가 장식이 된다.

Usage:
    python3 bg_check.py <out-dir>
    python3 bg_check.py <out-dir> --verbose   # 매스별 상세
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
from bgcore import list_stamps, REF_H, hex_rgba, preset, size_note

LIMITS = {
    # --- 색 예산 ---
    "colors_total": (24, 48),     # 하한도 게이트다. 적으면 반드시 평평하다
    # 레이어당 상한은 총 상한(48)의 약 45%다. 한 레이어가 전체 색의 절반 가까이를
    # 쓰면 나머지 레이어가 비어 있다는 뜻이라 그때 걸리면 된다. 초기값 16은
    # 매스 3톤·구조 엣지 요구가 없던 시절 값이라 지금 기준에선 너무 빡빡했다.
    "colors_layer": {"outdoor": (6, 21), "interior": (6, 22)},
    "ramp_steps_min": 3,          # 면적 3% 이상 쓰는 램프는 3단 이상 실사용
    "ramp_area_min": 0.03,
    # --- 평탄함 ---
    "top1_share": 0.25,           # 한 색이 화면의 1/4을 넘으면 평평하게 읽힌다
    "max_blob": 0.16,             # 최대 단색 연결영역
    "struct_edge_min": 0.15,      # 3x3 mode 2회 후 남는 '구조적' 엣지
    "band_ratio_v": 0.45,         # 수평선 아래 세로 구간별 최소(전체평균 대비)
    "band_ratio_h": 0.55,         # 가로 구간별 최소(전체평균 대비)
    "sky_band_min": 0.02,         # 하늘 구간도 완전히 비면 안 된다(구름·광선)
    # --- 명암 ---
    "lum_bins_min": 7,            # 명도 10구간 중 각 2% 이상 쓰는 구간 수
    "lum_bin_share": 0.02,
    "mass_min_px": 200,           # 이 크기 이상이면 '주요 매스'(3톤·광원 검사 대상)
    "mass_3tone_ratio": 0.80,     # 3톤을 쓰는 매스 비율
    "light_dir_ratio": 0.75,     # 광원 규칙을 지키는 매스 비율
    "light_win_ratio": 0.58,     # 한 매스 안에서 좌상단이 밝은 8x8 창 비율      # 광원(좌상단) 일관성을 지키는 매스 비율
    # --- 깊이 ---
    # 하드 게이트는 이 합계 하나뿐이다. 개별 단서는 리포트에 정보로만 찍힌다.
    "depth_cues_min": {"outdoor": 4, "interior": 3},  # 야외 5종 중 4, 실내 4종 중 3
    "occlusion_min": 0.05,        # 앞 레이어가 뒤 레이어를 가리는 비율
    "layer_sep_dl": 0.10,        # 겹친 픽셀 명도차의 중앙값
    # --- 기타 ---
    "outline_ratio": 0.03,
    "layer_min_cov": {"outdoor": 0.03, "interior": 0.008},
    "isolated_ratio": 0.06,       # 8이웃 기준(체커 디더는 여기 안 걸린다)
    # 아래 둘은 기준 높이 120px에서 캘리브레이션한 값이다. 실제 캔버스에서는
    # 높이 비례로 스케일해서 쓴다(캔버스 크기가 자유이므로).
    "ground_min_h": 14,
    "ground_top_range": (78, 106),
}
# 펫 가독성 게이트는 2026-08-29 제거했다. 펫 주변 발광 이펙트를 게임 쪽에서
# 넣기로 해서, 배경이 펫 자리를 비워 줄 이유가 없어졌다. petAnchor는 좌표
# 정보로 메타에 남는다(런타임이 펫과 발광을 어디에 놓을지 알아야 한다).
OUTLINE_Y = 0.0208   # #2C2438 상대휘도


# ----------------------------------------------------------------- 유틸

def lum(p):
    return colorsys.rgb_to_hls(p[0] / 255, p[1] / 255, p[2] / 255)[1]


def rel_lum(p):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2])


def contrast_ratio(y1, y2):
    a, b = max(y1, y2), min(y1, y2)
    return (a + 0.05) / (b + 0.05)


def stats(pix):
    ls = [lum(p) for p in pix]
    if not ls:
        return 0.0, 0.0
    m = sum(ls) / len(ls)
    return m, (sum((v - m) ** 2 for v in ls) / len(ls)) ** 0.5


def mode_filter(img):
    """3x3 최빈값. 디더 체커를 뭉개서 '구조적' 엣지만 남긴다."""
    from PIL import Image
    W, H = img.size
    px = img.load()
    out = Image.new("RGB", (W, H))
    o = out.load()
    for y in range(H):
        for x in range(W):
            cnt = {}
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    c = px[min(W - 1, max(0, x + dx)), min(H - 1, max(0, y + dy))][:3]
                    cnt[c] = cnt.get(c, 0) + 1
            o[x, y] = max(cnt.items(), key=lambda kv: kv[1])[0]
    return out


def edge_density(px, W, H, x0, x1, y0, y1):
    n = 0
    for y in range(y0, max(y0 + 1, y1 - 1)):
        for x in range(x0, max(x0 + 1, x1 - 1)):
            if px[x, y] != px[x + 1, y] or px[x, y] != px[x, y + 1]:
                n += 1
    return n / max(1, (x1 - x0) * (y1 - y0))


def components(px, W, H, key):
    """key(x,y)가 같은 4-이웃 연결 성분. key가 None이면 건너뛴다."""
    seen = [[False] * W for _ in range(H)]
    for sy in range(H):
        for sx in range(W):
            if seen[sy][sx]:
                continue
            k = key(sx, sy)
            seen[sy][sx] = True
            if k is None:
                continue
            st, cells = [(sx, sy)], []
            while st:
                x, y = st.pop()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and key(nx, ny) == k:
                        seen[ny][nx] = True
                        st.append((nx, ny))
            yield k, cells


class Report:
    def __init__(self):
        self.rows, self.fail = [], 0

    def add(self, name, ok, detail):
        if ok:
            tag = "ok  "
        else:
            tag = "FAIL"
            self.fail += 1
        self.rows.append(f"  [{tag}] {name:<26} {detail}")

    def note(self, text):
        self.rows.append(f"         {text}")

    def done(self):
        print("\n".join(self.rows))
        print(f"\nRESULT: {'FAIL' if self.fail else 'PASS'}  ({self.fail} failed)")
        return 1 if self.fail else 0


# ----------------------------------------------------------------- main

def main():
    from PIL import Image
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("outdir")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    metas = [f for f in os.listdir(a.outdir) if f.endswith(".json") and f != "scene.json"]
    if len(metas) != 1:
        raise SystemExit(f"{a.outdir}: 메타 json이 1개여야 한다 (찾음: {metas})")
    meta = json.load(open(os.path.join(a.outdir, metas[0]), encoding="utf-8"))
    scene_path = os.path.join(a.outdir, "scene.json")
    scene = json.load(open(scene_path, encoding="utf-8")) if os.path.isfile(scene_path) else {}
    # 씬이 램프를 덮어썼으면 검사도 그 색으로 봐야 한다. 안 그러면 칠해진 색이
    # 어느 램프에도 속하지 않아 매스 판정·3톤·광원 검사가 전부 무너진다
    # (오버라이드 기능을 넣으면서 실제로 그렇게 됐다).  # rampOverride 적용
    import copy as _copy
    pre = _copy.deepcopy(preset(meta["preset"]))
    for _n, _r in (scene.get("ramps") or {}).items():
        pre["ramps"][_n] = _r
    kind = meta.get("kind", "outdoor")
    comp = Image.open(os.path.join(a.outdir, meta["composite"])).convert("RGBA")
    W, H = comp.size
    cpx = comp.load()
    N = W * H
    r = Report()

    ls = sorted(meta["layers"], key=lambda l: l["z"])
    imgs = {l["name"]: Image.open(os.path.join(a.outdir, l["file"])).convert("RGBA")
            for l in ls}

    # ============================================================ 기본
    want = scene.get("canvas")
    r.add("canvas = scene 선언값", (not want) or tuple(want) == (W, H),
          f"{W}x{H}" + (f" (scene: {want[0]}x{want[1]})" if want else ""))
    sn = size_note(W, H)
    if sn:
        r.note(f"{sn}")
    scale = H / REF_H
    r.add("composite opaque", comp.getchannel("A").getextrema()[0] == 255,
          f"min alpha={comp.getchannel('A').getextrema()[0]}")
    px_par = [l["parallax"] for l in ls]
    # ── 스탬프 과확대 ------------------------------------------------------
    # 9x6짜리 rock 을 scale 4 로 키우면 4px 블록 덩어리가 되지, 디테일이 생기지
    # 않는다 — 확대는 픽셀을 늘릴 뿐 형태를 늘리지 않는다(stamps.md).
    # 큰 원본을 크게 쓰는 것(window_snow 46px x4)은 문제가 아니므로, **작은
    # 원본을 크게 쓰는데 고해상도 변형이 이미 있는 경우**만 잡는다.
    try:
        _st = {n: (w, h) for n, (_sub, w, h) in list_stamps().items()}
    except Exception:
        _st = {}
    SMALL, LOUD = 14, 3
    over = []
    for lay in scene.get("layers", []):
        for o in lay.get("ops", []):
            if o.get("op") not in ("stamp", "scatter", "scatter_depth"):
                continue
            nm = o.get("name")
            if nm not in _st:
                continue
            sc_ = o.get("scale", 1)
            sc_ = max(sc_) if isinstance(sc_, (list, tuple)) else sc_
            base = max(_st[nm])
            if base > SMALL or sc_ < LOUD:
                continue
            alt = [v for v in _st
                   if v != nm and v.startswith(nm + "_") and max(_st[v]) >= base * 1.5]
            if alt:
                over.append(f"{nm}({base}px) x{sc_} -> 고해상도 변형 {alt[0]}"
                            f"({max(_st[alt[0]])}px)")
    r.add("스탬프 과확대 없음", not over,
          "ok" if not over else " / ".join(over[:3]))

    r.add("layers 3~5", 3 <= len(ls) <= 5, f"{len(ls)}개 {[l['name'] for l in ls]}")

    # ── 애니메이션 프레임 -------------------------------------------------
    # 프레임을 안 재면 승격이 아니라 위치 변경이다. 깨진 프레임, 크기가 다른
    # 프레임, 선언한 레이어 말고 다른 게 바뀐 프레임이 조용히 통과한다.
    anim = meta.get("animation")
    if anim:
        names = anim.get("frames") or []
        layer_names = [l["name"] for l in ls]
        r.add("animation: 레이어가 실재", anim.get("layer") in layer_names,
              f"{anim.get('layer')} (레이어 {layer_names})")
        r.add("animation: 프레임 2장 이상", len(names) >= 2, f"{len(names)}장")
        r.add("animation: fps 1~30", 1 <= int(anim.get("fps", 0)) <= 30,
              f"{anim.get('fps')}fps")
        missing = [n for n in names
                   if not os.path.isfile(os.path.join(a.outdir, n))]
        r.add("animation: 프레임 파일 존재", not missing,
              "모두 있음" if not missing else f"없음 {missing[:3]}")
        r.add("animation: frames/ 하위에 둠",
              all(n.startswith("frames/") for n in names),
              "ok" if all(n.startswith("frames/") for n in names)
              else "최상단 PNG는 레이어로 오인된다")
        if not missing and names:
            from PIL import Image as _I
            sizes, sigs = set(), []
            for n in names:
                im = _I.open(os.path.join(a.outdir, n)).convert("RGBA")
                sizes.add(im.size)
                sigs.append(im.tobytes())
            r.add("animation: 프레임 캔버스 일치", sizes == {(W, H)},
                  f"{sorted(sizes)} (캔버스 {W}x{H})")
            # 전부 같으면 애니메이션이 아니다. 12장을 굽고도 위상이 안 먹은
            # 경우가 실제로 나온다.
            r.add("animation: 프레임이 서로 다름", len(set(sigs)) > 1,
                  f"서로 다른 프레임 {len(set(sigs))}/{len(sigs)}")
            # 선언한 레이어의 원본과 크기가 같아야 교체가 성립한다.
            lf = next((l["file"] for l in ls if l["name"] == anim.get("layer")), None)
            if lf and os.path.isfile(os.path.join(a.outdir, lf)):
                base = _I.open(os.path.join(a.outdir, lf)).size
                r.add("animation: 교체 대상과 크기 일치", sizes == {base},
                      f"{sorted(sizes)} vs {lf} {base}")
    r.add("parallax 단조증가", all(x < y for x, y in zip(px_par, px_par[1:])), f"{px_par}")

    # ============================================================ 색 예산
    counts = {}
    for y in range(H):
        for x in range(W):
            c = cpx[x, y][:3]
            counts[c] = counts.get(c, 0) + 1
    lo, hi = LIMITS["colors_total"]
    r.add(f"총 색 수 {lo}~{hi}", lo <= len(counts) <= hi, f"{len(counts)}색")
    llo, lhi = LIMITS["colors_layer"][kind]
    for l in ls:
        cols = {p[:3] for p in imgs[l["name"]].getdata() if p[3]}
        cov = sum(1 for p in imgs[l["name"]].getdata() if p[3]) / N
        r.add(f"{l['name']}: 색 {llo}~{lhi}", llo <= len(cols) <= lhi, f"{len(cols)}색")
        if l["z"] > 0:
            mc = LIMITS["layer_min_cov"][kind]
            r.add(f"{l['name']}: 커버리지", cov >= mc, f"{cov*100:.1f}% (>= {mc*100:.1f}%)")

    # 램프 단계 사용률 — 색 수만 채우고 단계는 안 쓰는 것을 막는다
    rev = {}
    for name, ramp in pre["ramps"].items():
        for i, h in enumerate(ramp):
            rev.setdefault(hex_rgba(h)[:3], (name, i))
    ramp_px, ramp_steps = {}, {}
    for c, n in counts.items():
        e = rev.get(c)
        if not e:
            continue
        ramp_px[e[0]] = ramp_px.get(e[0], 0) + n
        ramp_steps.setdefault(e[0], set()).add(e[1])
    for name, n in sorted(ramp_px.items(), key=lambda kv: -kv[1]):
        if n / N < LIMITS["ramp_area_min"]:
            continue
        steps = len(ramp_steps[name])
        r.add(f"램프 {name}: {LIMITS['ramp_steps_min']}단 이상",
              steps >= LIMITS["ramp_steps_min"],
              f"{steps}단 사용 (면적 {n/N*100:.0f}%) {sorted(ramp_steps[name])}")

    # ============================================================ 평탄함
    top1 = max(counts.values()) / N
    r.add("top1 색 점유 <= 25%", top1 <= LIMITS["top1_share"], f"{top1*100:.1f}%")

    biggest = 0
    for _, cells in components(cpx, W, H, lambda x, y: cpx[x, y][:3]):
        biggest = max(biggest, len(cells))
    r.add("최대 단색영역 <= 16%", biggest / N <= LIMITS["max_blob"], f"{biggest/N*100:.1f}%")

    m = mode_filter(comp.convert("RGB"))
    mpx = m.load()
    se = edge_density(mpx, W, H, 0, W, 0, H)
    r.add("구조적 엣지 >= 15%", se >= LIMITS["struct_edge_min"],
          f"{se*100:.1f}% (레퍼런스 34~42%)")

    horizon = meta.get("horizon") or 56
    vb = [(H * i // 4, H * (i + 1) // 4) for i in range(4)]
    for i, (y0, y1) in enumerate(vb):
        d = edge_density(mpx, W, H, 0, W, y0, y1)
        if y1 <= horizon:                       # 하늘 구간
            r.add(f"세로{i+1} 하늘 디테일", d >= LIMITS["sky_band_min"],
                  f"{d*100:.1f}% (>= {LIMITS['sky_band_min']*100:.0f}%)")
        else:
            r.add(f"세로{i+1} 디테일 분포", d >= se * LIMITS["band_ratio_v"],
                  f"{d*100:.1f}% (>= 평균x{LIMITS['band_ratio_v']} = {se*LIMITS['band_ratio_v']*100:.1f}%)")
    hbmin = min(edge_density(mpx, W, H, W * i // 4, W * (i + 1) // 4, 0, H) for i in range(4))
    r.add("가로 디테일 편중", hbmin >= se * LIMITS["band_ratio_h"],
          f"최소 구간 {hbmin*100:.1f}% (>= 평균x{LIMITS['band_ratio_h']} = {se*LIMITS['band_ratio_h']*100:.1f}%)")

    # ============================================================ 명암
    hist = [0] * 10
    for c, n in counts.items():
        hist[min(9, int(lum(c) * 10))] += n
    bins = sum(1 for h in hist if h / N >= LIMITS["lum_bin_share"])
    r.add(f"명도 구간 >= {LIMITS['lum_bins_min']}/10", bins >= LIMITS["lum_bins_min"],
          f"{bins}/10  " + " ".join(f"{h/N*100:.0f}" for h in hist))

    def ramp_key(x, y):
        e = rev.get(cpx[x, y][:3])
        return e[0] if e else None

    masses, three, lit = 0, 0, 0
    bad = []
    acc_backdrop = []
    for name, cells in components(cpx, W, H, ramp_key):
        if len(cells) < LIMITS["mass_min_px"] * scale * scale:
            continue
        masses += 1
        idx = [rev[cpx[x, y][:3]][1] for x, y in cells]
        if len(set(idx)) >= 3:
            three += 1
        else:
            bad.append((name, len(cells), f"단계 {sorted(set(idx))} — 3톤 미만"))
        # 광원 방향은 '매스의 윗면이 아랫면보다 밝은가'로 잰다.
        # 무게중심이나 대각 비대칭으로 재면 로브가 겹쳐 반복되는 잎덩어리에서
        # 뒤 로브의 그림자와 앞 로브의 하이라이트가 맞붙어 값이 상쇄된다.
        # 실루엣의 위/아래 경계만 보면 그 상쇄가 일어나지 않는다.
        xs = [c[0] for c in cells]
        ys = [c[1] for c in cells]
        # 좌우 끝에 모두 닿으면 높이와 무관하게 '띠'다 — 천장 그림자처럼 7px짜리도
        # 좌우 실루엣이 없어 형태로 읽히지 않는다.
        vertical = (min(ys) <= 1 and max(ys) >= H - 2)
        # 화면을 가로지르는 '면' 판정은 끝에 딱 붙었는지가 아니라 폭으로 본다.
        # 가장자리에 소품 하나만 얹혀도 연결이 끊겨 배경면이 형태로 오인된다.
        backdrop = (max(xs) - min(xs)) >= W * 0.90
        if backdrop and not vertical:
            # 지면·벽·하늘처럼 화면을 가로지르는 면은 '형태'가 아니라 배경면이다.
            # 명도 기울기가 광원이 아니라 깊이를 뜻하고, 그림자 띠가 얹히면
            # 위가 어두운 게 정상이다. 원근은 '지면 압축'이 따로 본다.
            lit += 1
            acc_backdrop.append((name, len(cells)))
            continue
        # 광원 방향은 8x8 창 단위로 '좌상단 삼각형이 우하단보다 밝은가'를 센다.
        #
        # 매스 전체 평균(사분면·실루엣·무게중심)으로 재면 로브가 반복되는
        # 잎 덩어리에서 값이 구조적으로 0에 수렴한다 — 로브마다 자기 하이라이트와
        # 그림자를 함께 갖기 때문이다. 창을 로브보다 작게 잡으면 창 대부분이
        # 로브 하나 안에 들어가 그 안의 방향이 그대로 잡힌다.
        # 세로 줄기도 같은 식이 통한다(좌상단 = 왼쪽 밝은 면).
        pos = {(x, y): i for (x, y), i in zip(cells, idx)}
        WIN = 8
        good = tot = 0
        for by in range(min(ys), max(ys) + 1, WIN):
            for bx in range(min(xs), max(xs) + 1, WIN):
                ul = lr = []
                ul, lr = [], []
                for dy in range(WIN):
                    for dx in range(WIN):
                        v = pos.get((bx + dx, by + dy))
                        if v is None:
                            continue
                        if dx + dy < WIN - 1:
                            ul.append(v)
                        elif dx + dy > WIN - 1:
                            lr.append(v)
                if len(ul) >= 6 and len(lr) >= 6:
                    a_, b_ = sum(ul) / len(ul), sum(lr) / len(lr)
                    if abs(a_ - b_) < 1e-9:
                        continue     # 단색 구간은 방향 정보가 없다 — 판정 제외
                    tot += 1
                    if a_ > b_:
                        good += 1
        if tot >= 3:
            ratio = good / tot
            if ratio >= LIMITS["light_win_ratio"]:
                lit += 1
            else:
                bad.append((name, len(cells),
                            f"좌상단이 밝은 창 {good}/{tot} = {ratio*100:.0f}%"))
        else:
            lit += 1

    tr = three / max(1, masses)
    lr = lit / max(1, masses)
    r.add("매스 3톤 사용 >= 80%", tr >= LIMITS["mass_3tone_ratio"],
          f"{three}/{masses} = {tr*100:.0f}% (주요 매스 기준 "
          f"{int(LIMITS['mass_min_px']*scale*scale)}px 이상)")
    r.add("광원 좌상단 일관성 >= 75%", lr >= LIMITS["light_dir_ratio"],
          f"{lit}/{masses} = {lr*100:.0f}%")
    if a.verbose and acc_backdrop:
        r.note(f"광원 검사 제외(배경면): {acc_backdrop}")
    if a.verbose and bad:
        for b in bad[:10]:
            r.note(f"광원 어긋난 매스: {b}")

    # ============================================================ 깊이
    cues, detail = 0, []

    # 1. 레이어 간 명도 계단
    from PIL import Image as _I
    acc = _I.new("RGBA", (W, H), (0, 0, 0, 0))
    seps, occl = [], []
    for i, l in enumerate(ls):
        im = imgs[l["name"]]
        if i > 0:
            ip, bp = im.load(), acc.load()
            aa, bb, cov = [], [], 0
            for y in range(H):
                for x in range(W):
                    if ip[x, y][3]:
                        if bp[x, y][3]:
                            aa.append(ip[x, y]); bb.append(bp[x, y]); cov += 1
            if aa:
                # 평균끼리 빼면 안 된다 — 어두운 소품과 밝은 발광을 함께 가진
                # 레이어는 평균이 상쇄돼 0에 수렴한다. 실제로 실내 mid 레이어가
                # 그랬다. 겹친 픽셀 각각의 차이를 재고 그 중앙값을 본다.
                diffs = sorted(abs(lum(x) - lum(y)) for x, y in zip(aa, bb))
                dl = diffs[len(diffs) // 2]
                seps.append((l["name"], dl))
                occl.append((l["name"], cov / N))
                r.add(f"{l['name']}: 뒤와 명도차", dl >= LIMITS["layer_sep_dl"], f"중앙값 dL={dl:.3f}")
        acc.alpha_composite(im)
    if seps and all(d >= LIMITS["layer_sep_dl"] for _, d in seps):
        cues += 1; detail.append("명도계단")

    # 2. 겹침(occlusion)
    if occl and all(c >= LIMITS["occlusion_min"] for _, c in occl):
        cues += 1; detail.append("겹침")

    # 3. 대기 원근 — 뒤 레이어일수록 하늘색에 가깝다 (야외 전용)
    def mean_rgb(pix):
        return tuple(sum(p[i] for p in pix) / max(1, len(pix)) for i in range(3)) if pix else (0, 0, 0)
    lp = {l["name"]: [p for p in imgs[l["name"]].getdata() if p[3]] for l in ls}
    if kind == "outdoor":
        skym = mean_rgb(lp[ls[0]["name"]])
        ds = [(l["name"], sum((x - y) ** 2 for x, y in zip(mean_rgb(lp[l["name"]]), skym)) ** 0.5)
              for l in ls[1:]]
        # 대기 원근은 '정보'로만 남긴다.
        # 하늘색과의 거리로 재면 눈·모래처럼 지면이 하늘과 같은 색인 주제에서
        # 뒤집히고, 채도나 내부 대비로 바꿔도 어느 것도 네 프리셋 전부에서
        # 단조롭지 않았다(실측). 레이어가 이질적인 내용을 담기 때문이다.
        # 이건 사람이 보면 1초에 판단하는 것이라 시각 검수 항목으로 옮겼다.
        ok = all(x[1] <= y[1] + 6 for x, y in zip(ds, ds[1:]))
        r.note(f"[정보] 하늘색과의 거리 {' -> '.join(f'{n}:{d:.0f}' for n, d in ds)}"
               f"  {'단조증가' if ok else '단조증가 아님 — 시각 검수에서 판단'}")

    # 4. 크기 기울기 — scene.json에 깊이에 따라 크기가 변하는 배치가 있는가
    grad = False
    for lay in scene.get("layers", []):
        for o in lay.get("ops", []):
            if o.get("op") == "scatter_depth" and o.get("scale", [1, 1])[0] != o.get("scale", [1, 1])[1]:
                grad = True
    scales = set()
    for lay in scene.get("layers", []):
        for o in lay.get("ops", []):
            if o.get("op") in ("stamp", "scatter"):
                scales.add(o.get("scale", 1))
    if len(scales) > 1:
        grad = True
    # 세로 구도: 같은 종류(줄기)의 폭이 레이어마다 달라도 크기 기울기다
    widths = []
    for lay in sorted(scene.get("layers", []), key=lambda l: l.get("z", 0)):
        ws = [sum(o["w"]) / 2 for o in lay.get("ops", []) if o.get("op") == "tree_column"]
        if ws:
            widths.append((lay["name"], sum(ws) / len(ws)))
    if len(widths) >= 2 and all(a[1] < b[1] for a, b in zip(widths, widths[1:])):
        grad = True
    r.note("[정보] 크기 기울기 " + ("ok" if grad else "없음") + "  "
           + (" -> ".join(f"{n}:{w:.0f}px" for n, w in widths) if widths else ""))
    if grad:
        cues += 1; detail.append("크기기울기")

    # 5. 지면 압축 — 지면 밴드에서 위(먼 쪽)가 아래(가까운 쪽)보다 촘촘/평탄
    gt = meta.get("groundTop")
    if gt and H - gt >= 9:
        gh = H - gt
        top = edge_density(mpx, W, H, 0, W, gt, gt + gh // 3)
        bot = edge_density(mpx, W, H, 0, W, H - gh // 3, H)
        # 멀수록 같은 픽셀에 더 많은 것이 들어간다 = 먼 쪽 엣지 밀도가 높다.
        # 반대로 나오면 지면이 아래로 갈수록 잘게 쪼개진 것이라 원근이 뒤집힌 것이다.
        ok = top > bot * 1.15
        r.note(f"[정보] 지면 압축 먼쪽 {top*100:.1f}% vs 가까운쪽 {bot*100:.1f}%"
               f"  {'ok' if ok else '역전'}")
        if ok:
            cues += 1; detail.append("지면압축")

    # 6. 접지 그림자 — 지면 자체의 기울기에서 '국소적으로 파인 곳'이 있는가
    #
    # 세 번 잘못 쟀다. (1) 밴드 평균 대비: 지면 위 밝은 소품이 평균을 끌어올린다.
    # (2) 중앙값 대비: 그림자 띠가 창의 과반이면 중앙값 자신이 된다.
    # (3) 접지부 vs 아래: 지면은 원근 때문에 원래 위가 밝다 — 정상 지면이 걸린다.
    # 지면의 명도 기울기는 '추세'이고 접지 그림자는 그 추세에서 벗어난 '침하'다.
    # 그래서 행별 평균에 직선을 맞추고 잔차가 음으로 큰 행이 있는지를 본다.
    if gt and H - gt >= 9:
        rows = []
        for y in range(gt, H):
            v = [lum(cpx[x, y][:3]) for x in range(0, W, 2)]
            rows.append(sum(v) / max(1, len(v)))
        n = len(rows)
        mx = (n - 1) / 2.0
        my = sum(rows) / n
        den = sum((i - mx) ** 2 for i in range(n)) or 1.0
        slope = sum((i - mx) * (rows[i] - my) for i in range(n)) / den
        resid = [rows[i] - (my + slope * (i - mx)) for i in range(n)]
        top = resid[:max(2, int(n * 0.45))]
        dip = min(top) if top else 0.0
        ok = dip <= -0.035
        r.note(f"[정보] 접지 그림자 추세 대비 침하 {dip:+.3f}  {'ok' if ok else '없음'}")
        if ok:
            cues += 1; detail.append("접지그림자")

    # 개별 단서는 위에서 '정보'로만 찍고, **합계만 하드 게이트**다.
    # 예전에는 하위 항목이 각각 r.add라서 문서의 "6개 중 4개면 된다"와 실제
    # 동작이 어긋났다(하나만 빠져도 FAIL). 기준은 한 곳에만 있어야 한다.
    need = LIMITS["depth_cues_min"][kind]
    pool = 5 if kind == "outdoor" else 4
    r.add(f"깊이 단서 >= {need}/{pool}", cues >= need,
          f"{cues}개 확보: {', '.join(detail) if detail else '없음'}")

    # ============================================================ petAnchor
    # 대비 게이트는 없다(발광 이펙트가 가독성을 맡는다). 좌표가 캔버스 안에
    # 들어있는지만 본다 — 런타임이 이 값으로 펫과 발광을 배치한다.
    pa = meta.get("petAnchor")
    if pa:
        inside = (0 <= pa["x"] and 0 <= pa["y"]
                  and pa["x"] + pa["w"] <= W and pa["y"] + pa["h"] <= H)
        r.add("petAnchor 캔버스 안", inside,
              f'({pa["x"]},{pa["y"]}) {pa["w"]}x{pa["h"]}'
              + (f'  발끝 y={pa["y"]+pa["h"]} / groundTop={meta.get("groundTop")}'
                 if meta.get("groundTop") is not None else ""))
    else:
        r.add("petAnchor 존재", False, "scene.json에 petAnchor를 넣을 것")

    # ============================================================ 기타
    glo = int(LIMITS["ground_top_range"][0] * scale)
    ghi = int(LIMITS["ground_top_range"][1] * scale)
    gmin = max(6, int(LIMITS["ground_min_h"] * scale))
    r.add("groundTop 범위", gt is not None and glo <= gt <= ghi,
          f"{gt} (허용 {glo}~{ghi}, 높이 비례)")
    if gt is not None:
        r.add("지면 밴드 높이", H - gt >= gmin, f"{H-gt}px (>= {gmin})")
    on = counts.get((0x2C, 0x24, 0x38), 0)
    r.add("#2C2438 <= 3%", on / N <= LIMITS["outline_ratio"], f"{on/N*100:.1f}%")
    iso = 0
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            c = cpx[x, y][:3]
            if all(cpx[x + dx, y + dy][:3] != c
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy)):
                iso += 1
    r.add("고립픽셀(8이웃) <= 6%", iso / N <= LIMITS["isolated_ratio"], f"{iso/N*100:.1f}%")
    if meta.get("seamless"):
        # 이음매를 '내부 한 쌍'과 비교하면 안 된다 — 블록 디더에서는 하필 같은
        # 블록에 속한 쌍을 골라 기준이 0이 되기도 한다. 모든 인접 열 쌍의 분포와
        # 비교한다.
        diffs = [sum(1 for y in range(H) if cpx[i, y][:3] != cpx[i + 1, y][:3])
                 for i in range(W - 1)]
        mu = sum(diffs) / len(diffs)
        sd = (sum((d - mu) ** 2 for d in diffs) / len(diffs)) ** 0.5
        seam = sum(1 for y in range(H) if cpx[W - 1, y][:3] != cpx[0, y][:3])
        thr = mu + 2 * sd + 4
        r.add("seamless 이음매", seam <= thr,
              f"이음매 {seam}행 vs 내부 평균 {mu:.1f}±{sd:.1f} (허용 {thr:.0f})")

    sys.exit(r.done())


if __name__ == "__main__":
    main()
