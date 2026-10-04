# 프롬프트 — 4계절 × 4시간대 16장

## 쓰는 법

`STRUCTURE` + `PIXEL` + `{계절}` + `{시간대}` 를 이어 붙인다. 앞의 두 블록은
16장 전부 동일하게 두는 것이 핵심이다 — 여기가 흔들리면 같은 장소로 안 보인다.

결과는 `check_dots.py` 로 재고 `in/{계절}_{시간대}.png` 로 둔다.

---

## STRUCTURE — 16장 공통, 절대 바꾸지 않는다

```
symmetrical side-scrolling game background,
massive dark tree trunks framing both left and right edges, their bare gnarled
branches arching across the top of the frame,
exactly four round broadleaf trees in the midground, two on the left and two on
the right, leaving the center of the frame open and empty,
pale misty vertical tree trunks receding into the far background,
diagonal light rays entering from the upper left,
a mossy stone wall on the left and another on the right, a small stone pedestal
on the right side,
open flat ground across the bottom quarter of the image,
2:1 wide aspect ratio
```

**가운데는 비워야 한다.** 펫이 서는 자리(`petAnchor`)다. 이 문장을 빼면 모델이
중앙에 큰 나무나 건물을 놓는다.

## PIXEL — 도트 규격, 16장 공통

```
authentic 16-bit pixel art, true pixel grid where every pixel is a distinct
square block,
hard-edged shapes with stair-stepped diagonal edges,
strictly limited palette of 32 colors or fewer,
flat color fills with no gradients, no soft shading, no blur,
absolutely no anti-aliasing, no smoothed or feathered edges,
sprite art for a 2D game, drawn pixel by pixel,
nearest-neighbor scaling, crisp pixel boundaries
```

대화형 AI(이미지 첨부 대화형)라면 이렇게 말로 덧붙이는 편이 더 잘 듣는다:

> 색은 32가지 이내만 쓰세요. 색과 색 사이에 중간 단계를 만들지 말고, 경계는
> 계단 모양으로 딱 떨어지게 해주세요. 부드러운 그라데이션이나 흐릿한 가장자리는
> 쓰지 마세요. 확대했을 때 픽셀 하나하나가 정사각형으로 보여야 합니다.

## negative — 지원하는 도구에서만

```
anti-aliased, blurry, soft edges, gradient, smooth shading, dithering blur,
photorealistic, 3d render, depth of field, bokeh, painterly, airbrushed,
text, watermark, signature, people, animals, character,
large object in the center, cluttered center, asymmetrical framing
```

---

## 계절 4종

|            | 프롬프트                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **spring** | `fresh pale green new leaves, cherry blossom petals drifting through the air, pink and white wildflowers on the ground`                                                                   |
| **summer** | `lush deep green dense foliage, tall grass, white and yellow wildflowers`                                                                                                                 |
| **autumn** | `orange and amber and red foliage, fallen leaves carpeting the ground, some branches showing through thinning canopy`                                                                     |
| **winter** | `BARE branches with no leaves on the four midground trees, thick snow piled on every branch and on the stone walls, deep snow covering the ground, a few dry brown leaves still clinging` |

겨울은 **중경 나무 네 그루의 잎이 사라져야** 한다. `STRUCTURE` 의
`four round broadleaf trees` 가 이걸 방해하면, 겨울에 한해 그 구절을
`four bare deciduous trees with visible branch structure` 로 바꾼다.

## 시간대 4종

|           | 프롬프트                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **dawn**  | `early dawn, pale lavender and soft pink sky, low cool light, morning mist rising from the ground, faint stars still visible` |
| **day**   | `bright midday, clear light, strong god rays, vivid colors`                                                                   |
| **dusk**  | `sunset, sky glowing orange and deep pink, long warm backlight, trees rendered as dark silhouettes against the bright sky`    |
| **night** | `night, deep navy blue sky, moonlight from upper left, fireflies glowing, dark silhouetted trees, cool blue shadows`          |

`dusk` 의 `trees as dark silhouettes` 와 `night` 의 `dark silhouetted trees` 가
중요하다. 이게 없으면 하늘만 물들고 나무는 낮처럼 밝게 남는다.

---

## 조합 예 — autumn_dusk

```
{STRUCTURE}, {PIXEL},
orange and amber and red foliage, fallen leaves carpeting the ground,
some branches showing through thinning canopy,
sunset, sky glowing orange and deep pink, long warm backlight,
trees rendered as dark silhouettes against the bright sky
```

## 출력 규격

- 가로:세로 **2:1**
- 1080×540 이상이면 충분하다 — 픽셀화하면서 줄인다
- 가능하면 PNG. JPEG 는 압축이 색 경계를 뭉갠다

## 받은 뒤

```bash
python3 check_dots.py 받은이미지.png
```

색 수·중간톤·고립픽셀·블록 크기를 재서 도트 규격에 얼마나 가까운지 알려준다.
**어떤 결과든 `repalette.py` 로 팔레트를 고정하는 단계는 거쳐야 한다** — 시간대
파생과 펫과의 색 일관성이 22색 팔레트에 걸려 있기 때문이다. 다만 원본이 도트에
가까울수록 그 단계에서 잃는 것이 적다.
