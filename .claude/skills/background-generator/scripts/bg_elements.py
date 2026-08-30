#!/usr/bin/env python3
"""레퍼런스 분석 결과를 채점용 elements.json으로 만들고, 씬과 대조한다.

`bg_score.py`는 "핵심 요소가 실제로 씬에 있는가"를 이 파일로 검증한다.
매번 손으로 쓰면 op 이름을 틀리거나 개수를 안 적게 되므로 여기서 만든다.

Usage:
    python3 bg_elements.py ops                       # 쓸 수 있는 op과 용도
    python3 bg_elements.py template --structure vertical > elements.json
    python3 bg_elements.py count <scene.json> <elements.json>   # 지금 몇 개인지
"""
import argparse
import json
import os
import sys

import bg_pillow_gate  # noqa: F401

OPS = {
    "tree_column":      "화면을 세로로 관통하는 고목·기둥",
    "branch_platform":  "이끼 낀 나뭇가지 발판 / 선반",
    "rope_bridge":      "로프 다리 (처짐 필수)",
    "ladder":           "사다리 — 수직 이동 경로",
    "foliage":          "겹친 잎 로브 덩어리 (안쪽까지 명암)",
    "fringe":           "유기적 실루엣 경계선",
    "hills":            "먼 능선 (사인 곡선)",
    "ground_plane":     "물러나는 지면 — 원근의 유일한 출처",
    "panel":            "널판 면 — 벽·징두리·마루",
    "scatter_depth":    "깊이 띠 배치 — 크기·톤·겹침을 한 번에",
    "stamp":            "스탬프 한 장 ('stamp:vine'처럼 이름 지정 가능)",
    "scatter":          "스탬프 여러 x에 반복",
    "glow":             "디더 감쇠 광원 — 역광·램프·빛 웅덩이",
    "clouds":           "뭉게구름",
    "rays":             "사선 광선",
    "contact_shadow":   "접지 그림자",
    "clearing":         "저대비 구역 (캐릭터 자리)",
    "vgradient":        "세로 그라데이션",
    "texture":          "2~3px 조각 디테일 (density <= 0.03)",
    "band":             "수평 밴드 — 지면에는 ground_plane을 쓸 것",
    "tile":             "스탬프 반복 채우기",
    "autoshade":        "레이어의 기존 덩어리에 3톤 자동 부여",
    "specks":           "잎·반딧불·먼지",
    "vignette":         "가장자리 어둡게",
    "rect": "사각형 — 줄기에 쓰면 전봇대가 된다. tree_column을 쓸 것",
    "fill": "레이어 전체 채우기",
}

TEMPLATES = {
    "vertical": [("화면을 세로로 관통하는 거대 고목", "tree_column", 6),
                 ("다층 발판", "branch_platform", 4),
                 ("로프 다리", "rope_bridge", 2),
                 ("수직 이동 경로(사다리)", "ladder", 1),
                 ("역광 개방부", "glow", 2),
                 ("늘어진 덩굴", "stamp:vine", 3),
                 ("잎 덩어리 군락", "foliage", 6)],
    "horizontal": [("물러나는 지면", "ground_plane", 1),
                   ("잎 덩어리 군락", "foliage", 2),
                   ("중경 실루엣 라인", "fringe", 1),
                   ("깊이 띠 배치", "scatter_depth", 3),
                   ("접지 그림자", "contact_shadow", 1),
                   ("하늘 요소(구름/광선)", "clouds", 1)],
    "layered": [("층을 나누는 구조물", "branch_platform", 3),
                ("세로 요소", "tree_column", 3),
                ("잎/디테일 군락", "foliage", 4),
                ("빛 웅덩이", "glow", 2),
                ("깊이 띠 배치", "scatter_depth", 2)],
}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ops")
    t = sub.add_parser("template")
    t.add_argument("--structure", required=True, choices=sorted(TEMPLATES))
    t.add_argument("--reference", default="TODO: 레퍼런스 파일 경로")
    c = sub.add_parser("count")
    c.add_argument("scene")
    c.add_argument("elements")
    a = ap.parse_args()

    if a.cmd == "ops":
        for k, v in OPS.items():
            print(f"  {k:<18} {v}")
        return

    if a.cmd == "template":
        print(json.dumps({
            "reference": a.reference,
            "structure": a.structure,
            "note": "이름과 min을 레퍼런스 실제 분석에 맞게 고칠 것. 요소는 5개 이상.",
            "elements": [{"name": n, "op": o, "min": m}
                         for n, o, m in TEMPLATES[a.structure]],
        }, ensure_ascii=False, indent=2))
        return

    scene = json.load(open(a.scene, encoding="utf-8"))
    spec = json.load(open(a.elements, encoding="utf-8"))
    for e in spec["elements"]:
        op, nm = (e["op"].split(":", 1) + [None])[:2] if ":" in e["op"] else (e["op"], None)
        n = 0
        for lay in scene.get("layers", []):
            for o in lay.get("ops", []):
                if o.get("op") != op or (nm and o.get("name") != nm):
                    continue
                n += 1 if op != "scatter_depth" else max(1, o.get("count", 1))
        print(f"  {'O' if n >= e.get('min',1) else 'X'} {e['name']:<28} {n} / {e.get('min',1)}")


if __name__ == "__main__":
    main()
