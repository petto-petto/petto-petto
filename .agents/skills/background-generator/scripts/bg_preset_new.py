#!/usr/bin/env python3
"""분위기 키워드만으로 새 프리셋(8램프 x 5단)을 만든다.

레퍼런스 이미지가 있으면 `bg_palette.py from-image`가 낫다. 이 스크립트는
**이미지 없이 말로만 요청이 온 경우**를 위한 것이다 — "눈 덮인 침엽수림",
"용암 흐르는 화산", "달빛 늪지"처럼. 그런 요청에 기존 프리셋을 억지로
재활용하면 색이 주제와 안 맞고, 손으로 40개 hex를 지어내면 램프 간 중복과
명도 역전이 반드시 생긴다(실제로 겪었다).

하는 일:
  1. 키워드 -> 지형/시간대/온도 판정 -> 앵커 색 4개(하늘/원경/중경/전경)
  2. 앵커에서 8램프 x 5단 파생 (명도 곱연산, 뒤로 갈수록 채도 감소)
  3. 램프 간 hex 중복 제거 — 겹치면 색상을 미세하게 벌린다
  4. **채점 예측** — 이 팔레트로 색상 15점을 받을 수 있는지 미리 계산

Usage:
    python3 bg_preset_new.py --name snowy_pines --mood "눈,침엽수림,겨울,차가운" \
        --label "눈 덮인 침엽수림" [--layout ground] [--write]
    python3 bg_preset_new.py --name x --mood "..." --anchors '#8FB6D6,#6E8CA8,#3E5A70,#1E2C3A'
"""
import argparse
import colorsys
import json
import os
import re
import sys

import bg_pillow_gate  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgcore import PRESET_PATH, hex_rgba, to_hex

# 지형 -> (하늘, 원경, 중경, 전경) 앵커. 낮/따뜻 기준이고 시간대·온도가 뒤에서 민다.
TERRAIN = {
    "snow":   ("#CFE4F2", "#9FBDD4", "#6E8CA8", "#33475C"),
    "desert": ("#F4DCA8", "#D9B87A", "#B98A4E", "#6E4A2A"),
    "cave":   ("#4A4258", "#3A3448", "#2A2638", "#151220"),
    "swamp":  ("#9FB894", "#6E8A63", "#47603E", "#1F2E1C"),
    "volcano":("#F2B07A", "#C4663C", "#8A3A22", "#3A160E"),
    "ocean":  ("#AEE4F0", "#6FC2D8", "#2F8CA8", "#12405A"),
    "ruins":  ("#E6DCC0", "#BFB08C", "#8E8062", "#4A4234"),
    "forest": ("#D2F0D8", "#86BC9E", "#658F2C", "#1F4423"),
    "sky":    ("#A8EBFC", "#7EDBA8", "#4E8A2C", "#223A12"),
    "room":   ("#BE5A44", "#8C4429", "#A74F30", "#2E1418"),
}
TERRAIN_WORDS = {
    "snow": ["눈", "설원", "겨울", "빙하", "얼음", "snow", "winter", "ice"],
    "desert": ["사막", "모래", "오아시스", "desert", "sand", "dune"],
    "cave": ["동굴", "지하", "광산", "터널", "cave", "cavern", "mine", "underground"],
    "swamp": ["늪", "습지", "정글", "밀림", "이끼", "swamp", "marsh", "bog", "jungle"],
    "volcano": ["화산", "용암", "마그마", "불", "volcano", "lava", "magma"],
    "ocean": ["바다", "해변", "수중", "산호", "호수", "ocean", "sea", "beach", "reef"],
    "ruins": ["유적", "폐허", "신전", "석조", "사원", "ruins", "temple", "stone"],
    "forest": ["숲", "나무", "수목", "forest", "wood", "tree"],
    "sky": ["하늘", "구름", "초원", "언덕", "sky", "cloud", "meadow", "plain"],
    "room": ["실내", "방", "집", "카페", "여관", "room", "indoor", "house", "inn"],
}
TIME_WORDS = {
    "night": (["밤", "야간", "달빛", "별", "night", "moon", "midnight"], -0.42, 0.72),
    "dusk":  (["노을", "석양", "황혼", "일몰", "dusk", "sunset", "twilight"], -0.16, 1.10),
    "dawn":  (["새벽", "여명", "일출", "dawn", "sunrise"], -0.06, 0.95),
    "day":   (["낮", "한낮", "맑은", "day", "noon", "bright"], 0.05, 1.00),
}
TEMP_WORDS = {
    "cold": (["차가운", "서늘한", "추운", "시린", "cold", "cool", "chilly"], -14),
    "warm": (["따뜻한", "포근한", "더운", "뜨거운", "warm", "hot", "cozy"], 14),
}
# 채도가 낮은 게 정상인 주제 — 색상 채점의 '뮤트 금지'를 그대로 적용하면 오탐이다
MUTED_OK = {"snow", "cave", "ruins"}


def pick(text, table):
    hits = {}
    for key, words in table.items():
        n = sum(1 for w in words if w.lower() in text.lower())
        if n:
            hits[key] = n
    return max(hits, key=hits.get) if hits else None


def hls(h):
    r, g, b = (c / 255 for c in hex_rgba(h)[:3])
    a, l, s = colorsys.rgb_to_hls(r, g, b)
    return a * 360, l, s


def mk(hdeg, l, s):
    r, g, b = colorsys.hls_to_rgb((hdeg % 360) / 360,
                                  max(0.02, min(0.98, l)), max(0.0, min(1.0, s)))
    return to_hex((r * 255, g * 255, b * 255))


def ramp(anchor, steps=5, shadow=0.78, light=1.16, desat_up=0.06, hue_shift=0.0):
    """앵커를 가운데(2단)에 두고 위아래로 5단.

    어두운 쪽으로는 색상을 살짝 차갑게, 밝은 쪽으로는 채도를 낮춘다 — 그림자를
    검정으로 죽이지 않고, 하이라이트가 형광으로 튀지 않게 하는 관용적인 처리다.
    """
    h, l, s = hls(anchor)
    out = []
    for i in range(steps):
        d = i - steps // 2
        ll = l * (light ** d if d > 0 else shadow ** (-d))
        ss = s * (1 - desat_up * max(0, d)) * (1 + 0.05 * max(0, -d))
        hh = h + hue_shift + (-6 if d < 0 else 3) * abs(d) * 0.5
        out.append(mk(hh, ll, ss))
    return out


def dedupe(ramps):
    """램프 간 hex 중복 금지 — 색->램프 역맵에 의존하는 연산이 전부 깨진다."""
    seen = {}
    for name, r in ramps.items():
        for i, h in enumerate(r):
            tries = 0
            while h in seen and tries < 24:
                hh, l, s = hls(h)
                h = mk(hh + 3 + tries, l + 0.006 * (1 if tries % 2 else -1), s)
                tries += 1
            seen[h] = f"{name}.{i}"
            r[i] = h
    return ramps


def derive(src_ramps, burn):
    """기존 프리셋을 태워 새 램프를 만든다.

    단일 곡선으로는 안 된다. 두 게이트가 반대로 당기기 때문이다 —
    **레이어 분리**(각 레이어가 뒤와 명도차 0.10 이상)는 어두운 쪽 간격을 벌리라
    하고, **명도 10구간**(각 2% 이상)은 바닥을 채우라 한다. 감마 하나를 올리면
    앞이 깨지고 내리면 뒤가 깨진다(둘 다 실측으로 겪었다).

    그래서 램프마다 **명도 밴드**를 잡고 사다리를 강제한다.

      1. 램프의 원본 명도 범위를 태워 새 밴드로 옮긴다
      2. 깊이 램프(sky>far>mid>near)의 간격을 원본의 85% 이상으로 되돌린다
      3. `wood`(지면·기둥)는 `mid` 아래로 내린다 — 전경 레이어의 실체다
      4. 가장 어두운 램프의 바닥을 0.06 이하로 눌러 최하 구간을 채운다
      5. 색은 **RGB를 곱해** 목표 명도로 옮긴다. HLS의 L만 내리면 옅은 색이
         채도를 그대로 유지해 쨍해진다 — 첫 번째 함정이다
      6. 무채색 원본은 색이 실제로 있는 가장 가까운 단에서 색상을 물려받는다.
         L이 1.0이면 재구성이 흰색이라 천장 아래로 먼저 내린다 — 두 번째 함정

    burn 0 이면 원본 그대로, 1 이면 가장 많이 탄다.
    """
    names = list(src_ramps)

    def band(ramp):
        ls = [hls(c)[1] for c in ramp]
        return min(ls), max(ls)

    src_band = {n: band(src_ramps[n]) for n in names}
    src_mean = {n: sum(hls(c)[1] for c in src_ramps[n]) / len(src_ramps[n]) for n in names}

    # 1) 밴드를 태운다. light 는 표면색이 아니라 광원이라 덜 태운다 —
    #    여기까지 누르면 화면에서 하이라이트가 사라져 동적 범위가 무너진다.
    tgt = {}
    for n in names:
        w = 0.25 if n == "light" else 1.0
        ceiling = 1.0 - 0.34 * burn * w
        lo, hi = src_band[n]
        tgt[n] = (max(0.02, ceiling * lo), max(0.04, ceiling * hi))

    # 2) 깊이 사다리 복원. 태우면 간격이 줄어드는데, 줄어든 만큼 레이어 분리가 깨진다.
    depth = [n for n in ("sky", "far", "mid", "near") if n in tgt]
    for a, b in zip(depth, depth[1:]):
        want = (src_mean[a] - src_mean[b]) * 0.85
        mid_a = sum(tgt[a]) / 2
        mid_b = sum(tgt[b]) / 2
        short = want - (mid_a - mid_b)
        if short > 0:
            lo, hi = tgt[b]
            tgt[b] = (max(0.02, lo - short), max(0.04, hi - short))

    # 3) wood 는 지면과 기둥이다 — 전경 레이어의 실체이므로 mid 아래에 둔다.
    if "wood" in tgt and "mid" in tgt:
        want_mid = sum(tgt["mid"]) / 2 - 0.06 * (0.5 + burn)
        cur = sum(tgt["wood"]) / 2
        if cur > want_mid:
            d = cur - want_mid
            lo, hi = tgt["wood"]
            tgt["wood"] = (max(0.02, lo - d), max(0.04, hi - d))

    # 4) 최하 구간을 채운다. 바닥이 비면 '명도 10구간' 이 깨진다.
    darkest = min(tgt, key=lambda n: tgt[n][0])
    if tgt[darkest][0] > 0.06:
        lo, hi = tgt[darkest]
        d = lo - 0.05
        tgt[darkest] = (lo - d, max(0.06, hi - d))

    out = {}
    for n in names:
        ramp = src_ramps[n]
        hues = [hls(c)[0] for c in ramp]
        sats = [hls(c)[2] for c in ramp]
        lo, hi = src_band[n]
        lo2, hi2 = tgt[n]
        new = []
        for i, hx in enumerate(ramp):
            h, l, sa = hls(hx)
            if sa < 0.06:                      # 6) 무채색 상속
                order = sorted(range(len(ramp)), key=lambda k: (abs(k - i), k))
                j = next((k for k in order if sats[k] >= 0.15), None)
                if j is None:
                    j = max(range(len(ramp)), key=lambda k: sats[k])
                h, sa = hues[j], max(sats[j], 0.18)
                l = min(l, 0.94)
            src_hue = h
            t = (l - lo) / (hi - lo) if hi > lo else 0.0
            target = lo2 + (hi2 - lo2) * t
            r, g, bb = colorsys.hls_to_rgb(h / 360.0, l, sa)
            f = max(0.04, min(1.0, target / max(l, 1e-4)))     # 5) RGB 곱
            nh, nl, ns = colorsys.rgb_to_hls(r * f, g * f, bb * f)
            # RGB를 곱하면 쨍해지지는 않지만 HLS 채도가 같이 떨어져 큰 면이
            # 탁하게 읽힌다. 잃은 만큼의 일부만 되돌린다 — 전부 되돌리면 함정 1.
            hue_out = nh * 360.0 if ns > 0.05 else src_hue
            new.append(mk(hue_out, nl, min(0.95, ns + (sa - ns) * 0.40)))
        for i in range(1, len(new)):
            pl = hls(new[i - 1])[1]
            ch, cl, cs = hls(new[i])
            if cl <= pl:
                new[i] = mk(ch, min(1.0, pl + 0.02), cs)
        out[n] = new
    return out


def build(mood, anchors=None, terrain=None):
    t = terrain or pick(mood, TERRAIN_WORDS) or "forest"
    a_sky, a_far, a_mid, a_near = anchors or TERRAIN[t]
    dl, ds = 0.0, 1.0
    tm = None
    for key, (words, d, sm) in TIME_WORDS.items():
        if any(w.lower() in mood.lower() for w in words):
            tm, dl, ds = key, d, sm
            break
    hue_push = 0
    for key, (words, push) in TEMP_WORDS.items():
        if any(w.lower() in mood.lower() for w in words):
            hue_push = push
            break

    def shift(hexv, extra_l=0.0):
        h, l, s = hls(hexv)
        return mk(h + hue_push, max(0.03, l * (1 + dl) + extra_l), s * ds)

    a_sky, a_far, a_mid, a_near = (shift(a_sky), shift(a_far), shift(a_mid), shift(a_near))

    # 앵커의 명도를 사다리로 강제한다.
    #
    # 지형별 앵커의 원래 명도는 제각각이라, 그대로 두면 램프 5단을 뽑아도
    # 레이어 분리(이웃과 0.10 이상)와 대기 원근(하늘과의 거리 증가)을 동시에
    # 만족하는 조합이 아예 없는 팔레트가 나온다. 실제로 사막·동굴·화산 셋 다
    # 그렇게 실패했다. 색상(hue)과 채도는 주제가 정하고, **명도는 구조가 정한다.**
    LADDER = (0.84, 0.63, 0.44, 0.20)

    def force_l(hexv, target):
        h, l, s = hls(hexv)
        return mk(h, target, s)

    a_sky, a_far, a_mid, a_near = (force_l(a_sky, LADDER[0]), force_l(a_far, LADDER[1]),
                                   force_l(a_mid, LADDER[2]), force_l(a_near, LADDER[3]))
    h_mid = hls(a_mid)[0]
    ramps = {
        "sky":    ramp(a_sky),
        "far":    ramp(a_far, desat_up=0.10),
        "mid":    ramp(a_mid),
        "near":   ramp(a_near),
        # leaf/accent/wood/light 은 주제와 무관하게 '역할'이 있어야 한다.
        # 색상 다양성 점수는 서로 다른 색상환 구간을 요구하므로 일부러 벌린다.
        "leaf":   ramp(mk(h_mid + 14, hls(a_mid)[1] * 0.95, min(0.95, hls(a_mid)[2] * 1.25))),
        # 목재/지면 램프는 전경 레이어에 깔린다 = 화면에서 가장 어두운 면이다.
        # 밝게(L 0.42) 잡아 두면 중경 그림자 톤과 명도가 겹쳐 레이어 분리가
        # 구조적으로 불가능해진다(다섯 팔레트가 전부 dL 0.076에서 막혔다).
        # 중경과의 구분은 밝기가 아니라 **따뜻한 색상**으로 낸다.
        "wood":   ramp(mk(32 + hue_push * 0.4, LADDER[3], 0.44),
                       shadow=0.66, light=1.30),
        "accent": ramp(mk(h_mid + 150, 0.46, min(0.9, max(0.35, hls(a_mid)[2] * 1.2)))),
        # light 램프는 시간대와 무관하게 위로 끝까지 간다. 밤·동굴이라도 달빛·
        # 횃불·입구 빛이 있어야 명도 히스토그램의 위쪽 구간이 채워진다.
        "light":  ramp(mk(hls(a_sky)[0], 0.80, max(0.10, hls(a_sky)[2] * 0.5)),
                       light=1.14, shadow=0.80),
    }
    return t, tm, dedupe(ramps)


def predict(ramps, muted_ok):
    """이 팔레트로 색상 15점을 받을 수 있는지 미리 계산한다.

    렌더까지 가서야 '뮤트라 실패'를 알면 한 바퀴를 통째로 버린다.
    """
    cols = [c for r in ramps.values() for c in r]
    sats = [hls(c)[2] for c in cols]
    lums = [hls(c)[1] for c in cols]
    hues = {int(hls(c)[0] // 20) for c in cols if hls(c)[2] >= 0.15}
    floor = 0.18 if muted_ok else 0.30
    rows = [
        ("평균 채도", f"{sum(sats)/len(sats)*100:.0f}%", f">= {floor*100:.0f}%",
         sum(sats) / len(sats) >= floor),
        ("명도 범위", f"{min(lums)*100:.0f}~{max(lums)*100:.0f}%", ">= 0.55 폭",
         max(lums) - min(lums) >= 0.55),
        ("하이라이트 존재", f"최대 {max(lums)*100:.0f}%", ">= 75%", max(lums) >= 0.75),
        ("그림자 존재", f"최소 {min(lums)*100:.0f}%", "<= 25%", min(lums) <= 0.25),
        ("색조 계열", f"{len(hues)}개", ">= 3개", len(hues) >= 3),
        ("형광 아님", f"최대 채도 {max(sats)*100:.0f}%", "<= 95%", max(sats) <= 0.95),
    ]
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True, help="프리셋 키 (영문 소문자+언더스코어)")
    ap.add_argument("--mood", help="분위기 키워드, 쉼표 구분 (--from 이면 생략 가능)")
    ap.add_argument("--from", dest="src", help="기존 프리셋을 태워 파생한다")
    ap.add_argument("--burn", type=float, default=0.7,
                    help="--from 과 함께. 0=원본 그대로, 1=가장 많이 탄다 (기본 0.7)")
    ap.add_argument("--label", help="한 줄 설명")
    ap.add_argument("--terrain", help=f"자동 판정 대신 직접 지정: {sorted(TERRAIN)}")
    ap.add_argument("--anchors", help="'하늘,원경,중경,전경' hex 4개로 직접 지정")
    ap.add_argument("--layout", default="ground", choices=["ground", "canopy", "interior"])
    ap.add_argument("--kind", default="outdoor", choices=["outdoor", "interior"])
    ap.add_argument("--write", action="store_true", help="presets.json에 바로 추가")
    ap.add_argument("--force", action="store_true", help="같은 이름이 있어도 덮어쓴다")
    a = ap.parse_args()

    # 이름 충돌은 **가장 먼저** 잡는다. 예측표를 찍은 뒤에 실패하면 stderr가
    # 길어져 에러가 묻히고, 낡은 프리셋이 조용히 쓰인다(실제로 그렇게 초록
    # 팔레트가 설원 배경에 들어갔다).
    if a.write and not a.force:
        _d = json.load(open(PRESET_PATH, encoding="utf-8"))
        if a.name in _d:
            raise SystemExit(
                f"'{a.name}' 프리셋이 이미 있다. 기존 프리셋은 다른 배경들이 쓰고 있으므로\n"
                f"조용히 덮지 않는다. 다른 이름을 쓰거나, 정말 갈아엎을 거면 --force.")
    if a.src:
        src = json.load(open(PRESET_PATH, encoding="utf-8")).get(a.src)
        if not src:
            raise SystemExit(f"'{a.src}' 프리셋이 없다.")
        ramps = dedupe(derive(src["ramps"], a.burn))
        # 태우면 레이어 분리가 먼저 깨진다. 렌더하기 전에 알려 준다 —
        # 실측: jungle 을 burn 0.9 로 태우면 near 레이어의 명도차가 0.086 으로
        # 떨어져 bg_check 가 걸린다(기준 0.10).
        def _mean(r):
            return sum(hls(c)[1] for c in r) / len(r)
        gaps = []
        order = [n for n in ("sky", "far", "mid", "near") if n in ramps]
        for x, y in zip(order, order[1:]):
            gaps.append((f"{x}->{y}", _mean(ramps[x]) - _mean(ramps[y]),
                         _mean(src["ramps"][x]) - _mean(src["ramps"][y])))
        if "wood" in ramps and "mid" in ramps:
            gaps.append(("mid->wood", _mean(ramps["mid"]) - _mean(ramps["wood"]),
                         _mean(src["ramps"]["mid"]) - _mean(src["ramps"]["wood"])))
        print("# 레이어 분리 예측 (bg_check 의 '뒤와 명도차' 는 씬에 따라 달라진다)",
              file=sys.stderr)
        for label, now, was in gaps:
            flag = "ok" if now >= 0.10 else "얇음"
            print(f"#   [{flag}] {label:<11} {now:.3f}  (원본 {was:+.3f})", file=sys.stderr)
        if any(now < 0.10 for _, now, _ in gaps):
            print("#   -> --burn 을 낮추거나, 씬에서 base/lit/dark 로 단을 벌릴 것",
                  file=sys.stderr)
        terrain = a.terrain or src.get("terrain", "forest")
        tm = f"burn {a.burn}"
        a.layout = a.layout if a.layout != "ground" else src.get("layout", "ground")
        a.kind = a.kind if a.kind != "outdoor" else src.get("kind", "outdoor")
        a.mood = a.mood or ",".join(src.get("mood", []))
    else:
        if not a.mood:
            raise SystemExit("--mood 또는 --from 중 하나는 있어야 한다.")
        anchors = [x.strip() for x in a.anchors.split(",")] if a.anchors else None
        terrain, tm, ramps = build(a.mood, anchors, a.terrain)
    muted_ok = terrain in MUTED_OK
    entry = {
        "label": a.label or f"{a.mood} — {terrain}",
        "source": (f"derived:{a.src} (burn {a.burn})" if a.src else f"mood:{a.mood}"),
        "kind": a.kind,
        "layout": a.layout,
        "terrain": terrain,
        "paletteMode": "cool" if muted_ok else "vivid",
        "mood": [m.strip() for m in re.split(r"[,\s]+", a.mood) if m.strip()],
        "ramps": ramps,
        "defaults": (dict(json.load(open(PRESET_PATH, encoding="utf-8"))[a.src]
                          .get("defaults", {})) if a.src
                     else {"horizon": 56, "groundTop": 92}),
    }
    print(f"# 판정: 지형={terrain}  시간대={tm or 'day'}  "
          f"팔레트모드={entry['paletteMode']}", file=sys.stderr)
    print("# 색상 채점 예측", file=sys.stderr)
    ok_all = True
    for label, got, want, ok in predict(ramps, muted_ok):
        ok_all &= ok
        print(f"#   [{'ok' if ok else 'FAIL'}] {label:<12} {got:<14} ({want})", file=sys.stderr)
    if not ok_all:
        print("#   -> --anchors 로 앵커를 직접 주거나 --terrain 을 바꿔 다시 뽑을 것",
              file=sys.stderr)
    if a.write:
        d = json.load(open(PRESET_PATH, encoding="utf-8"))
        if a.name in d and not a.force:
            raise SystemExit(f"{a.name} 이미 있음 — --force 없이는 덮지 않는다")
        d[a.name] = entry
        json.dump(d, open(PRESET_PATH, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(f"# presets.json에 '{a.name}' 추가됨", file=sys.stderr)
    else:
        print(json.dumps({a.name: entry}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
