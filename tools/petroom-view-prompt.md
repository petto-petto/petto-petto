# 펫룸 뷰 구현 — 새 세션용 프롬프트

아래 `---` 사이를 그대로 복사해 새 세션에 붙여 넣으면 된다. 또는 새 세션에서
`@tools/petroom-view-prompt.md` 를 읽게 해도 같다.

---

펫룸(Pet Room) 화면을 구현해줘. 배경 에셋과 배경 생성 스킬은 이미 끝나 있고,
화면 자체가 아직 코드 0줄이야.

## 참고할 레퍼런스 구현

`/Users/sowonpark/Documents/개인/tamagotchi-pet-main` 에 펫룸이 **기능적으로 완성된
다른 프로젝트**가 있다. electron-vite + React + TS이고, 우리와 스택이 다르지만
로직과 설계 결정은 그대로 쓸 만하다. 먼저 이걸 읽어라.

| 경로                                          | 내용                                       |
| --------------------------------------------- | ------------------------------------------ |
| `.omc/specs/deep-interview-petroom.md`        | 요구사항 명세 (모호도 12%, 수용 기준 포함) |
| `.omc/plans/plan-petroom.md`                  | 구현 계획 + **ADR(상태 동기화 결정)**      |
| `.omc/plans/plan-petroom-design.md`           | 도트 톤 결정 (Galmuri 폰트, 픽셀 패널)     |
| `src/renderer/src/petroom/PetRoomView.tsx`    | 공유 rAF 루프로 전 펫 위치 일괄 갱신       |
| `src/renderer/src/petroom/PetSprite.tsx`      | 캔버스 스프라이트, 발밑 그림자, 클릭 반응  |
| `src/renderer/src/petroom/PetDetailPanel.tsx` | 등급 배지 · 레벨 · XP바 · 액션 버튼        |
| `src/renderer/src/petdex/PetDexView.tsx`      | 20슬롯 도감                                |
| `src/renderer/src/lib/spriteAssets.ts`        | 경로 조립 · 프레임 슬라이싱                |
| `src/shared/ipc.ts`                           | `OwnedPet` 타입, IPC 채널 상수             |
| `docs/pet-assets-guide.md`                    | 스프라이트 에셋 규칙                       |

**레퍼런스에서 가져오지 말 것**: `scripts/generate-petroom-background.py` 와
`petroom-forest.png`. 우리 배경 파이프라인이 상위 호환이다(아래 참조).

### 레퍼런스가 이미 내린 결정 — 그대로 따를 것

`plan-petroom.md` 의 ADR이다. 창이 여럿인 구조에서 이걸 어기면 진실의 원천이 둘로
쪼개진다.

> main 프로세스(저장소)를 **단일 진실 소스**로 두고, 활성 펫이 바뀌면 열려 있는
> 모든 창에 push 이벤트를 브로드캐스트한다. **활성 펫을 바꾼 창 자신도 로컬
> state를 낙관적으로 먼저 갱신하지 않는다** — IPC 호출만 하고, 화면 갱신은 오직
> push 구독 콜백에서만 한다. 발신 창도 예외 없다.

그 밖에 따를 것:

- 펫마다 rAF를 돌리지 말고 **하나의 공유 rAF 루프**가 전 펫 위치를 매 프레임 일괄
  갱신한다 (드리프트·낭비 방지)
- 사용 가능한 모션은 `idle` / `click` / `click2` / `attack` / `card` 뿐이다.
  **walk 애니메이션이 없다** → idle을 유지한 채 위치만 슬라이드 이동
- **스프라이트 좌우 반전(flip) 금지** (광원 좌상단 고정 규칙)
- 클릭 시 `click` / `click2` 중 랜덤 1종을 1회 재생하고 idle로 복귀
- 프레임 크기·개수는 **항상 스프라이트 옆 json에서 읽는다.** 32로 하드코딩 금지
  (EPIC stage3만 48px이라 그 종만 잘린다)

## 이 프로젝트의 현재 상태

**모노레포**

```
apps/desktop/
  src/main/{main,windows,mount,store}.ts   Electron 껍데기 (TS ESM, .ts 확장자 import)
  src/preload/preload.cjs                  window.petApi 화이트리스트
  renderer/{pet.html,pet.js,pet.css}       오버레이 펫 창 — 순수 HTML/JS, 번들러 없음
  renderer/assets/backgrounds/             배경 3종
  renderer/assets/pets/epic/star_wizard/   펫 1종만 (레퍼런스는 6종)
packages/pet-core/                         clock, ids
packages/pet-meta/                         정보·설정·업적 도메인 + ui/ 패널
tools/backgrounds/                         배경 재생성 도구
```

**이미 되어 있는 것**

- `apps/desktop/renderer/pet.js` 에 **스프라이트 캔버스 재생기가 이미 완성**돼 있다.
  `stageOfLevel`, json에서 frameWidth 읽기, 정수 배율 nearest-neighbor,
  click/click2 랜덤, 1회 재생 후 idle 복귀 — 레퍼런스 `PetSprite.tsx` 와 같은
  알고리즘이다. **다시 짜지 말고 이걸 재사용해라.**
- 트레이 → 정보/설정/업적 패널, `JsonFileStore` 원자적 저장

**비어 있는 것 — 여기가 할 일**

- 펫룸 화면 자체 (코드 0줄)
- 보유 펫 데이터: `packages/pet-meta/src/testing/fakes.ts` 의 `InMemoryCollection`
  이 **테스트 페이크인데 프로덕션에 그대로 꽂혀 있다**
  (`packages/pet-meta/src/app/state.ts:52`). `overlayPet()` 은 star_wizard Lv.21
  고정, `ownedPetCount()` 는 3, `dexProgress()` 는 3/24를 반환한다.
  `CollectionPort` 인터페이스는 `packages/pet-meta/src/ports/index.ts` 에 있다.

## 이미 정해진 것

- **React + 번들러 도입**으로 간다. 현재 renderer는 번들러 없는 순수 HTML/JS라
  `.tsx` 를 쓰려면 도입이 필요하다. 도입하면 `.harness/rules/electron.md` 의 검증
  파이프라인(`npm run format:check` / `typecheck` / `test`)도 함께 맞춰야 한다.
- 배경은 **960x360**, 낮(`bg_002_deep_forest`) / 밤(`bg_003_deep_forest_night`) 2종.

## 배경 에셋 계약 — 이 화면이 최초 소비자다

`apps/desktop/renderer/assets/backgrounds/{id}_{slug}/` 구조:

```
scene.json              소스 스펙 (수정은 여기서 시작, 렌더러는 안 읽음)
bg_00X.json             런타임 메타  ← 이걸 읽어라
bg_00X_composite.png    합성본 (레이어를 안 쓸 때의 대안)
bg_00X_{sky,far,mid,near}.png
frames/near_00~11.png   반딧불이 애니메이션
refs/elements.json      요소 목록 (렌더러와 무관)
```

`bg_00X.json` 의 형태:

```json
{
  "id": "bg_002",
  "name": "깊은 숲 (낮)",
  "width": 960,
  "height": 360,
  "horizon": 162,
  "groundTop": 282,
  "petAnchor": { "x": 432, "y": 186, "w": 96, "h": 96 },
  "composite": "bg_002_composite.png",
  "layers": [
    { "name": "sky", "file": "bg_002_sky.png", "z": 0, "parallax": 0.0, "opaque": true },
    { "name": "far", "file": "bg_002_far.png", "z": 1, "parallax": 0.25, "opaque": false },
    { "name": "mid", "file": "bg_002_mid.png", "z": 2, "parallax": 0.55, "opaque": false },
    { "name": "near", "file": "bg_002_near.png", "z": 3, "parallax": 1.0, "opaque": false }
  ],
  "animation": {
    "layer": "near",
    "fps": 6,
    "loop": true,
    "frames": ["frames/near_00.png", "... 12장"]
  }
}
```

소비 방법: `layers` 를 `z` 순으로 합성하고, `animation.layer` 로 지정된 레이어만
`animation.frames` 를 `fps` 로 교체한다. 나머지 셋은 고정이다.
`groundTop` 이 펫이 서는 바닥선, `petAnchor` 가 펫 자리의 기준 좌표다.
`parallax` 는 레이어를 다른 속도로 밀 때 쓰는 계수다.

**중요**: 이 계약은 **아직 아무도 읽어 본 적이 없다.** 붙여 보고 부족하면
(예: parallax 스크롤과 프레임 교체를 같이 하려면 레이어별 오프셋이 더 필요하다면)
**그건 계약의 결함이니 말해 달라.** 배경 쪽에서 고칠 수 있다. 렌더러에서 억지로
맞추지 말 것.

## 지켜야 할 규칙

1. **먼저 읽어라**: `AGENTS.md` → `.harness/rules/electron.md`(TS/Electron/패키지
   변경 전) → `design.md`(UI·비주얼 변경 전).
2. **`$work` 스킬로 진행**한다. 기능 작업의 구현·리뷰 워크플로를 그게 정의한다.
3. **도메인 규칙을 Electron main/preload/renderer 에 두지 마라.** 창을 띄우지 않고
   테스트할 수 있어야 한다 — 보유 펫 로직은 `packages/` 안에.
4. **검증 게이트**: 최종 변경 뒤 `bash .harness/scripts/verify-electron.sh` 를 돌리고
   그 출력으로 완료를 보고한다. 돌리지 않고 완료라고 하지 말 것.
5. **배경 생성 스킬(`.claude/skills/background-generator/`)은 건드리지 마라.**
   별도 작업에서 방금 정리한 상태다.

## 함정 (겪은 것들)

- `verify-contract.sh` 는 프로젝트 venv가 `PATH` 앞에 있으면 오탐한다. 깨끗한 셸에서
  돌려라: `env -u PATH PATH=/usr/bin:/bin:/opt/homebrew/bin bash -lc '...'`
- 임시 디렉터리(`/private/tmp`)에 작업 산출물을 두지 마라. 세션 중 시스템이 비운다.
- 펫 에셋이 **1종뿐**이다. 여러 마리 배회를 보려면 같은 종을 여러 마리 시드하거나
  레퍼런스에서 나머지 5종을 가져와야 한다. 어느 쪽인지 정하고 진행해라.

## 산출물

`npm run dev` 로 펫룸을 열었을 때, 시드된 보유 펫들이 새 배경 위에서 각자 idle
애니메이션을 재생하며 하단을 서서히 배회하고, 반딧불이가 움직이고, 펫을 클릭하면
click 반응 후 상세 패널이 뜨고, 활성 펫을 바꾸면 오버레이 창이 재시작 없이 즉시
바뀌는 것.

먼저 레퍼런스와 현재 코드를 읽고 계획을 세워서 보여 달라. 계획에 동의하면 그때
구현해라.
