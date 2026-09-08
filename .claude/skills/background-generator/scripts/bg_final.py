#!/usr/bin/env python3
"""최종 통과 판정 — 다섯 조건을 모두 만족해야 완성이다.

    1. 기술 검사        bg_check.py PASS
    2. 시각 품질 점수    사용자 확인(judged_by=user), 또는 --unattended 로 >= 80/100
    3. 핵심 요소        이미지에서 육안으로 5개 이상 확인
    4. 팔레트/톤 요구   사용자가 지정한 색·톤 요구 충족
    5. 검수 결과 첨부    실제 합성 PNG를 붙인 시각 검수가 존재

기술 검사만 통과하고 시각 품질이 미달이면 **PASS로 끝내지 않는다.** 부족한
영역과 재생성 프롬프트를 함께 낸다. 수치가 다 초록인데 그림이 못 쓰는 상태인
경우가 실제로 있었고, 그때 "PASS"라고 보고한 것이 이 스크립트를 만든 이유다.

Usage:
    python3 bg_final.py <out-dir> --elements elements.json --visual visual.json
    python3 bg_final.py <out-dir> --elements e.json --visual v.json --mode edit --prev <이전>
"""
import argparse
import json
import os
import subprocess
import sys

import bg_pillow_gate  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("outdir")
    ap.add_argument("--elements", required=True)
    ap.add_argument("--visual", required=True, help="bg_visual.py verify용 채워진 서식")
    ap.add_argument("--prev")
    ap.add_argument("--unattended", action="store_true",
                    help="사용자에게 물을 수 없는 실행. 자기 채점(judged_by=self)으로 "
                         "최종 통과를 선언하려면 이 플래그를 명시해야 한다.")
    ap.add_argument("--mode", default="create", choices=["create", "edit"],
                    help="edit이면 구도 유지가 목적이므로 '이전과 유사' 트리거를 끈다")
    a = ap.parse_args()

    rows = []
    ok_all = True

    rc, out = run([sys.executable, f"{HERE}/bg_check.py", a.outdir])
    rows.append(("1. 기술 검사 (bg_check)", rc == 0,
                 out.strip().splitlines()[-1] if out.strip() else ""))
    ok_all &= rc == 0

    cmd = [sys.executable, f"{HERE}/bg_score.py", a.outdir, "--elements", a.elements]
    if a.prev and a.mode == "create":
        cmd += ["--prev", a.prev]
    rc2, out2 = run(cmd)
    score_line = next((l for l in out2.splitlines() if l.startswith("총점")), "")
    rows.append(("   (참고) 수치 점수 bg_score", rc2 == 0, score_line.strip()))
    ok_all &= rc2 == 0

    rc3, out3 = run([sys.executable, f"{HERE}/bg_visual.py", "verify", a.visual])
    vlines = out3.strip().splitlines()
    vscore = next((l for l in vlines if l.startswith("시각 품질 점수")), "")
    velem = next((l for l in vlines if l.startswith("핵심 요소")), "")
    vpal = next((l for l in vlines if l.startswith("팔레트")), "")
    v_early = json.load(open(a.visual, encoding="utf-8"))
    judged = str(v_early.get("judged_by", "self")).strip().lower()
    # 그림의 좋고 나쁨은 사용자가 판단한다. 물을 수 있는데 자기 채점으로 통과를
    # 선언하면, 수치가 다 초록인데 그림이 못 쓰는 상태가 PASS 로 보고된다 —
    # 이 스크립트가 존재하는 이유가 바로 그 사고였다.
    self_judged = judged != "user"
    if self_judged and not a.unattended:
        rows.append(("2. 시각 품질 (사용자 확인)", False,
                     "자기 채점(judged_by=self)이다. 사용자에게 합성본을 보여주고 "
                     "judged_by=user 로 다시 받거나, 정말 물을 수 없으면 --unattended 를 준다."))
        ok_all = False
    else:
        label = ("2. 시각 품질 >= 80 (무인 — 사용자 승인 없음)"
                 if self_judged else "2. 시각 품질 >= 80 (사용자 확인)")
        rows.append((label, "시각 품질" in vscore and rc3 == 0, vscore))
    rows.append(("3. 핵심 요소 >= 5 (육안)", rc3 == 0 or "5" in velem, velem))
    rows.append(("4. 팔레트/톤 요구 충족", "충족" in vpal and "미충족" not in vpal, vpal))
    ok_all &= rc3 == 0

    v = v_early
    sheet = v.get("sheet", "")
    has_sheet = bool(sheet) and os.path.exists(sheet)
    rows.append(("5. 합성 PNG 첨부 검수", has_sheet, sheet or "(시트 경로 없음)"))
    ok_all &= has_sheet

    if a.mode == "edit":
        rows.append(("   편집 모드", True,
                     "'이전과 유사' 재생성 트리거를 끔 — 구도 유지가 목적이다"))

    print("=" * 66)
    for name, ok, detail in rows:
        print(f"[{'ok  ' if ok else 'FAIL'}] {name:<26} {detail}")
    print("=" * 66)
    print(f"최종 판정: {'PASS' if ok_all else 'FAIL'}")
    if not ok_all:
        print("\n미달이다. 'PASS'로 보고하지 말 것. 결과 보고에 반드시 포함할 것:")
        print("  - 어느 영역이 부족한지 (bg_visual verify의 '부족한 영역')")
        print("  - 그 영역을 고치는 구체적 재생성 프롬프트")
        if rc3 != 0:
            print("\n--- 시각 검수 상세 ---")
            print(out3.strip())
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
