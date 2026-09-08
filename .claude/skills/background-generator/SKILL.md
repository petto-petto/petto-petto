---
name: background-generator
description: "Generate, score, and export layered pixel-art game backgrounds when creating or revising a scene backdrop."
---

# Background Generator

배경 한 장을 `sky / far / mid / near` 4레이어로 굽는다. 그림은 손으로 찍지 않는다 —
`scene.json`(프리미티브 + 스탬프)을 쓰고 Pillow가 렌더한다. 색은 항상 프리셋 램프
참조(`mid.2`)로 쓴다. 프리셋만 바꾸면 같은 구도가 다른 분위기로 다시 구워진다.

## Pillow dependency gate

이 스킬의 모든 절차보다 먼저 실행한다.

```bash
python3 -c 'import PIL'
```

실패하면 즉시 중단한다. **Pillow is required. Do not run any script, render, verify, or install Pillow.** Pillow가 준비되기 전에는 이 스킬을 사용할 수 없다고 보고한다.

## 전제 — 협상 대상이 아닌 것

- **카메라는 사이드뷰 + 바닥 깊이 고정.** 소실점 없음. 깊이는 여섯 단서로 만들고
  `bg_check.py`가 실측한다.
- **성공 기준은 전부 숫자다.** 지표·기준값·측정법·깊이 단서 목록은
  `references/quality.md`가 소유한다. 그리기 전에 한 번 읽는다.
- **캔버스는 가변.** 기본 280x120, `--size WxH`, 최소 96x64. 구도 상수와 절대 px
  게이트는 높이에 비례해 스케일된다.
- **펫 가독성은 게이트가 아니다.** 발광은 게임 쪽 몫이고 `petAnchor`는 좌표만 남긴다.
- 캐릭터 스킬(`pixel-pet-creator`)과 공유하는 전제: 광원은 **좌상단** 고정 ·
  `#2C2438`은 **캐릭터 외곽선 전용 예약색**(배경에서 3% 이하) · 펫 캔버스 32x32.

## 0. 인터뷰 — 모호도 20% 이하까지 (건너뛰지 않는다)

"서재 같은 분위기" 다섯 글자에서 소파·난로·담요를 지어내지 않는다. 구체성을
**수치로** 재고, 부족하면 묻는다.

```bash
python3 scripts/bg_interview.py template > /tmp/spec.json
# 요청에서 읽어낸 것을 채운다 (추측한 건 assumed 에)
python3 scripts/bg_interview.py score /tmp/spec.json   # 모호도 %
python3 scripts/bg_interview.py next  /tmp/spec.json   # 다음에 물을 것
python3 scripts/bg_interview.py brief /tmp/spec.json   # 20% 이하가 되면
```

- **모호도 > 20%면 그리지 않는다.** 차단 슬롯이 비어 있으면 모호도와 무관하게 계속
  묻는다 — 뒤늦게 나오면 전부 다시 굽는 요구들이다(`score`가 판정한다).
- 브리프를 만들어 **그리기 전에 한 번 보여주고** 시작한다.
- 물을 수 없으면(무인 실행) 기본값으로 채우고 `assumed`에 적어 결과 보고에 밝힌다.
- 슬롯표·가중치·**어떻게 묻나**(한 번에 몇 개, 선택지 주기, 추론할 수 있는 건 안 묻기)
  는 `references/interview.md`.

분위기가 비어 있으면 `bg_palette.py list`의 프리셋·키워드 중 셋 정도를 선택지로
제시한다. **"~~같은 분위기로"가 이미 있으면 묻지 말고 진행하고**, 무엇으로
해석했는지 결과 보고에 한 줄 적는다. §2의 스캐폴드 인자(id/slug·크기·`--seamless`·
펫 자리)도 여기서 같이 정한다.

### 레퍼런스가 있으면 — 먼저 열어 본다

받았거나 프로젝트에 있으면 **실제로 열어 본다.** 표면만 따라가면("숲이니까 나무")
공간 구조가 통째로 빠진다. 볼 다섯 축과 `elements.json` 형식은
`references/reference_analysis.md`, 실물 예시는 `references/example_elements.json`.
**핵심 요소는 5개 이상 뽑는다.** 무엇을 가져오고 무엇을 새로 구성하는지(재해석
원칙)도 같은 문서에 있다 — 레퍼런스는 참고 대상이지 복제 대상이 아니다.

## 1. 프리셋을 고른다

```bash
python3 scripts/bg_palette.py list                 # 프리셋 · layout · 분위기 키워드
python3 scripts/bg_palette.py show --preset forest # 램프 40색 + accent 대비 진단
```

- **`layout`이 구도를 정한다.** `ground`는 지평선과 지면 밴드가 있는 수평 구도,
  `canopy`는 지평선 없는 다층 수직 구도. 세로형/다층형 레퍼런스에 `ground`를 고르면
  재생성 트리거에 걸린다.
- 램프는 `sky far mid near wood leaf accent light` 8종 × 5단(0=어두움 → 4=밝음).
  역할명이 프리셋 공통이라 스탬프가 프리셋을 가리지 않는다.
- **한 장면 안에서 온도를 대비시킬 때는 `accent` 램프 하나만 반대 온도로 잡는다** —
  나머지 7램프가 한 온도여야 대비를 주는 오브젝트(창·얼음·촛불)가 뜬다. 그 팔레트로
  대비가 가능한지는 `show`의 accent 대비 진단이 미리 알려 준다.

### 맞는 프리셋이 없으면 — 지어내지 말고 만든다

hex 40개를 손으로 쓰지 않는다. 램프 간 중복과 명도 역전이 생긴다.

```bash
# 새로 뽑는다
python3 scripts/bg_preset_new.py --name snowy_pines \
    --mood "눈,설원,침엽수림,겨울,차가운" --label "눈 덮인 침엽수림" --write

# 기존 것을 태워 파생한다 (밤 버전·더 어두운 톤)
python3 scripts/bg_preset_new.py --name forest_night --from forest --burn 0.55 --write
```

레퍼런스 이미지에서 뽑을 수도 있다 — `bg_palette.py from-image <이미지> --k 12
--name <이름>`. 다만 **역할 배정(무엇이 sky이고 무엇이 near인지)은 사람이 확인한다.**
확인 후 `references/presets.json`에 붙이고 `kind`를 채운다.

- 명도는 주제가 아니라 **구조**가 정한다 — 앵커 명도를 사다리로 강제하고 지면(wood)
  램프를 가장 어두운 층에 둔다. 예측이 FAIL이면 `--anchors`나 `--terrain`으로 다시
  뽑는다. 파생의 함정과 처방은 `references/color.md`.
- **중경 잎덩어리는 지형과 무관하게 깔린다.** 동굴·화산이면 그 매스를 암벽으로
  바꾸는 손질을 따로 한다 — 알려진 한계.

## 2. scene.json 초안을 받는다

```bash
python3 scripts/bg_scaffold.py --preset forest --id bg_004 --slug misty_grove \
    --name "안개 숲" --size 280x120 --root <프로젝트루트> > /tmp/bg_004.json
```

- 빈 파일에서 시작하지 않는다. `--size`를 바꾸면 수평선·수목선·기둥 폭·스탬프 배율·
  뿌리는 개수가 전부 따라 움직인다. stderr로 저장 경로와 다음 명령이 나온다.
- **큰 캔버스에 스탬프를 원래 크기로 두지 않는다** — 구조적 엣지가 절반으로 떨어진다.
  고해상도 변형이 있는데 작은 쪽을 확대해 쓰면 `bg_check.py`가 잡는다.
- `--root`를 주면 id 중복을 막는다. 겹치면 런타임 메타 파일명(`{id}.json`)까지 겹쳐
  두 배경이 서로를 가린다.

## 3. scene.json을 요청에 맞게 고친다

씬의 형태는 §2의 초안이 이미 갖고 있다. ops는 **레이어 안에서 쓴 순서대로** 덮이고,
레이어는 z 순서대로 합성된다.

읽을 곳 — 전부 `references/` 아래에 있다.

- `quality.md` 정량 성공 기준과 그 출처 · `gate_conflicts.md` 게이트끼리 충돌할 때
- `troubleshooting.md` 증상 → 원인 → 처방 (전봇대·브로콜리·슬래브 등)
- `ops.md` op 목록과 인자 · `stamps.md` 스탬프와 새로 만드는 법
- `composition.md` 구도·레이어 배분·펫 자리 · `color.md` 색상·명도·accent 대비·파생
- `layers.md` 레이어 메타·패럴랙스·애니메이션 소비 규약
- `interview.md` 인터뷰 슬롯 · `reference_analysis.md` 레퍼런스 분석 ·
  `visual_review.md` 시각 검수와 컴포넌트 격리 검수

## 4. 렌더한다

```bash
python3 scripts/bg_render.py /tmp/bg_004.json \
    --out-dir <프로젝트루트>/apps/desktop/renderer/assets/backgrounds/bg_004_misty_grove \
    --preview /tmp/bg_004_prev.png --scale 3
```

`--preview`는 검수용이다. 확대본을 에셋으로 저장하지 않는다 — 최종 에셋은 언제나 1배다.

### 움직임이 있으면 프레임을 굽는다

인터뷰의 '움직이는 요소' 슬롯이 채워져 있으면 정적 렌더로 끝나지 않는다. 움직일 op에
`"animate": true` 를 붙인 뒤:

```bash
python3 scripts/bg_animate.py <out-dir> --frames 12 --fps 6
```

움직인다고 선언된 op만 위상을 바꿔 다시 굽고, 그 op이 사는 레이어의 PNG만
`frames/`에 모아 런타임 메타에 `animation` 블록을 쓴다. **선언은 한 레이어로 모은다**
— 런타임은 한 레이어만 교체한다. 움직일 수 있는 op은 `specks`와 `glow`, 소비 규약은
`references/layers.md`.

## 5. 게이트 — 세 스크립트를 순서대로, 전부 통과해야 한다

각 스크립트가 항목명과 실측값을 함께 출력한다. 기준값을 여기 옮겨 적지 않는다.

```bash
python3 scripts/bg_check.py <out-dir>            # 망치지 않았는가 (--verbose 로 매스까지)
python3 scripts/bg_elements.py template --structure vertical > /tmp/elements.json
python3 scripts/bg_score.py <out-dir> --elements /tmp/elements.json [--prev <이전>]
python3 scripts/bg_final.py <out-dir> --elements /tmp/elements.json --visual /tmp/visual.json
```

- `bg_check.py` — 평탄함·명암·투시·구조·위생. **FAIL이면 scene.json을 고치고 다시
  렌더한다.** `LIMITS` 숫자를 낮춰 통과시키지 않는다.
- `bg_score.py` — **"요구한 것을 실제로 만들었는가."** 미달이거나 재생성 트리거가
  하나라도 걸리면 부분 수정 금지, 공간 구조부터 새로 구성한다. 쓸 수 있는 op과
  용도는 `bg_elements.py ops`.
- `bg_final.py` — 최종 다섯 조건. `--help`가 조건과 `--mode edit`의 용도를 설명한다.
- **두 지표가 서로 반대로 움직이면 번갈아 땜질하지 않는다** — `gate_conflicts.md`의
  규칙으로 푼다. 기준 자체를 바꿔야 하면 `quality.md` §0으로 실측을 다시 한다.

**레퍼런스가 없는 요청에도 `elements.json`을 쓴다** — 사용자가 말한 것을 요소로 옮겨
적어야 "말한 걸 실제로 만들었는가"를 셀 수 있다. 최상단이 아니라 `refs/`에 넣는다(§7).

## 6. 사용자 확인 루프 — 미학 판단은 사용자가 한다

**게이트가 PASS하면 즉시 합성본을 보여주고 판단을 받는다.** 자체 판단으로 "더 예뻐
보이게" 고치는 바퀴를 돌지 않는다 — 시간만 늘고 결과는 사용자 기준과 멀어진다.

- **내가 고치는 것(결함)** — 묻지 않고 바로 고친다: `bg_check.py` FAIL ·
  `bg_score.py` 미달이나 재생성 트리거 · `troubleshooting.md`에 **이름이 있는 증상**.
- **사용자가 정하는 것(취향)** — 반드시 묻는다: 밝기·채도·온도 · 오브젝트 크기·개수·
  배치 · 특정 요소가 의도대로 읽히는지 · 무엇을 더 넣고 뺄지.

제시할 때는 세 줄로 쓴다 — **무엇을 넣었는지 / 게이트 결과 / 어디가 마음에 안 드는지
물어보기.** 고칠지 말지 애매한 것은 고치지 말고 그 줄에 적어 함께 묻는다.

컴포넌트 하나가 부족하다는 지적에는 배경 전체를 다시 굽지 않고 **그것만 격리해서
검수받는다.** 사용자에게 물을 수 없을 때만 `bg_visual.py`로 자기 채점하며, 그때도
시트를 **실제로 열어 보고** 채운다. 둘 다 `references/visual_review.md`.

## 7. 저장 경로

**Electron 런타임 에셋은 반드시 `apps/desktop/renderer/assets/backgrounds/`에 저장한다**
— 루트의 `assets/backgrounds/`는 쓰지 않는다. `--out-dir`을 이 경로로 주면 별도
export 단계가 없다.

```
apps/desktop/renderer/assets/backgrounds/{id}_{slug}/
  scene.json          # 소스 스펙 — 나중 수정은 여기서 시작한다. 반드시 남긴다
  refs/elements.json  # 요소 목록
  {id}.json  {id}_composite.png  {id}_{sky,far,mid,near}.png   # bg_render.py 산출
  frames/{layer}_00.png ...                                    # bg_animate.py 산출
```

### 작업 도구는 임시 디렉터리가 아니라 리포에 둔다

실험대·프레임 생성기처럼 **재생성에 필요한 스크립트**는 `tools/`에 만든다. `/tmp`나
세션 스크래치패드에 두면 잃는다 — 작업 중 시스템이 스크래치패드를 비워 실험대
코드가 통째로 날아갔다. 그 도구는 **`scene.json`만 입력으로 받게 짠다.** 별도 빌더에
의존하면 빌더가 사라졌을 때 재생성이 막힌다. 씬이 단일 출처다.

## 8. 이미 있는 배경을 고칠 때

PNG를 건드리지 않는다. `scene.json`을 고치고 같은 `--out-dir`로 다시 렌더한다. 색만
바꾸는 요청이면 `preset` 한 줄만 바꾸되, 교체 후 램프 인덱스가 새 팔레트에서도
분리되는지 `bg_check.py`로 본다 — 밝은 프리셋에서 `far.1`은 하늘과 명도가 겹친다.

## 9. 결과 보고 — 네 부분

1. **장면 브리프** — 모호도 %, 확정한 슬롯, 추측으로 채운 것
2. **레퍼런스 분석 요약** — 다섯 축 (레퍼런스가 있었을 때)
3. **게이트 결과** — `bg_check` / `bg_score` / `bg_final` 출력을 그대로 옮긴다
4. **합성 PNG를 붙이고 지적 요청** — 무인 실행이면 `bg_visual` 내역과 재생성 프롬프트

분위기나 크기를 스스로 해석했으면 그 줄을 반드시 넣고, **"수치는 통과했지만 그림이
미달"인 경우를 PASS로 보고하지 않는다.**

## 안 하는 것

- 펫(캐릭터) 스프라이트 생성·수정 — `pixel-pet-creator` / `pixel-pet-editor`.
- 난수 1px을 뿌려 "질감"을 내기 — `foliage`/`panel`/`ground_plane`을 쓴다.
- `presets.json`의 기존 프리셋 색을 조용히 바꾸기. 새 분위기는 **새 프리셋 키**로 추가한다.
