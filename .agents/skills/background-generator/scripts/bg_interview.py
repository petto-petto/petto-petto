#!/usr/bin/env python3
"""요청의 모호도를 재고, 다음에 무엇을 물어야 하는지 고른다.

왜 필요한가. 같은 사람이 같은 스킬로 같은 날 만든 두 결과가 이렇게 갈렸다.

  "서재 같은 분위기로 배경 만들어줘"                        -> 밋밋함
  "cozy한 서재. 편안한 쇼파와 러그, 쇼파 위에 담요,
   560x240, 방 안에 난로, 벽에 액자와 사슴 뿔,
   창 밖에는 눈. 창밖은 춥고 대비되게 방안은 안락하게"      -> 그럴듯함

차이는 스킬이 아니라 **입력의 구체성**이다. 그러니 그리기 전에 구체성을 재고,
부족하면 물어야 한다. 다만 '모호하다'가 느낌으로 남으면 매번 판단이 갈리므로,
장면 명세를 슬롯으로 쪼개고 가중치로 센다.

    모호도(%) = 100 - (채워진 슬롯의 가중치 합)

**20% 이하가 될 때까지 묻는다.** 그 이상이면 그리지 않는다 — 그려 봐야 다시
그린다.

Usage:
    python3 bg_interview.py slots                     # 슬롯표와 가중치
    python3 bg_interview.py template > spec.json      # 빈 명세
    python3 bg_interview.py score spec.json           # 모호도 계산
    python3 bg_interview.py next spec.json            # 다음에 물을 것 (가중치 순)
    python3 bg_interview.py brief spec.json           # 확인용 장면 브리프 문장
"""
import argparse
import json
import sys

import bg_pillow_gate  # noqa: F401

# 가중치는 "이게 비면 결과가 얼마나 갈리는가"로 정했다. 위 두 프롬프트를 이
# 표로 채점하면 각각 12% / 88% 가 나온다 — 체감과 맞는다.
SLOTS = [
    ("space_kind", 12, "공간 종류",
     "서재 / 숲 / 동굴 / 설원 / 하늘 플랫폼 …",
     "무엇을 그리는 장면인지. 이게 없으면 아무것도 시작 못 한다"),
    ("objects", 18, "주요 오브젝트 (3개 이상)",
     "소파, 난로, 창, 액자, 사슴뿔 장식 / 고목, 이끼 발판, 로프 다리",
     "화면을 채우는 건 분위기 형용사가 아니라 물건이다. 가장 무거운 슬롯"),
    ("structure", 12, "공간 구조",
     "가로형 / 다층 수직 / 실내 정면 / 좌우로 열린 시야",
     "레이아웃(ground/canopy/interior)을 여기서 정한다. 나중에 바꾸면 전부 다시 그린다"),
    ("size", 10, "캔버스 크기",
     "560x240 / 480x200",
     "구도 상수가 전부 여기 비례한다"),
    ("placement", 10, "배치와 관계",
     "쇼파 위에 담요 / 벽 오른쪽에 액자 / 중앙은 비움",
     "물건 목록만 있고 배치가 없으면 나열이 된다"),
    ("light", 10, "조명과 광원",
     "난롯불 / 창으로 드는 빛 / 역광 안개 / 낮·밤",
     "명암 설계의 근거. 없으면 평평해진다"),
    ("color_tone", 10, "색·톤 방향",
     "따뜻한 주황 / 차가운 청록 / 선명하게 / 차분하게",
     "팔레트 선택이나 새 프리셋 생성의 입력"),
    ("contrast", 8, "대비 구조",
     "창밖은 춥고 방 안은 따뜻하게 / 원경은 안개, 전경은 짙게",
     "좋은 배경은 대개 대비 하나를 축으로 삼는다"),
    ("character_spot", 6, "캐릭터 자리",
     "중앙 바닥 / 왼쪽 발판 위 / 지정 없음",
     "petAnchor 위치"),
    ("time_weather", 4, "시간대·날씨",
     "눈 내림 / 노을 / 비 / 맑음",
     "있으면 좋고 없어도 기본값으로 진행 가능"),
]
THRESHOLD = 20


def template():
    return {"_howto": "각 슬롯을 사용자의 말로 채운다. 추측으로 채우지 않는다 — "
                      "추측한 것은 assumed에 적고, 결과 보고에도 밝힌다.",
            "request": "",
            "slots": {k: "" for k, *_ in SLOTS},
            "assumed": {}}


def score(spec):
    filled, missing = 0, []
    for key, w, name, ex, why in SLOTS:
        v = str(spec.get("slots", {}).get(key, "")).strip()
        if v:
            filled += w
        else:
            missing.append((w, key, name, ex, why))
    return 100 - filled, sorted(missing, reverse=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("slots")
    sub.add_parser("template")
    for c in ("score", "next", "brief"):
        p = sub.add_parser(c); p.add_argument("spec")
    a = ap.parse_args()

    if a.cmd == "slots":
        print(f"{'슬롯':<16}{'가중치':>6}  설명")
        for key, w, name, ex, why in SLOTS:
            print(f"  {name:<22}{w:>4}  예) {ex}")
            print(f"  {'':<22}      {why}")
        print(f"\n모호도 = 100 - 채워진 가중치 합.  {THRESHOLD}% 이하가 될 때까지 묻는다.")
        return
    if a.cmd == "template":
        print(json.dumps(template(), ensure_ascii=False, indent=2)); return

    spec = json.load(open(a.spec, encoding="utf-8"))
    amb, missing = score(spec)

    if a.cmd == "score":
        print(f"모호도 {amb}%  (기준 {THRESHOLD}% 이하)")
        for key, w, name, ex, why in SLOTS:
            v = str(spec.get("slots", {}).get(key, "")).strip()
            mark = "O" if v else "X"
            print(f"  [{mark}] {name:<22} {w:>3}점  {v[:56] or '— 비어 있음'}")
        if spec.get("assumed"):
            print("\n추측으로 채운 것 (결과 보고에 반드시 밝힐 것):")
            for k, v in spec["assumed"].items():
                print(f"  - {k}: {v}")
        print(f"\n판정: {'진행 가능' if amb <= THRESHOLD else '아직 묻는다'}")
        sys.exit(0 if amb <= THRESHOLD else 1)

    if a.cmd == "next":
        if amb <= THRESHOLD:
            print(f"모호도 {amb}% — 더 묻지 않는다. 그리기 시작할 것."); return
        print(f"모호도 {amb}%. 아래를 묻는다 (가중치 큰 것부터, 한 번에 3~4개까지).\n")
        for w, key, name, ex, why in missing[:4]:
            print(f"■ {name}  (+{w}점)")
            print(f"   왜 필요한가: {why}")
            print(f"   보기: {ex}")
            print(f"   -> 선택지를 2~4개 제시하고 '기타'를 열어 둔다. "
                  f"열린 질문으로 던지면 사용자가 다시 모호하게 답한다.\n")
        rest = missing[4:]
        if rest:
            print("남은 슬롯(다음 차례): " + ", ".join(n for _, _, n, _, _ in rest))
        return

    if a.cmd == "brief":
        s = spec.get("slots", {})
        order = ["space_kind", "structure", "size", "objects", "placement",
                 "light", "color_tone", "contrast", "character_spot", "time_weather"]
        parts = [f"{dict((k, n) for k, _, n, _, _ in SLOTS)[k]}: {s[k]}"
                 for k in order if str(s.get(k, "")).strip()]
        print("다음 내용으로 그립니다 — 틀린 부분이 있으면 말씀해 주세요.\n")
        for p in parts:
            print(f"  · {p}")
        print(f"\n(모호도 {amb}%)")


if __name__ == "__main__":
    main()
