# 스탬프

스탬프는 `stamps/{outdoor,interior}/{name}.txt`에 있는 작은 ASCII 그리드다.
포맷은 `pixel-pet-creator`의 그리드와 같지만 **legend 값이 hex가 아니라 램프
참조**라는 점이 다르다 — 그래서 같은 나무가 프리셋에 따라 다른 색으로 찍힌다.

```
[legend]
h = leaf.4
b = leaf.2
s = leaf.0
[grid]
...hhh.....
..hbbbhh...
.hbbbbbbh..
```

`.`은 투명. 행 길이는 자동으로 오른쪽 `.` 패딩된다.

## 지금 있는 것

| outdoor | 크기 | | interior | 크기 |
| --- | --- | --- | --- | --- |
| `bush` | 11x7 | | `antlers` | 38x20 |
| `cactus` | 9x10 | | `armchair_back` | 34x46 |
| `cloud_big` | 21x7 | | `blanket` | 16x15 |
| `cloud_small` | 13x5 | | `crate` | 9x9 |
| `dead_tree` | 10x10 | | `fireplace` | 36x36 |
| `flower` | 3x3 | | `firewood` | 20x10 |
| `grass_tuft` | 5x4 | | `floor_plank` | 12x5 (tile 전용) |
| `log` | 13x6 | | `lamp` | 7x10 |
| `mushroom` | 5x5 | | `picture` | 9x8 |
| `platform` | 24x9 | | `picture_wide` | 16x12 |
| `rock` | 9x6 | | `plant_pot` | 9x11 |
| `spire` | 9x10 | | `rug` | 30x9 |
| `tree_pine` | 13x20 | | `rug_cozy` | 42x13 |
| `tree_round` | 17x22 | | `sconce` | 9x13 |
| `vine` | 3x12 | | `shelf` | 17x13 |
|  |  | | `sofa` | 52x26 |
|  |  | | `window` | 15x13 |
|  |  | | `window_lit` | 15x13 |
|  |  | | `window_snow` | 46x28 |
|  |  | | `wood_wall` | 8x6 (tile 전용) |

```bash
python3 -c "import sys;sys.path.insert(0,'scripts');import bgcore
for n,(s,w,h) in bgcore.list_stamps().items(): print(f'{s}/{n:<13} {w}x{h}')"
```

## 새로 만들 때

1. **램프 참조만 쓴다.** 리터럴 hex를 쓰면 그 스탬프는 한 프리셋에서만 산다.
2. **한 스탬프의 색은 3~4개.** 레이어당 색 상한이 21~22라 8색짜리 스탬프 세 개면
   넘는다. 책장처럼 색이 많이 필요한 것은 같은 램프의 다른 단을 쓴다.
3. **식물은 `leaf` 램프.** 세 프리셋 모두 `leaf`를 갖고 있어서 실내에서도 화분이
   초록으로 나온다. 야외 전용으로 `mid`를 쓰면 실내에서 갈색 잎이 된다.
4. **광원은 좌상단.** 위·왼쪽 모서리가 밝은 단, 오른쪽 아래가 어두운 단.
5. **크기는 용도에 맞게.** 화면이 120px이므로 나무는 22px가 상한선에 가깝다.
   그보다 크면 배경이 아니라 오브젝트다.
6. 만든 뒤 `bg_render.py`로 한 번 굽고 `bg_check.py`의 레이어 색 수를 본다.

## 3톤 규칙 (2026-08-29 추가)

`bg_check.py`의 **매스 3톤** 게이트는 200px 이상 매스의 80% 이상이 램프 3단
이상을 쓸 것을 요구한다. 스탬프가 크면(scale 2 이상이면 특히) 그 스탬프 하나가
매스가 되므로 **스탬프 단계에서 3톤을 넣는 게 맞다.**

프레임·기둥·상자처럼 테두리가 있는 것은 이렇게 한다.

```
h = wood.4     좌상단 모서리 (밝음)
w = wood.2     본체
s = wood.0     우하단 모서리 (어두움)
```

`picture` / `crate` / `window_lit` / `shelf` / `sofa` / `fireplace`가 이 규칙으로
되어 있으니 새 스탬프를 만들 때 참고한다.

반복 무늬가 있는 큰 스탬프(벽돌·널판·창유리)는 3톤에 더해 **켜(course) 구조**로
쌓는다: 줄눈(어두움) → 바로 아래 윗면(밝음) → 본체. 8x8 창 어디를 봐도 좌상단이
밝아야 광원 일관성 게이트를 넘는다 — `fireplace`가 이 구조다.

## 램프 간 중복 hex 금지

`bgcore.validate_preset`이 프리셋 로드 시점에 막는다. 색 -> (램프, 단계) 역맵에
의존하는 연산(`autoshade`, `bg_check`의 매스 판정)이 중복 hex에서 깨진다. 새
프리셋을 넣으면 `bg_palette.py show --preset <이름>`으로 한 번 로드해 검증을
통과시킨다.

## 실내 세트 (cozy_study 계열)

`sofa` `armchair_back` `blanket` `fireplace` `firewood` `rug_cozy` `antlers`
`window_snow` `picture_wide` `sconce`. 아늑한 방·서재 요청은 이 세트로 대부분
커버되므로 **새로 그리기 전에 목록부터 확인한다.**

- 전경(near)에 올릴 가구: `sofa` `armchair_back` — `gate_conflicts.md` §1
- 한색 대비를 만드는 것: `window_snow` `picture_wide` (`accent` 램프 사용)
- 광원이 되는 것: `fireplace` `lamp` `sconce` — `glow` op을 같이 건다
