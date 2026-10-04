# 픽셀화 배경 파이프라인

AI가 만든 이미지를 **진짜 도트 규격**으로 옮기고, 거기서 계절 × 시간대 변형을
파생한다. 프리미티브 렌더러(`.claude/skills/background-generator`)를 대체하지
않는다 — 구도를 사람이 프리미티브로 짜는 대신 생성 이미지에서 가져오는 경로다.

## 왜 이 경로인가

`bg_004_rain_alley`는 모든 게이트를 통과하고도 품질 판정에서 떨어졌고,
구성 확인용으로 만든 blockout Skill은 "프리미티브로 좋은 씬을 손으로 짜는 것"
자체가 병목이라 폐기됐다. 병목은 검증이 아니라 **구성**이고, 확산 모델이 제일
잘하는 게 그 구성이다.

다만 생성 이미지를 그대로 쓰면 도트가 아니다. 실측:

|                | 색 수  | 중간톤   | 고립픽셀 |
| -------------- | ------ | -------- | -------- |
| PixelOE 원본   | 40,113 | 77.7%    | 25.7%    |
| 팔레트 강제 후 | **22** | **0.0%** | **1.3%** |

**팔레트 강제는 선택이 아니라 필수 단계다.** 이걸 거쳐야 도트가 되고, 펫
스프라이트와 색이 맞고, 시간대 파생이 가능해진다.

## 흐름

```
 AI 이미지 ──(1) 픽셀화──> ──(2) 팔레트 강제──> ──(3) 램프 배정──> ──(4) 시간대 파생──> 16장
  계절마다                   repalette.py        assign_ramps.py     matrix.py
  따로 준비                                                          phase_grade.py
```

### (0) 계절 원본 4장 — 여기서 구도를 맞춰야 한다

**계절은 색 변환으로 안 된다.** 겨울에 잎을 지우는 것은 시도했고 실패했다.
잎인 픽셀은 역할 배정으로 정확히 골라낼 수 있지만 **잎 뒤에 가지가 없다** —
원본이 잎 달린 상태로 만들어졌으니 지우면 구멍이다.

그래서 계절마다 원본이 필요하고, 네 장이 **같은 장소로 보여야 한다.** 나무
위치와 돌담이 계절마다 다르면 사계절이 아니라 다른 숲 네 개다.

`control/` 에 구조 조건을 넣어 뒀다:

| 파일                | 용도                                            |
| ------------------- | ----------------------------------------------- |
| `summer_source.png` | 2752×1376, 2:1 크롭된 기준 이미지. img2img 입력 |
| `canny.png`         | 엣지맵 (threshold 100/200). 구조를 강하게 고정  |
| `canny_soft.png`    | 엣지맵 (50/150). 잎 형태가 바뀔 여지를 준다     |

ControlNet(canny 또는 depth)에 이걸 조건으로 물리고 계절 프롬프트로 재생성하면
나무 위치가 유지된다. 겨울처럼 **구조가 크게 달라져야 하는 계절은
`canny_soft` 쪽**이 낫다 — 강한 조건은 잎을 그대로 유지시킨다.

결과를 `in/{계절}.png` 로 둔다.

### (1)(2) 픽셀화와 팔레트 강제 — `repalette.py`

PixelOE는 별도 환경이 필요하다(torch, opencv). 프로젝트 venv에는 넣지 않았다.

```bash
uv venv --python 3.11 /tmp/pxenv
VIRTUAL_ENV=/tmp/pxenv uv pip install pixeloe pillow numpy opencv-python

/tmp/pxenv/bin/python -c "
from pixeloe.legacy.pixelize import pixelize
import cv2
img = cv2.imread('control/summer_source.png')
# target_size 는 변의 길이가 아니라 면적 기준 — sqrt(1080*540)=764
out = pixelize(img, mode='contrast', target_size=764, patch_size=8,
               thickness=2, colors=36, no_upscale=True)
cv2.imwrite('/tmp/px.png', out)"

/tmp/pxenv/bin/python repalette.py /tmp/px.png in/summer.png --no-accent --clean 6
```

**알려진 함정 두 가지.**

`pixelize()` 의 `colors` 는 최종 색 수를 보장하지 않는다. 양자화 직후
`match_color(img_sm_c, img_sm, 3)` 가 원본 색을 다시 입히기 때문이고, 이건
`color_matching=False` 로도 안 꺼진다(`if colors is not None:` 블록 안에 있다).
그래서 팔레트 강제는 `repalette.py` 가 따로 한다.

`patch_size` 는 4 미만이면 터진다 — `outline.py` 가 `(k // 4) * 2` 를 stride 로
넘기는데 k<4 에서 0 이 되어 im2col 이 거부한다.

### (3) 램프 배정 — `assign_ramps.py`

시간대 변환의 전제다. 색을 명도로만 다루면 하늘의 밝은 시안과 잎의 밝은 녹색이
같은 방향으로 밀리는데, 노을에서 이 둘은 **반대로** 가야 한다.

```bash
python3 assign_ramps.py in/summer.png -o ramps/summer.json
```

색상·채도·평균 수직위치로 초안을 내고 확신이 낮은 색에 `?` 를 붙인다. 22색 중
21색이 수동 배정과 일치했고, 어긋난 하나(`#7BC6AE`, 채도 0.40 대 경계 0.42)는
`?` 로 잡혔다. **`?` 가 붙은 색은 열어서 확인할 것** — 램프 하나가 틀리면 그
색이 모든 시간대에서 엉뚱하게 움직인다.

### (4) 시간대 파생 — `matrix.py` / `phase_grade.py`

```bash
python3 matrix.py            # in/*.png 전부, 계절당 4장
python3 phase_grade.py in/summer.png -r ramps/summer.json -o out --prefix summer
```

22색짜리 도트는 **인덱스 + 팔레트**다. 인덱스를 한 번 만들고 `putpalette` 만
네 번 부르므로 583,200 픽셀을 네 번 훑지 않는다 — 4장에 0.17초. 최적화이기
이전에 **런타임이 쓸 수 있는 형태**다. 게임이 시간대를 바꿀 때도 같은 일을 하면
된다.

`PHASES` 의 값을 조정할 때 두 가지를 기억할 것.

- `pull` 은 색상환에서 얼마나 끌지다. 시안(H194)에서 주황(H16)처럼 거의
  정반대면 **1.0 에 가까워야 한다.** 0.72 로 끌었더니 중간인 연두에서 멈췄다.
- 갈색(H26)에서 남색(H223)은 짧은 쪽이 자홍을 지난다. 조금만 끌어도 줄기가
  자주색이 되므로 `night` 의 `wood` 는 `hue=None` 으로 명도만 만진다.

## 런타임 연결

`packages/pet-room/src/domain/scene.ts` 에 시각 → 배경 선택 루프가 이미 있다.

```ts
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;
export function phaseAt(at: Date): BackgroundPhase { ... }
```

`BackgroundPhase` 는 현재 `'day' | 'night'` 2단계다. 여기에 `'dawn'` 과
`'dusk'` 를 더하고 경계 시각을 정하면 된다. `apps/desktop/src/main/room.ts:161`
이 주기적으로 `backgroundAt(clock.now())` 를 다시 묻고 바뀌면 교체한다.

## 한계

- **계절은 원본이 필요하다.** 위 (0) 참조.
- **게이트를 그대로 통과하지 못한다.** `bg_check.py` 기준 색 수 하한 24와
  구조적 엣지 하한 15% 에 걸린다(22색 / 11.8%). 두 하한 모두 프리미티브
  산출물이 도달 가능한 수준에 맞춰 잡힌 값이라, 이 경로에 그대로 적용할지는
  판단이 필요하다.
- **엣지 밀도는 디더 한 줄로 살 수 있다.** Bayer 디더를 얹으면 11.8% → 61.2%
  로 뛰는데 디테일이 아니라 체커다. `bg_004` 의 1픽셀 `rays` 가 명도 구간을
  샀던 것과 같은 구멍이다. (`bg_check.py` 독스트링은 "3x3 mode 2회"라고 적지만
  코드는 1회만 부른다 — 2회였다면 체커가 지워졌을 수 있다.)
- **레이어 분리와 애니메이션은 아직 없다.** 현재 산출물은 합성본 한 장이라
  `sky/far/mid/near` parallax 와 반딧불이 프레임을 쓰지 못한다.
