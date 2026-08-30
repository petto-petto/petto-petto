#!/usr/bin/env python3
"""Work out every output path for one pet stage, and build the species pet.json.

The asset tree is grade / species-slug / stage, so a single stage of a single pet
touches up to 8 paths. Typing those by hand is where the mistakes happen — a
wrong grade folder or a missing .json meta only shows up as a silent
placeholder fallback at runtime, long after you stopped looking.

Usage:
    python3 scaffold.py --root /path/to/picxel-game \
        --grade epic --slug aurora_fox --petid 012 --stage 3 \
        --motions idle,click,attack --name 오로라폭스 \
        --body '#7FC8E8' --sub '#FFF3D6,#FF6B9D' [--canvas 48]

Prints: the mkdir command to run on the machine Piskel exports to, the exact
outputPath for each export, and the pet.json to place at the species root.
Pass --write-json <path> to also drop pet.json on disk locally.
"""

import argparse
import json
import re
import sys

GRADES = ("common", "rare", "epic")
MOTIONS = ("idle", "click", "attack")
# canvas, max colours, sub colours, idle frames, click variants
BUDGET = {
    "common": {"canvas": 32, "max_colors": 6, "subs": 1, "idle_frames": 2, "click": 1},
    "rare":   {"canvas": 32, "max_colors": 8, "subs": 2, "idle_frames": 3, "click": 1},
    "epic":   {"canvas": 32, "max_colors": 11, "subs": 3, "idle_frames": 4, "click": 2},
}
FPS = {"idle": 6, "click": 9, "attack": 11}
LOOP = {"idle": True, "click": False, "attack": False}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True, help="project root (contains assets/)")
    ap.add_argument("--grade", required=True, choices=GRADES)
    ap.add_argument("--slug", required=True, help="species folder name, lowercase a-z0-9_")
    ap.add_argument("--petid", required=True, help="3-digit zero-padded, e.g. 012")
    ap.add_argument("--stage", required=True, type=int, choices=(1, 2, 3))
    ap.add_argument("--motions", default="", help="comma list of idle,click,attack")
    ap.add_argument("--name", default="", help="Korean display name")
    ap.add_argument("--body", default="", help="species body colour hex")
    ap.add_argument("--sub", default="", help="comma-separated sub colour hexes")
    ap.add_argument("--canvas", type=int, default=0, help="override canvas size")
    ap.add_argument("--write-json", default="", help="also write pet.json here")
    a = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9_]+", a.slug):
        sys.exit(f"--slug must be lowercase a-z0-9_ : {a.slug!r}")
    if not re.fullmatch(r"\d{3}", a.petid):
        sys.exit(f"--petid must be 3 digits, zero-padded : {a.petid!r}")

    b = BUDGET[a.grade]
    canvas = a.canvas or (48 if (a.grade == "epic" and a.stage == 3) else b["canvas"])
    motions = [m for m in a.motions.replace(" ", "").split(",") if m]
    for m in motions:
        if m not in MOTIONS:
            sys.exit(f"unknown motion {m!r}; expected one of {MOTIONS}")

    species = f"{a.root.rstrip('/')}/assets/pets/{a.grade}/{a.slug}"
    stage_dir = f"{species}/stage{a.stage}"
    stem = f"pet_{a.petid}_s{a.stage}"

    print(f"# 등급 예산 ({a.grade}) — 캔버스 {canvas}x{canvas} / 색 상한 {b['max_colors']} / "
          f"보조색 {b['subs']} / idle {b['idle_frames']}프레임 / 클릭 {b['click']}종")
    if canvas != 32:
        print(f"# ! 캔버스가 32가 아니다 ({canvas}). 결과 보고에 반드시 명시할 것")
    print()
    print("# 1) 디렉터리 생성 — Piskel이 export하는 머신의 쉘에서 실행")
    print(f"mkdir -p '{stage_dir}'")
    print()
    print("# 2) export outputPath (scale=1 고정)")
    print(f"card    {stage_dir}/{stem}_card.png")
    for m in motions:
        print(f"{m:<7} {stage_dir}/{stem}_{m}.png")
        print(f"{'':<7} {stage_dir}/{stem}_{m}.json   (fps {FPS[m]}, loop {str(LOOP[m]).lower()})")
    print()

    subs = [s for s in a.sub.replace(" ", "").split(",") if s]
    if len(subs) > b["subs"]:
        print(f"# ! 보조색 {len(subs)}개는 {a.grade} 예산({b['subs']}개) 초과")
    pet = {
        "petId": a.petid,
        "slug": a.slug,
        "name": a.name or None,
        "grade": a.grade.upper(),
        "stageCount": 3,
        "palette": {"outline": "#2C2438", "body": a.body or None, "sub": subs},
        "canvas": {"stage1": 32, "stage2": 32,
                   "stage3": 48 if a.grade == "epic" else 32},
        "note": "body/outline은 종 단위 고정. Stage 2·3을 그릴 때 이 값을 그대로 쓴다.",
    }
    print(f"# 3) 종 단위 매니페스트 → {species}/pet.json")
    print(json.dumps(pet, ensure_ascii=False, indent=2))
    if a.write_json:
        with open(a.write_json, "w", encoding="utf-8") as f:
            json.dump(pet, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"\n# wrote {a.write_json}")


if __name__ == "__main__":
    main()
