# scene.json op 레퍼런스

모든 `color`는 `"#RRGGBB"` 리터럴 또는 **램프 참조** `"ramp.i"`(예: `"mid.2"`)를
받는다. 램프 참조를 쓰면 프리셋만 바꿔서 같은 구도를 다시 구울 수 있다 —
리터럴 hex는 프리셋 교체를 깨뜨리므로 꼭 필요할 때만 쓴다.

ops는 레이어 안에서 **쓴 순서대로** 덮인다.

## op 에 새 파라미터를 opt-in 으로 넣을 때

**꺼진 경로는 난수를 한 번도 더 쓰면 안 된다.** 난수 소비 순서나 횟수가 달라지면
같은 seed 로도 배치가 통째로 바뀐다 — 새 기능을 켜지 않은 레이어까지 움직인다.

실제로 겪었다. `foliage` 에 수관 모드를 넣으면서 꺼진 경로가 위상값 두 개를 더
뽑았더니, 손대지 않은 원경 잎덩어리의 로브 배치가 전부 바뀌었다. 그 여파로 하늘
조각 모양이 달라져 광원 게이트가 깨졌고, 원인을 찾는 데 여러 바퀴가 들었다.

```python
k3 = rnd.uniform(0, 6.3) if organic else 0.0   # 켜졌을 때만 뽑는다
```

기존 동작과 새 동작이 **같은 seed 로 같은 그림**을 내는지 확인하고 넘어간다.

## 면 채우기

| op | 인자 | 용도 |
| --- | --- | --- |
| `fill` | `color` | 레이어 전체 채우기 |
| `rect` | `x y w h color` | 기둥·벽·띠 |
| `vgradient` | `ramp from to y0 y1` \| `box`, `dither`(기본 true) | 하늘·안개. 램프의 `from`단 → `to`단을 행 비율로 보간, 경계는 bayer 4x4 |
| `band` | `y h color` \| `top` `topH` `speckle{color,density,seed}` | 지면 밴드. `top`은 상단 엣지(잔디선) |
| `tile` | `name box` \| `stagger` `shade` | 스탬프를 box에 반복(벽널·마루). `stagger`는 줄마다 밀 픽셀 수 |

## 실루엣

| op | 인자 | 용도 |
| --- | --- | --- |
| `hills` / `canopy` | `base amp period phase` \| `harmonic seed from`(`bottom`\|`top`) `to` `color` `edge` `edgeH` | 사인 능선. **먼 지형용** — 주기가 짧으면 톱니가 된다 |
| `fringe` | `base r spacing` \| `jitter seed from to color edge edgeH` | 겹친 반원 로브. **가까운 잎더미·수목선·덤불선용** |

`edge`는 실루엣 상단(`from:"bottom"`) 또는 하단(`from:"top"`) `edgeH`행에 칠하는
밝은 엣지다. 광원이 좌상단이라 위쪽 엣지가 밝아야 한다.

## 스탬프

| op | 인자 | 용도 |
| --- | --- | --- |
| `stamp` | `name x y` \| `anchor`(`bottom`\|`top`) `align`(`left`\|`center`) `flip` `shade` | 한 장 배치 |
| `scatter` | `name xs y` \| `anchor align shade flipAlt` | 같은 스탬프를 여러 x에 |

`shade`는 스탬프 legend의 램프 인덱스를 통째로 밀어 같은 그림을 밝게/어둡게
만든다(`+2` = 원경용, `-1` = 전경용). **색을 새로 늘리지 않고 깊이를 만드는
가장 싼 수단**이다.

## 디테일·분위기

| op | 인자 | 용도 |
| --- | --- | --- |
| `clouds` | `blobs[[cx,cy,rw,rh]] color` \| `shade` | 뭉게구름(타원 + 아랫면 그림자) |
| `specks` | `box count color` \| `seed` | 잎·반딧불·먼지 |
| `rays` | `xs color` \| `y0 y1 slope width strength` | 좌상단 광원의 사선 광선. `strength`는 디더 비율 |
| `scanshade` | `box color` \| `every` | 가로 줄 음영 — 평평한 면에 결 |
| `vignette` | `color` \| `edge strength` | 가장자리 어둡게. 실내에서 오버레이 경계 정리 |

## 예시

```json
{"op": "vgradient", "ramp": "sky", "from": 4, "to": 1, "y0": 0, "y1": 120}
{"op": "fringe", "from": "top", "base": 6, "r": 7, "spacing": 10, "jitter": 3,
 "seed": 2, "color": "far.1", "edge": "far.3", "edgeH": 2}
{"op": "fringe", "from": "bottom", "base": 76, "r": 9, "spacing": 13, "jitter": 3,
 "seed": 4, "to": 120, "color": "mid.1", "edge": "mid.3", "edgeH": 2}
{"op": "band", "y": 94, "h": 26, "color": "near.2", "top": "leaf.2", "topH": 2,
 "speckle": {"color": "near.1", "density": 0.03, "seed": 3}}
{"op": "scatter", "name": "grass_tuft", "y": 98, "xs": [12, 40, 68, 100, 182, 214]}
{"op": "stamp", "name": "tree_round", "x": 34, "y": 94, "align": "center", "shade": 1}
```

전체 예시는 `example_scene.json`(bg_scaffold.py의 forest 초안, 게이트 PASS).

---

## 구조·깊이 op (여기부터가 "평평하지 않게" 만드는 도구다)

단색 큰 면 + 난수 1px 점은 질감이 아니라 노이즈다. 아래 op들이 실제로 구조를
만든다. `quality.md`의 구조적 엣지·매스 3톤·깊이 단서 게이트는 전부 이것들로
통과시킨다.

| op | 인자 | 무엇을 만드나 |
| --- | --- | --- |
| `foliage` | `box ramp base rim shadow` \| `r[min,max] spacing rimW depthRange depthTone seed fillBelow avoid` · 수관 모드 `crest crestFreq litSpan litClumps twigs` | **겹친 잎 로브 덩어리.** 로브마다 좌상단 림라이트 + 우하단 그림자. 실루엣만 따는 `fringe`와 달리 매스 **안쪽**에 형태가 생긴다 |
| `panel` | `box ramp base seam light boardH` \| `jointEvery vary grain grainShift seed` | **널판 면.** 이음매(어두움) + 반사광(밝음) + 세로 조인트. 벽·징두리·마루 |
| `ground_plane` | `y h ramp far near` \| `cell[far,near] furrow0 furrowShift furrowStrength markShift edge edgeH seed` · 바닥 디테일 `patches pebbles pebbleMax debris` | **물러나는 지면.** 행마다 톤·셀 폭·결 간격이 같이 변한다. 깊이 단서 5번(지면 압축)을 만드는 유일한 op. 잔디선은 너덜하게 흔들리고 풀 포기가 선다 |
| `scatter_depth` | `name y0 y1 count` \| `x0 x1 scale[far,near] shade[far,near] avoid seed` | **깊이 띠 배치.** 크기·톤·겹침 세 단서를 한 번에 만든다. y 순으로 그려 앞이 뒤를 가린다 |
| `autoshade` | `depth highlight shadow` \| `only box` | 레이어에 **이미 그려진** 덩어리의 위/왼쪽 경계에 한 단 밝은 톤, 아래/오른쪽에 한 단 어두운 톤. 레이어 ops의 **마지막**에 둔다 |
| `contact_shadow` | `x y w` \| `h color strength` | 접지 그림자. 깊이 단서 6번 |
| `glow` | `x y color` \| `rx ry strength gamma` | 디더 감쇠 광원. 램프 불빛·창으로 드는 빛 |
| `clearing` | `x y color` \| `rx ry core ring` | 저대비 구역(빈터·빛 웅덩이). 코어 / 한 단 어두운 링 / 디더 가장자리 3단. **기본 초안에서는 안 쓴다** — 펫 가독성 게이트를 뺐기 때문(`quality.md` §6) |
| `texture` | `box color` \| `marks(grain\|leaf\|brick\|dot) density seed` | 2~3px 조각 디테일. **density 0.03 이하**로 쓴다. 이걸로 큰 면을 채우려 하지 말 것 |

`stamp` / `scatter`는 `scale`(정수 확대)을 받는다. 같은 스탬프를 다른 `scale`로
쓰면 깊이 단서 4번(크기 기울기)이 성립한다.

**캔버스가 커지면 `scale`도 같이 올린다.** 안 올리면 요소가 상대적으로 작아져
구조적 엣지가 절반으로 떨어진다(실측: 280x120에서 23.6% → 요소 그대로 560x240에서
12.2%). `bg_scaffold.py`는 `bgcore.geom()["stamp"]`로 자동 계산한다.

### 수관 모드 — `crest`를 주면 켜진다

기본 `foliage`는 로브마다 제 몫의 림라이트를 갖는다. 그게 **브로콜리**로 읽히는
원인이다 — 실제 수관은 광원이 하나라 빛을 받는 쪽 로브만 밝고 안쪽은 그늘에 잠긴다.
`crest`를 주면 셋이 같이 켜진다.

| 파라미터 | 하는 일 |
| --- | --- |
| `crest` (0~0.4) | 윗변 울렁임. 격자 커버리지는 그대로라 구멍이 뚫리지 않는다 |
| `crestFreq` | 울렁임의 주기 |
| `litSpan` (기본 0.45) | 이 값보다 밝은 자리의 로브만 림라이트를 받는다 |
| `litClumps` (기본 3.2) | 상자 폭당 밝은 뭉치 수. 직선 기울기가 아니라 잡음장이다 |
| `twigs` | 덩어리 위로 삐져나온 마른 잔가지 |

**원경 잎덩어리에는 주지 않는다.** 원경의 윗변이 곧 하늘의 아랫경계다 —
`gate_conflicts.md` 6번.

### 잎은 `fringe`가 아니라 `foliage`

`hills`(사인)는 먼 능선용이다. 주기를 짧게 잡으면 픽셀 단위에서 톱니가 된다.
`fringe`(겹친 반원)는 유기적인 **경계선**을 만들지만 안쪽은 여전히 단색이다.
가까운 잎더미는 `foliage`로 그려야 매스 3톤·구조적 엣지 게이트를 넘는다.
셋을 같이 쓰면 좋다: `fringe`로 실루엣 라인을 잡고 그 위에 `foliage`를 얹는다.

### 지면 바닥 디테일

| 파라미터 | 하는 일 |
| --- | --- |
| `patches` | 흙 얼룩. 셀 폭에 비례한 작은 타원을 많이 뿌린다 |
| `pebbles` · `pebbleMax` | 자갈. 위는 작고 아래로 갈수록 커진다(크기 기울기) |
| `debris` | 잔가지 부스러기 |

**전부 지면 위쪽 2/3에만 놓인다.** 아래를 촘촘하게 하면 지면 압축 판정이 뒤집힌다
(`gate_conflicts.md` §3). 자갈은 **지면과 같은 램프**의 다른 단을 쓴다 — 다른 램프를
쓰면 흙바닥에 청록 보석이 박힌다.

### autoshade는 만능이 아니다

`autoshade`는 **램프가 바뀌는 경계**에서만 동작한다. 이미 손으로 3톤을 넣은
스탬프(대부분의 stamps/)에는 효과가 없고(이미 최상단/최하단 단이라 clamp),
`foliage`처럼 자체 림라이트가 있는 op에도 크게 더하지 않는다. 진짜 쓸모는
`rect`/`fill`/`fringe`로 만든 **밋밋한 매스의 실루엣 테두리**를 살리는 것이다.


---

## 다층 수직 구도 op (canopy 레이아웃)

지평선이 없는 정글·수직 탐험 구도의 뼈대다. `ground` 레이아웃에서도 쓸 수 있다.

| op | 인자 | 무엇을 만드나 |
| --- | --- | --- |
| `tree_column` | `x ramp w[위,아래]` \| `y0 y1 base lit dark sway period phase edge seed` · 수피 `bark barkLanes plateLanes lenticels scars` · 형태 `trunks converge wobble flare flareTop` · 부착물 `knots stubs moss mossCount ivy ivyStrands rootH roots` | **화면을 세로로 관통하는 고목.** 굽이 + 원통 단면(반사광 포함) + 수피 + 실루엣 요철 + 옹이·가지·이끼·담쟁이·갈래 뿌리 |
| `branch_platform` | `x y w` \| `thickness mossH wood moss base lit dark mossBase mossLit taper seed` | **이끼 낀 나뭇가지 발판.** 윗면 이끼(밝은 초록) / 목재 몸통 / 아랫면 그림자, 양 끝 가늘어짐 |
| `rope_bridge` | `x0 x1 y` \| `sag plank rail plankW plankH rope plank_i dark wood` | **로프 다리.** 늘어진 현수선 + 판자 슬랫 + 손잡이 줄 + 양끝 기둥 |
| `ladder` | `x y0 y1` \| `w step wood` | 사다리 — 수직 이동 경로가 있다는 신호 |

### 왜 사각형으로 그리면 안 되나

`rect`로 세운 줄기는 나무가 아니라 **전봇대**로 읽힌다. `tree_column`이 넣는
세 가지가 나무로 만든다.

1. **굽이** — 중심선이 사인으로 흔들리고 아래로 갈수록 굵어진다
2. **원통 단면** — 폭을 가로질러 밝기가 연속으로 떨어진다. 2px 하이라이트 +
   3px 그림자만으로는 납작한 리본이다
3. **수피 결** — 중심선과 같은 곡률의 세로 홈. 직선이면 나무결이 아니다

`edge`(양쪽 1px 어두운 윤곽)를 주지 않으면 밝은 안개 위에서 줄기가 녹아버린다.

### 고목은 화면에서 가장 큰 오브젝트다 — 위 셋은 하한선이다

굽이·단면·결만 있으면 "전봇대가 아니다"까지다. 화면을 관통하는 크기라 디테일이
모자라면 배경 전체가 덜 그려진 것으로 읽힌다. 다음 다섯이 실제로 차이를 만든다.

1. **실루엣 요철**(`wobble`, 기본 1.0) — 사인 곡선 그대로면 가장자리가 유리처럼
   매끈해 압출한 도형이 된다. 좌우에 **서로 다른** 잡음을 얹는다. 같은 값을 쓰면
   폭만 변하고 윤곽은 그대로다.
2. **반사광** — 그림자 쪽 맨 끝을 한 단 밝게 한다. 없으면 오른쪽이 커다란 단색
   검은 띠가 된다. 단면은 7단이고 마지막 단이 이것이다.
3. **부착물** — `knots`(옹이: 심 + 링 + 좌상단 테두리 3겹), `stubs`(가지 그루터기:
   잘린 단면과 **줄기에 지는 그림자**가 있어야 붙어 보인다), `moss`.
4. **`rootH`** — 밑동 폭만 넓히면 나팔이다. 부피를 가진 갈래 뿌리로 나눈다.
5. **`ivyStrands`** — 담쟁이덩굴.

### 수피 양식 — `bark`

| 값 | 수종 | 구조 |
| --- | --- | --- |
| `fissure` (기본) | 참나무·느티나무 | 세로로 흐르다 가끔 옆으로 이어지는 깊은 균열망 |
| `plate` | 소나무 | 비늘처럼 조각난 판. `plateLanes`로 세로 분할 수 |
| `lenticel` | 자작나무 | 매끈한 껍질 + 가로 숨구멍(`lenticels`) + 검은 상처(`scars`) |

**가로 눈금을 그으면 사다리가 되고, 줄눈이 맞으면 벽돌담이 된다.** `fissure`는
세로 흐름이라, `plate`는 판마다 높이를 따로 주고 모서리를 열마다 흔들어서 이
둘을 피한다. 균열·판 테두리는 어두운 단, 그 오른쪽(빛을 받는 판의 왼쪽 면)은
한 단 밝게 — 좌상단 광원 규칙 그대로다.

### 담쟁이덩굴 — `ivyStrands`

2D 측면도에서 '감았다'를 만드는 건 원근이 아니라 **가려짐**이다. 덩굴 진폭을
줄기 폭보다 크게 잡아 실루엣 밖으로 나간 구간을 그리지 않으면, 뒤로 돌아갔다
다시 앞으로 나오는 것으로 읽힌다. 잎은 3갈래이고 밝기·간격을 잎마다 흔든다.
`ivy`로 램프를 고른다(기본 `leaf`).

### 쌍둥이 줄기 — `trunks` + `converge`

`trunks: [[-18, 1.0], [19, 0.86]]`은 `[x 오프셋, 폭 배율]`이다. `converge`(0~1)를
주지 않으면 **평행한 기둥 둘**로 보인다. 아래로 갈수록 오프셋을 줄여 한 그루에서
갈라진 것으로 만든다. 부착물은 첫 번째 줄기에만 붙는다.

**색 예산에 주의한다.** 디테일을 다 켠 고목 하나가 램프 12색을 쓴다. 레이어당
상한이 야외 21색이라 한 레이어에 두 그루가 한계다.

### 로프 다리는 반드시 처져야 한다

직선으로 그으면 다리가 아니라 선반이다. `sag`가 0이면 로프로 안 읽힌다.
