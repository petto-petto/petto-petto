---
name: pet-generator
description: "Generate and validate pixel-art pets with Pillow when creating a new pet species or evolution stage."
---

# Pixel Pet Creator (Pillow 버전)

`pixel-pet-creator`와 지키는 규칙은 완전히 같다 — 전역 고정 외곽선 `#2C2438`,
좌상단 광원, 등급·단계별 정량 예산, `assets/pets/{grade}/{slug}/stage{N}/` 폴더
구조. 다른 건 **그림을 캔버스에 옮기는 방법 하나뿐**이다: Piskel MCP 호출 대신
Pillow로 좌표를 직접 PNG에 찍는다.

이 스킬이 만드는 PNG는 Piskel판과 픽셀 단위로 동일하다(실측: 같은 그리드를
두 경로로 렌더링해 1024픽셀 diff 0 확인됨). 색이 legend의 hex 그대로 찍히는
연산이라 결과가 갈릴 이유가 없다 — 다만 이 스킬 자체는 이번에 새로 만들어져서
`pixel-pet-creator`만큼 실사용 이력이 쌓이지 않았다는 점은 감안할 것.

## 전제

- python3 + Pillow만 있으면 된다(`pip install pillow --break-system-packages`).
  **Piskel MCP는 필요 없다.**
- 스크립트는 전부 로컬(컨테이너/쉘)에서 실행된다. 기기 브릿지 왕복이 없어서
  Cowork처럼 쉘이 분리된 환경에서도 매 단계 기기를 오갈 필요가 없다 — 최종
  PNG를 사용자 프로젝트 폴더에 쓸 때만 기기 쪽 파일 쓰기가 필요하다.
- `pixel-pet-creator`(Piskel판)와 나란히 존재한다. 같은 이름의 종을 두 스킬로
  동시에 작업하지 않는다 — 한 종은 한 스킬로 끝까지 간다.

## 0. 먼저 확인할 것

`pixel-pet-creator`와 동일하다. `grade`/`petId`/`slug`/`stage`/`motion`은
추측하지 말고 물어본다.

- **등급** — `COMMON`/`RARE`/`EPIC`. 색 수·프레임 수·캔버스가 여기서 갈린다.
- **petId** — 3자리 zero-padded. "다음 번호로"라고 하면:
  ```bash
  find <프로젝트루트>/assets/pets -name 'pet_*' 2>/dev/null \
    | grep -o 'pet_[0-9]\{3\}' | sort -u | tail -1
  ```
- **slug** — 영문 소문자+숫자+언더스코어. 한국어 표시명은 별도로 받아 `pet.json`에.
- **stage** — 1~3 (Lv.1~9 / 10~19 / 20~29). 4단계 없음.
- **모션 범위** — 카드만인지 idle/click/attack까지인지.
- **모티브와 색** — 안 정해줬으면 제안하고 확인받는다.

**Stage 2·3을 만드는 경우**: `assets/pets/{grade}/{slug}/pet.json`을 먼저 읽고
`palette.body`를 그대로 쓴다. 이전 단계의 ASCII 그리드(.txt)가 남아있지 않으면
카드 PNG에서 복구한다(§4.5 참고).

이미 다 알려줬으면 묻지 말고 진행한다. 되물을 수 없으면 합리적으로 정하고
**무엇을 가정했는지 결과 보고에 명시**한다.

## 1. 등급 예산과 경로를 먼저 확정한다

```bash
python3 scripts/scaffold.py --root <프로젝트루트> \
  --grade epic --slug aurora_fox --petid 012 --stage 3 \
  --motions idle,click,attack --name 오로라폭스 \
  --body '#7FC8E8' --sub '#FFF3D6,#FF6B9D'
```

캔버스 크기, 색 상한, 프레임 수, `mkdir` 명령, export 경로, `pet.json` 내용이
한 번에 나온다. 등급별 화려함 차등은 `references/grades.md`를 읽는다.

| 스크립트 | 무엇을 | 언제 |
| --- | --- | --- |
| `grid.py` (플래그 없이도) | 등신·최대폭 위치·축 드리프트·장식 대칭 — 등급 무관 고정 규칙 | §3 |
| `grid.py --grade --stage --body` | 한 장의 장식량 | §3 |
| `palette.py verify` | 팔레트 정체 + 면적 비율 | §5 |
| `progression.py` | 단계 간 델타 | export 전 (§4.5) |
| `motion_check.py` | 프레임이 평행이동인지 | export 전 (§4.5) |
| `audit.py` | 폴더·파일명·png/json 짝·메타 정합성 | export 후 (§7) |

프레임을 **만드는** 쪽은 `motion_make.py`(§4). 만들고(make) 검사한다(check).
이 순서·기준은 `pixel-pet-creator`와 100% 동일하다.

## 2. 팔레트 확정

```bash
python3 scripts/palette.py derive --body '#7FC8E8' --sub '#FFF3D6' --grade epic
```

| 역할 | 값 |
| --- | --- |
| 외곽선 | `#2C2438` 전역 고정 |
| 몸통 메인색 | 종 단위 고정 |
| 몸통 그림자 | 몸통색 HSL 명도 x 0.80 |
| 하이라이트 | 몸통색 명도 x 1.15 (RARE·EPIC 필수) |
| 보조색 그림자 | 각 보조색 명도 x 0.80 |
| **보조색 하이라이트(림라이트)** | 각 보조색 명도 x 1.15 — **EPIC은 빠뜨리기 쉽다.** 몸통뿐 아니라 보조색에도 붙는다 |
| 액센트색 | RARE 1개 / EPIC 2개 — 몸통색과 색상환 90도 이상 |

## 3. ASCII 그리드로 실루엣을 먼저 짠다

```
[legend]
K = #2C2438
B = #7FC8E8
S = #42AEDD
H = #ADDCF0
C = #FFF3D6
A = #FF6B9D
[grid]
................................    <- '.'는 투명, 32x32 (48캔버스면 48x48)
...
```

배치·비율·눈·모티브 변환은 `references/anatomy.md`. 특히 §6 "구별 특징 하나를
과장한다."

```bash
python3 scripts/grid.py /tmp/pet_012_s3.txt --render
python3 scripts/grid.py /tmp/pet_012_s3.txt --grade epic --stage 2 --body '#7FC8E8'
```

`FIX`가 나오면 텍스트를 고치고 재실행 — 그릴 때(Pillow로 굽기 전)는 비용이 0이다.
등신(≤2.0)·최대폭 위치(≤0.35)·축 드리프트(≤1.0px)·장식 대칭(≥95%)은 플래그
없이도 항상 검사한다. **대칭축은 픽셀 경계(32px면 x=15.5)**라 중앙 장식은 짝수
폭이어야 한다 — 3px 블레이즈는 어디 놓아도 밀린다(`references/anatomy.md` §2.5).

### Stage 2·3은 이전 단계 그리드를 열어 놓고 짠다

새로 그리는 게 아니라 이전 단계에서 무엇을 바꿀지 정하는 작업이다. **새 부위를
실루엣 밖에 다는 것**(꼬리·뿔·날개)이 면적·복잡도·IoU를 한 번에 움직이는
가장 확실한 수단. 머리를 줄여 IoU를 떨어뜨리지 않는다 — `grid.py`가 막는다.

이전 단계 `.txt`가 사라졌다면(세션이 끊겼거나 파일을 안 남겼거나) 카드 PNG에서
복구한다:

```bash
python3 scripts/png_to_grid.py stage1/pet_012_s1_card.png \
  --legend-from assets/pets/epic/aurora_fox/pet.json --out /tmp/pet_012_s1.txt
```

`exact_match_rate`가 100%가 아니면 멈춘다 — 이 스킬이나 Piskel판이 만든 PNG가
아니거나(외부 편집), 팔레트에 몸통/보조색 하이라이트 유도가 실제 그림과 안
맞는 경우다. 후자면 `--legend`로 직접 문자=hex 매핑을 넘긴다.

## 4. Pillow로 렌더링한다

Piskel의 `create_project`/`draw_pixels`/`import_png`/`export_png` 전부가 이
한 호출로 끝난다.

```bash
python3 scripts/render_png.py /tmp/pet_012_s3.txt --out /tmp/pet_012_s3_card.png
```

모션은 카드가 통과한 뒤에 카드 그리드에서 파생시킨다. 프레임을 손으로 그리거나
통째로 밀지 않는다 — `motion_make.py`가 접지면 고정·스쿼시/스트레치·부위 지연을
계산한다.

```bash
python3 scripts/motion_make.py --grid /tmp/pet_012_s3.txt --motion attack \
  --anchor 3 --lag 24-30 --effect-at 8,26 --out-prefix /tmp/attack
```

`--anchor`(발 행 수) `--lag`(늦게 따라올 부위) `--effect-at`(이펙트 위치)는
캐릭터마다 판단한다. 프레임 구성은 `references/motions.md`.

**click2는 알려진 갭이다** — `motion_make.py`는 `idle`/`click`/`attack`만
지원하고 click2 전용 모드가 없다. 서로 다른 감정(놀람/기뻐서 폴짝)을 요구하는데,
지금은 `click`을 다른 `--anchor`/`--lag`/`--effect-at` 값으로 한 번 더 돌려
다른 포즈를 얻거나, 카드 그리드에서 표정을 직접 다시 그려야 한다. 필요하면
`motion_make.py`에 click2 모드를 추가하는 걸 별도로 검토할 것 — 이 스킬 범위
밖이라 임의로 손대지 않는다.

프레임이 여러 장이면 시트로 한 번에 굽는다:

```bash
python3 scripts/render_png.py /tmp/attack_f0.txt /tmp/attack_f1.txt \
  /tmp/attack_f2.txt /tmp/attack_f3.txt /tmp/attack_f4.txt /tmp/attack_f5.txt \
  --sheet /tmp/pet_012_s3_attack.png
```

`scale`은 항상 1(스크립트에 확대 옵션 자체가 없음).

## 4.5 단계 간 · 모션 검사 — export 전에 반드시

```bash
python3 scripts/progression.py /tmp/pet_012_s1.txt /tmp/pet_012_s2.txt \
        /tmp/pet_012_s3.txt --grade epic
python3 scripts/motion_check.py /tmp/attack_f*.txt --grade epic --motion attack
```

`motion_check.py`는 PNG 시트도 직접 읽는다 — Piskel판과 달리 이 시트는 이미
컨테이너 안에 있으므로 기기 쪽 쉘을 오갈 필요가 없다.

```bash
python3 scripts/motion_check.py /tmp/pet_012_s3_attack.png --grade epic --motion attack
```

**한 단계만 요청받았어도** 이전 단계 그리드가 있으면 델타 검사를 돌린다.

## 5. 검증 게이트 — 통과 전에는 최종 경로에 저장하지 않는다

Piskel판은 `get_used_colors`로 캔버스에 물어봐야 실제 색을 알 수 있었다. 여기선
**그리드 자체가 원본**이라 캔버스에 물어볼 필요가 없다 — `grid.py`를 플래그 없이
돌리면 이미 색상별 픽셀 수를 출력한다:

```bash
python3 scripts/grid.py /tmp/pet_012_s3.txt
#   S = #DB851C  104 px
#   B = #E8A24D  96 px
#   K = #2C2438  84 px
#   ...
```

이 줄들을 그대로 `--used` 형식으로 옮겨 검증한다:

```bash
python3 scripts/palette.py verify --grade epic --body '#7FC8E8' \
  --sub '#FFF3D6,#FF6B9D' \
  --used '#2C2438:84,#E8A24D:96,#DB851C:104,...'
```

`FAIL`이 나오면 — Piskel판처럼 `replace_color`를 부르는 대신 — **그리드 텍스트를
직접 고친다** (해당 문자를 다른 legend 문자로 바꾸거나 legend의 hex 자체를
수정). 그리고 1번으로 돌아가 `grid.py`를 다시 돌려 픽셀 수를 재확인한다.
텍스트 편집이라 Piskel의 `allFrames=true` 같은 별도 인자를 잊을 위험이 없다 —
같은 문자를 쓰는 모든 프레임 그리드에서 legend의 hex 한 줄만 고치면 전부
반영된다.

`RESULT: PASS`가 나온 뒤에야 §6의 최종 경로로 렌더링한다. 여러 단계를 만들었다면
`progression.py`·`motion_check.py`도 PASS여야 한다.

## 6. 저장 경로

```
assets/pets/{grade}/{slug}/pet.json
assets/pets/{grade}/{slug}/stage{N}/pet_{petId}_s{stage}_card.png
assets/pets/{grade}/{slug}/stage{N}/pet_{petId}_s{stage}_{motion}.png
assets/pets/{grade}/{slug}/stage{N}/pet_{petId}_s{stage}_{motion}.json
```

`render_png.py --out`/`--sheet`의 출력 경로를 바로 이 위치로 지정하면 별도
export 단계가 없다. `pet.json`은 종 폴더 루트에 하나, Stage 1을 만들 때 함께
생성한다. `.json` 메타(frameWidth/frameHeight/frameCount/columns/fps/loop)는
`references/motions.md` 형식 그대로 손으로 작성한다.

## 7. 최종 감사

```bash
python3 scripts/audit.py --root <프로젝트루트> --species epic/aurora_fox
```

폴더·파일명·png↔json 짝·메타 정합성·petId 유일성을 본다. 이 스크립트는 원래도
Piskel과 무관하게 Pillow로 PNG를 직접 읽는 순수 구조 검사라 그대로 재사용한다.
`FAIL`이 하나라도 나오면 고치고 다시 돌린다.

## 8. 결과 보고

```
pet_012 오로라폭스 / EPIC / Stage 3 / 여우 모티브 (Pillow 렌더)

파일  assets/pets/epic/aurora_fox/
  pet.json
  stage3/pet_012_s3_card.png       (48x48)
  stage3/pet_012_s3_idle.png       (4프레임, fps 6, loop) + .json
  stage3/pet_012_s3_attack.png     (6프레임, f2·f3 히트스톱) + .json

팔레트  몸통 #7FC8E8(종 고정) / 보조 #FFF3D6 / 액센트 #FF6B9D
       그림자 #42AEDD / 하이라이트 #ADDCF0

검증  grid.py PASS / palette.py verify PASS / progression PASS / motion_check PASS
      audit.py --policy full → PASS

참고  Piskel 미사용, Pillow 직접 렌더. click2는 미생성(§4의 알려진 갭).
```

## 안 하는 것

- 이미 있는 에셋의 부분 수정 — 그건 `pixel-pet-editor`.
- 전역 고정 팔레트 변경.
- 등급 예산 초과, `budget.py` 숫자 하향 조정.
- 확대본 저장, 32/48 외의 캔버스, Stage 4.
- `motion_make.py`의 click2 모드 부재를 이 스킬 선에서 임의로 땜질하는 것 — 필요하면 별도로 알리고 스크립트 자체를 고칠지 확인받는다.
