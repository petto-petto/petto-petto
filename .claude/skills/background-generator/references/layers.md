# 레이어 · 메타 규약

## 출력

```
assets/backgrounds/{id}_{slug}/
  scene.json              소스 스펙 — 수정은 항상 여기서 시작
  {id}.json               런타임 메타
  {id}_composite.png      합성본 (패럴랙스를 안 쓰는 화면용)
  {id}_sky.png            불투명 — 항상 맨 뒤
  {id}_far.png            투명 배경
  {id}_mid.png            투명 배경
  {id}_near.png           투명 배경 — 펫 박스는 비어 있어야 한다
```

## 메타 json

```json
{
  "id": "bg_004", "name": "안개 숲", "preset": "forest", "kind": "outdoor",
  "width": 280, "height": 120, "seamless": false,   // 크기는 요청마다 다르다
  "horizon": 54, "groundTop": 94,
  "petAnchor": {"x": 124, "y": 62, "w": 32, "h": 32},
  "composite": "bg_004_composite.png",
  "layers": [
    {"name": "sky",  "file": "bg_004_sky.png",  "z": 0, "parallax": 0.0,  "opaque": true},
    {"name": "far",  "file": "bg_004_far.png",  "z": 1, "parallax": 0.25, "opaque": false},
    {"name": "mid",  "file": "bg_004_mid.png",  "z": 2, "parallax": 0.55, "opaque": false},
    {"name": "near", "file": "bg_004_near.png", "z": 3, "parallax": 1.0,  "opaque": false}
  ],
  "palette": {"outlineReserved": "#2C2438", "colors": ["#172808", ...]}
}
```

## 런타임이 이 값을 쓰는 법

- **z 오름차순으로 그린다.** `sky`가 맨 뒤, `near`가 맨 앞. 펫 스프라이트는
  `mid`와 `near` **사이**에 들어간다 — 그래서 near가 펫 박스를 비워야 한다는
  게이트가 있다(비우지 않으면 전경이 펫을 가린다).
- **패럴랙스**: 카메라가 dx만큼 움직이면 레이어는 `dx * parallax`만큼 움직인다.
  `sky`는 0이라 고정, `near`는 1.0이라 카메라와 같이 간다.
- **`seamless: true`가 아니면 가로로 반복하지 않는다.** 반복시키려면 렌더 때
  `--seamless`로 만들고 `bg_check.py`의 이음매 검사를 통과시켜야 한다.
- **`petAnchor`**는 펫 스프라이트의 좌상단 좌표와 크기다. 발이 `groundTop`에
  닿는다(`y + h == groundTop`). 캔버스가 커지면 `w`/`h`도 스탬프 배율만큼
  커진다(280x120에서 32x32, 560x240에서 64x64).
  **배경은 이 자리를 비워 주지 않는다** — 펫 가독성은 게임 쪽 발광 이펙트가
  맡기로 해서 관련 게이트를 뺐다. 이 좌표는 펫과 발광을 배치하라고 남긴 것이다.
- 패럴랙스를 안 쓰는 화면(도감 썸네일 등)은 `composite`만 쓰면 된다.

## 애니메이션 — `animation` 블록

움직임이 있는 배경은 런타임 메타에 이 블록이 붙는다(`bg_animate.py`가 쓴다).

```json
"animation": {
  "layer": "near",
  "fps": 6,
  "loop": true,
  "frames": ["frames/near_00.png", "... 12장"]
}
```

**소비 규약**

1. `layers`를 `z` 순으로 합성한다.
2. `animation.layer`로 지정된 레이어 **하나만** `frames`를 `fps`로 교체한다.
   나머지는 고정이다.
3. `frames[0]`은 정적 레이어 PNG와 같은 위상이라, 애니메이션을 끄면 그대로 두면 된다.

프레임은 `frames/` 하위에 둔다. 최상단에 두면 `bg_check.py`가 레이어로 오인한다.
프레임의 캔버스는 교체 대상 레이어와 같아야 하고, `bg_check.py`가 이를 검사한다.

> **이 규약은 아직 미검증이다.** 실제로 읽는 런타임이 아직 없다. 최초 소비자가
> 붙었을 때 부족한 것이 나오면(예: parallax 스크롤과 프레임 교체를 같이 하려면
> 레이어별 오프셋이 더 필요하다면) **규약을 고칠 일이지 런타임에서 억지로 맞출
> 일이 아니다.** 그때 이 절과 `bg_animate.py`를 함께 고친다.

## 레이어를 3장이나 5장으로 할 때

3~5장이 허용 범위다. 줄일 때는 `far`를 빼고(sky/mid/near), 늘릴 때는 `near`
앞에 `fg`(parallax 1.3)를 더한다. 어느 쪽이든 **parallax는 단조 증가**여야 하고
각 레이어는 바로 뒤와 명도차 0.08 이상이어야 한다.

## seamless 주의

`--seamless`를 주면 렌더러가 반복 무늬의 주기를 **캔버스 폭의 약수로 스냅**하고
로브·조인트의 지터를 끈다(`hills.period`, `fringe.spacing`, `foliage` 로브 간격,
`ground_plane.cell`, `panel.jointEvery`). 그래야 좌우 끝에서 위상이 맞는다.

`bg_check.py`의 이음매 검사는 **모든 인접 열 쌍의 차이 분포**와 비교한다.
내부 한 쌍과 비교하면 블록 디더에서 하필 같은 블록에 속한 쌍을 골라 기준이
0이 되는 일이 있다. 통과해도 유기적인 매스(`foliage`)에는 1px 수준의 이음매가
남을 수 있으니, 실제로 가로 반복시킬 배경이면 두 장 이어 붙여 눈으로 한 번 본다.
