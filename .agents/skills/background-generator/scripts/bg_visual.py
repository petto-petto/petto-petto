#!/usr/bin/env python3
"""시각 검수 — 수치 게이트와 **별개로**, 생성된 그림 자체를 보고 채점한다.

수치는 "망치지 않았는가"까지만 답한다. 실제로 반려된 결함들(평평한 구도,
막대사탕 나무, 탁한 색, 읽히지 않는 발판)은 전부 bg_check와 bg_score를
통과한 상태에서 눈으로 잡혔다. 그래서 그림을 직접 보는 채점을 따로 둔다.

    sheet   검수용 대조 시트를 만든다 (합성본 확대 + 레이어별 + 캐릭터 합성)
    form    채점 서식(JSON)을 찍는다 — 보고 나서 채워 넣는다
    verify  채워진 서식을 검증하고 총점·통과 여부를 낸다

Usage:
    python3 bg_visual.py sheet <out-dir> --out /tmp/sheet.png [--pet pet.png]
    python3 bg_visual.py form  > /tmp/visual.json
    python3 bg_visual.py verify /tmp/visual.json
"""
import argparse
import json
import os
import sys
import warnings

import bg_pillow_gate  # noqa: F401

warnings.filterwarnings("ignore", category=DeprecationWarning)

# 7개 항목 x 배점 = 100점. 사용자가 실제로 보는 것만 남겼다.
CRITERIA = [
    ("reference_structure", 20,
     "레퍼런스(또는 요청)의 공간 구조가 실제 이미지에 반영됐는가",
     "레퍼런스가 다층 수직인데 평평한 가로 풍경이면 0점. 레퍼런스가 없으면 "
     "사용자가 말로 요구한 구조를 기준으로 본다."),
    ("layer_separation", 15,
     "전경·중경·원경이 눈으로 명확히 분리되는가",
     "실눈을 뜨고 봤을 때 세 덩어리로 갈라지면 만점. 한 덩어리로 뭉치면 0점."),
    ("playability", 15,
     "캐릭터가 설 위치와 발판·이동 경로가 한눈에 읽히는가",
     "어디에 서고 어디로 갈 수 있는지 설명 없이 보이는가."),
    ("color_richness", 15,
     "탁한 뮤트가 아니라 선명하고 풍부한 트루컬러인가",
     "회색기가 끼어 빛바랜 느낌이면 감점. 단, 눈·동굴처럼 원래 채도가 낮은 "
     "주제는 색조와 명도로 살아 있으면 만점."),
    ("depth_by_tone", 15,
     "레이어별 명도·채도 차이로 깊이감이 생기는가",
     "뒤로 갈수록 옅어지거나 앞으로 올수록 진해지는 흐름이 보이는가."),
    ("variation", 10,
     "단순 반복 스탬프가 아니라 나무·발판·식생의 형태와 색에 변화가 있는가",
     "같은 그림이 일정 간격으로 복사돼 보이면 감점."),
    ("pixel_fidelity", 10,
     "도트 표현이 매끄러운 페인팅이나 자동 질감처럼 흐려지지 않았는가",
     "픽셀 격자가 일관되고 팔레트가 제한적으로 보이는가. 안티앨리어싱된 "
     "가장자리나 노이즈 뭉개짐이 있으면 감점."),
]
PASS = 80


def build_sheet(outdir, out, pet=None, scale=2):
    from PIL import Image
    metas = [f for f in os.listdir(outdir) if f.endswith(".json") and f != "scene.json"]
    meta = json.load(open(os.path.join(outdir, metas[0]), encoding="utf-8"))
    comp = Image.open(os.path.join(outdir, meta["composite"])).convert("RGBA")
    W, H = comp.size
    tiles = [("합성본", comp)]
    if pet and meta.get("petAnchor"):
        pa = meta["petAnchor"]
        p = Image.open(pet).convert("RGBA")
        if p.size != (pa["w"], pa["h"]):
            p = p.resize((pa["w"], pa["h"]), Image.NEAREST)
        c = comp.copy(); c.alpha_composite(p, (pa["x"], pa["y"]))
        tiles.append(("캐릭터 합성", c))
    for l in sorted(meta["layers"], key=lambda x: x["z"]):
        lay = Image.open(os.path.join(outdir, l["file"])).convert("RGBA")
        chk = Image.new("RGBA", lay.size, (44, 44, 52, 255))
        for y in range(0, lay.size[1], 8):
            for x in range(0, lay.size[0], 8):
                if (x // 8 + y // 8) % 2:
                    chk.paste((56, 56, 66, 255),
                              (x, y, min(x + 8, lay.size[0]), min(y + 8, lay.size[1])))
        chk.alpha_composite(lay)
        tiles.append((f"레이어 {l['name']} (parallax {l['parallax']})", chk))
    gap = 10
    sheet = Image.new("RGBA", (W, H * len(tiles) + gap * (len(tiles) - 1)), (16, 16, 20, 255))
    y = 0
    for _, im in tiles:
        sheet.alpha_composite(im, (0, y)); y += H + gap
    sheet.convert("RGB").resize((W * scale, sheet.size[1] * scale), Image.NEAREST).save(out)
    print(f"written: {out}  ({len(tiles)}장 x{scale})")
    for i, (name, _) in enumerate(tiles):
        print(f"  {i + 1}. {name}")
    return meta


def form():
    return {
        "_howto": "각 항목을 0~만점으로. 근거(evidence)에는 '이미지에서 무엇이 보였는지'를 쓴다. "
                  "수치 게이트 결과나 REPORT의 자기평가를 근거로 쓰지 않는다 — 그림만 본다.",
        "sheet": "검수 시트 PNG 경로",
        "scores": [{"id": c[0], "max": c[1], "criterion": c[2], "score": None, "evidence": ""}
                   for c in CRITERIA],
        "palette_requirement": {"asked": "", "met": None, "evidence": ""},
        "reference_elements_seen": {"required_min": 5, "seen": [], "count": 0},
    }


def verify(path):
    v = json.load(open(path, encoding="utf-8"))
    by = {c[0]: c for c in CRITERIA}
    total = 0
    print("=" * 60)
    for row in v["scores"]:
        c = by.get(row["id"])
        if not c:
            raise SystemExit(f"알 수 없는 항목: {row['id']}")
        sc = row.get("score")
        if sc is None or not (0 <= sc <= c[1]):
            raise SystemExit(f"{row['id']}: 점수가 없거나 범위를 벗어남 (0~{c[1]})")
        if not str(row.get("evidence", "")).strip():
            raise SystemExit(f"{row['id']}: 근거(evidence)가 비어 있다 — 그림에서 본 것을 적을 것")
        total += sc
        print(f"[{sc:>2}/{c[1]:>2}] {c[2]}")
        print(f"        {row['evidence']}")
    pal = v.get("palette_requirement", {})
    els = v.get("reference_elements_seen", {})
    n = els.get("count") or len(els.get("seen", []))
    need = els.get("required_min", 5)
    print("=" * 60)
    print(f"시각 품질 점수 {total}/100   (통과 {PASS})")
    print(f"핵심 요소 육안 확인 {n}/{need}개: {', '.join(els.get('seen', [])) or '없음'}")
    print(f"팔레트/톤 요구사항 {'충족' if pal.get('met') else '미충족'}"
          + (f" — {pal.get('evidence','')}" if pal.get("evidence") else ""))
    fails = []
    if total < PASS:
        fails.append(f"시각 품질 {total}점 < {PASS}점")
    if n < need:
        fails.append(f"핵심 요소 육안 확인 {n}개 < {need}개")
    if pal.get("met") is not True:
        fails.append("팔레트/톤 요구사항 미충족")
    low = [f"{by[r['id']][2]} ({r['score']}/{by[r['id']][1]})"
           for r in v["scores"] if r["score"] < by[r["id"]][1] * 0.6]
    if low:
        print("\n부족한 영역:")
        for l in low:
            print(f"  - {l}")
    print(f"\n판정: {'PASS' if not fails else 'FAIL'}")
    if fails:
        print("미달 사유: " + " / ".join(fails))
        print("\n-> 통과로 보고하지 말 것. 부족한 영역과 재생성 프롬프트를 함께 낸다.")
    sys.exit(0 if not fails else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("sheet"); a.add_argument("outdir"); a.add_argument("--out", required=True)
    a.add_argument("--pet"); a.add_argument("--scale", type=int, default=2)
    sub.add_parser("form")
    b = sub.add_parser("verify"); b.add_argument("path")
    n = ap.parse_args()
    if n.cmd == "sheet":
        build_sheet(n.outdir, n.out, n.pet, n.scale)
    elif n.cmd == "form":
        print(json.dumps(form(), ensure_ascii=False, indent=2))
    else:
        verify(n.path)


if __name__ == "__main__":
    main()
