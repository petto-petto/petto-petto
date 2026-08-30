#!/usr/bin/env python3
"""Final structural audit of the pet asset tree.

Run this after export, as the last step of any pet-asset job. The palette gate
in palette.py checks what is *inside* one sprite; this checks everything
*around* it — where files sit, what they are named, whether every sheet has the
JSON the runtime needs to slice it, and whether the numbers in that JSON match
the PNG on disk.

These failures are the expensive kind: nothing errors at build time, the game
just silently falls back to a placeholder and you find out weeks later. A
sprite sheet without its .json cannot be sliced at all. Two species sharing a
petId corrupt the collection counter. A file named for stage 2 sitting in the
stage 1 folder loads the wrong art.

Usage:
    python3 audit.py --root /path/to/picxel-game
    python3 audit.py --root . --species common/mole_digger
    python3 audit.py --root . --policy planC

Policies (which motions each stage must have):
    full   (default) card + idle + click + attack in every stage
    planC  spec 3-6: card + idle in every stage; click + attack in the last
           stage only, shared by the earlier ones at runtime

Exit 0 = clean, 1 = something needs fixing.
"""

import argparse
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required:  pip install pillow --break-system-packages")

OUTLINE = "#2C2438"
GRADES = ("common", "rare", "epic")
MOTIONS = ("idle", "click", "click2", "attack")
ONESHOT = ("click", "click2", "attack")
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import budget  # 프레임 수·클릭 종수의 단일 진실 공급원
FNAME = re.compile(r"^pet_(\d{3})_s([1-3])_(card|idle|click2|click|attack)\.(png|json)$")


class Report:
    def __init__(self):
        self.fail, self.warn, self.ok = [], [], 0

    def f(self, where, msg, fix=None):
        self.fail.append((where, msg, fix))

    def w(self, where, msg):
        self.warn.append((where, msg))

    def p(self):
        self.ok += 1


def hx(c):
    return "#%02X%02X%02X" % c[:3]


def frames_of(im, fw):
    W, H = im.size
    return [im.crop((i * fw, 0, (i + 1) * fw, H)) for i in range(W // fw)]


def audit_species(root, grade, slug, policy, r):
    sp = os.path.join(root, "assets", "pets", grade, slug)
    where = f"{grade}/{slug}"

    if not re.fullmatch(r"[a-z0-9_]+", slug):
        r.f(where, f"slug '{slug}' 이 소문자+숫자+언더스코어 형식이 아니다")

    # --- pet.json ---------------------------------------------------------
    meta_path = os.path.join(sp, "pet.json")
    pet = None
    if not os.path.exists(meta_path):
        r.f(where, "pet.json 이 없다 — 단계 간 몸통색 고정의 근거가 사라진다",
            f"scripts/scaffold.py 로 생성해 {where}/pet.json 에 둘 것")
    else:
        try:
            pet = json.load(open(meta_path, encoding="utf-8"))
        except json.JSONDecodeError as e:
            r.f(where, f"pet.json 파싱 실패: {e}")
        if pet:
            for k in ("petId", "slug", "grade", "palette"):
                if k not in pet:
                    r.f(where, f"pet.json 에 '{k}' 필드가 없다")
            if pet.get("grade", "").lower() != grade:
                r.f(where, f"pet.json grade={pet.get('grade')} 인데 폴더는 {grade}/ 다")
            if pet.get("slug") != slug:
                r.f(where, f"pet.json slug={pet.get('slug')} 인데 폴더명은 {slug} 다")
            if not re.fullmatch(r"\d{3}", str(pet.get("petId", ""))):
                r.f(where, f"petId '{pet.get('petId')}' 가 3자리 zero-padded 가 아니다")
            if (pet.get("palette") or {}).get("outline", "").upper() not in ("", OUTLINE):
                r.f(where, f"pet.json outline 이 {OUTLINE} 이 아니다")
            r.p()

    pid = str(pet.get("petId")) if pet else None

    # --- stage folders ----------------------------------------------------
    stages = sorted(d for d in os.listdir(sp)
                    if os.path.isdir(os.path.join(sp, d))) if os.path.isdir(sp) else []
    for d in stages:
        if not re.fullmatch(r"stage[1-3]", d):
            r.f(where, f"예상 밖 폴더 '{d}' — stage1/stage2/stage3 만 허용")
    stage_nums = sorted(int(d[-1]) for d in stages if re.fullmatch(r"stage[1-3]", d))
    if not stage_nums:
        r.f(where, "stage 폴더가 하나도 없다")
        return pid
    last = max(stage_nums)

    for st in stage_nums:
        sd = os.path.join(sp, f"stage{st}")
        w2 = f"{where}/stage{st}"
        names = sorted(os.listdir(sd))
        seen = {}

        for n in names:
            m = FNAME.match(n)
            if not m:
                r.f(w2, f"'{n}' 이 파일명 규칙 pet_{{petId}}_s{{stage}}_{{motion}}.{{png|json}} 에 안 맞는다")
                continue
            fpid, fst, motion, ext = m.group(1), int(m.group(2)), m.group(3), m.group(4)
            if pid and fpid != pid:
                r.f(w2, f"'{n}' 의 petId({fpid})가 pet.json({pid})과 다르다",
                    f"mv {n} pet_{pid}_s{st}_{motion}.{ext}")
            if fst != st:
                r.f(w2, f"'{n}' 은 stage{fst} 파일인데 stage{st}/ 안에 있다")
            seen.setdefault(motion, set()).add(ext)

        # 카드는 항상 필요, 그리고 png 만 (json 없음)
        if "card" not in seen:
            r.f(w2, "도감 카드(_card.png)가 없다")
        elif "png" not in seen["card"]:
            r.f(w2, "_card 의 png 가 없다")
        else:
            r.p()

        # 필요한 모션
        required = ["idle"]
        if policy == "full" or st == last:
            required += ["click", "attack"]
            if budget.CLICK_VARIANTS[grade] >= 2:
                required += ["click2"]
        for mo in required:
            if mo not in seen:
                note = "" if policy == "full" else f" (policy={policy}: 최종 stage{last} 기준)"
                r.f(w2, f"{mo} 모션이 없다{note}")

        # png/json 짝
        for mo, exts in seen.items():
            if mo == "card":
                if "json" in exts:
                    r.w(w2, f"_card 에 .json 이 붙어 있다 — 정지 이미지에는 메타가 필요 없다")
                continue
            if "png" in exts and "json" not in exts:
                r.f(w2, f"{mo}.png 는 있는데 {mo}.json 메타가 없다 — 런타임이 프레임을 자를 수 없어 재생이 안 된다",
                    f"{sd}/pet_{pid or 'XXX'}_s{st}_{mo}.json 생성 (frameWidth/frameHeight/frameCount/columns/fps/loop)")
            elif "json" in exts and "png" not in exts:
                r.f(w2, f"{mo}.json 만 있고 {mo}.png 가 없다")

        # 내용 검사
        for mo in sorted(seen):
            png = os.path.join(sd, f"pet_{pid}_s{st}_{mo}.png") if pid else None
            if not png or not os.path.exists(png):
                continue
            im = Image.open(png).convert("RGBA")
            W, H = im.size

            expected_canvas = 48 if (grade == "epic" and st == 3) else 32
            if H != expected_canvas:
                r.f(w2, f"{mo}: 캔버스 높이 {H}px, 기대 {expected_canvas}px"
                        + ("  (EPIC 최종 단계만 48 허용)" if expected_canvas == 32 else ""))
            if mo == "card" and W != expected_canvas:
                r.f(w2, f"card: 폭 {W}px, 기대 {expected_canvas}px — 카드는 프레임 1장이다")

            alphas = {p[3] for p in im.getdata()}
            if not alphas <= {0, 255}:
                r.f(w2, f"{mo}: 반투명 픽셀이 있다 (알파 {sorted(alphas - {0, 255})[:4]}) — "
                        f"미획득 실루엣 처리 때 테두리가 지저분해진다")

            if mo == "card":
                px = im.load()
                edge = [(x, y) for x in range(W) for y in range(H)
                        if (x in (0, W - 1) or y in (0, H - 1)) and px[x, y][3]]
                if edge:
                    r.f(w2, f"card: 스프라이트가 캔버스 가장자리에 닿는다 ({len(edge)}px) — 확대 시 잘린다")
                r.p()
                continue

            jf = os.path.join(sd, f"pet_{pid}_s{st}_{mo}.json")
            if not os.path.exists(jf):
                continue
            try:
                m = json.load(open(jf, encoding="utf-8"))
            except json.JSONDecodeError as e:
                r.f(w2, f"{mo}.json 파싱 실패: {e}")
                continue
            missing = [k for k in ("frameWidth", "frameHeight", "frameCount", "loop")
                       if k not in m]
            if missing:
                r.f(w2, f"{mo}.json 에 {', '.join(missing)} 이(가) 없다")
                continue
            fw, fh, fc = m["frameWidth"], m["frameHeight"], m["frameCount"]
            if W != fw * fc or H != fh:
                r.f(w2, f"{mo}: 시트는 {W}x{H} 인데 메타는 {fw}x{fh} x {fc}프레임 = {fw*fc}x{fh} 다"
                        f" — 마지막에 빈 칸이 재생되거나 프레임이 어긋난다")
                continue
            r.p()

            want_loop = (mo == "idle")
            if bool(m["loop"]) != want_loop:
                r.f(w2, f"{mo}: loop={m['loop']} — {'idle 은 true' if want_loop else '1회 재생 모션은 false'} 여야 한다")

            frs = frames_of(im, fw)
            pals = {frozenset(hx(p) for p in f.getdata() if p[3]) for f in frs}
            if len(pals) > 2:
                r.w(w2, f"{mo}: 프레임마다 팔레트가 다르다({len(pals)}종) — "
                        f"눈 감기 프레임 하나 정도가 아니면 replace_color 를 allFrames 로 안 돌린 흔적이다")

            if mo in ONESHOT and frs[0].tobytes() != frs[-1].tobytes():
                d = sum(1 for a, b in zip(frs[0].getdata(), frs[-1].getdata()) if a != b)
                r.f(w2, f"{mo}: 마지막 프레임이 f0(중립)과 {d}px 다르다 — "
                        f"1회 재생이 끝나고 idle 로 돌아갈 때 툭 튄다",
                    f"마지막 프레임을 f0 와 동일하게 되돌릴 것")

            base_mo = "click" if mo == "click2" else mo
            want_fc = budget.FRAME_COUNT.get(base_mo, {}).get(grade)
            if want_fc and fc != want_fc:
                r.w(w2, f"{mo} {fc}프레임 — {grade.upper()} 기준은 {want_fc}프레임")

            # 평행이동만 있는 애니메이션 — 살아 있어 보이지 않는 가장 흔한 원인
            boxes = set()
            for f in frs:
                fp = f.load()
                pts = [(x, y) for y in range(f.size[1]) for x in range(f.size[0]) if fp[x, y][3]]
                if pts:
                    boxes.add((max(p[0] for p in pts) - min(p[0] for p in pts),
                               max(p[1] for p in pts) - min(p[1] for p in pts)))
            if len(boxes) == 1 and fc > 1:
                r.w(w2, f"{mo}: 모든 프레임의 실루엣 크기가 같다 — 통째로 움직이기만 하고 "
                        f"형태가 안 변했을 가능성이 크다. motion_check.py 로 정렬 후 차이를 "
                        f"측정하고, 미달이면 motion_make.py 로 다시 뽑을 것")

        n_click = len([k for k in seen if k.startswith("click")])
        want_cv = budget.CLICK_VARIANTS[grade]
        if n_click and n_click != want_cv:
            r.w(w2, f"클릭 반응 {n_click}종 — 기준은 {want_cv}종")

    return pid


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True, help="project root (contains assets/)")
    ap.add_argument("--species", default="", help="'grade/slug' 하나만 검사 (생략하면 전체)")
    ap.add_argument("--policy", choices=("full", "planC"), default="full")
    a = ap.parse_args()

    base = os.path.join(a.root, "assets", "pets")
    if not os.path.isdir(base):
        sys.exit(f"{base} 가 없다")

    targets = []
    if a.species:
        g, _, s = a.species.partition("/")
        targets = [(g, s)]
    else:
        for g in sorted(os.listdir(base)):
            if not os.path.isdir(os.path.join(base, g)):
                continue
            if g not in GRADES:
                print(f"FAIL  assets/pets/{g} — 등급 폴더는 common/rare/epic 만 허용")
                continue
            targets += [(g, s) for s in sorted(os.listdir(os.path.join(base, g)))
                        if os.path.isdir(os.path.join(base, g, s))]

    r = Report()
    ids = {}
    for g, s in targets:
        pid = audit_species(a.root, g, s, a.policy, r)
        if pid:
            ids.setdefault(pid, []).append(f"{g}/{s}")

    for pid, owners in sorted(ids.items()):
        if len(owners) > 1:
            r.f("전역", f"petId {pid} 을 {len(owners)}개 종이 함께 쓴다: {', '.join(owners)} — "
                        f"도감 진행도가 '서로 다른 petId 수' 기준이라 여러 마리가 1종으로 세어진다",
                "한쪽을 빈 번호로 바꾸고 파일명도 함께 리네임할 것")

    print(f"검사 대상: {len(targets)}종  (policy={a.policy})\n")
    for where, msg, fix in r.fail:
        print(f"FAIL  [{where}] {msg}")
        if fix:
            print(f"      -> {fix}")
    for where, msg in r.warn:
        print(f"WARN  [{where}] {msg}")
    print(f"\n통과 {r.ok}건 / 실패 {len(r.fail)}건 / 경고 {len(r.warn)}건")
    print("RESULT: " + ("PASS — 구조·네이밍·메타 이상 없음"
                        if not r.fail else "FAIL — 위 FAIL 을 고치고 다시 실행할 것"))
    sys.exit(1 if r.fail else 0)


if __name__ == "__main__":
    main()
