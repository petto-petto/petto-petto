# 오버레이 개발 패널 시작 옵션 작업 결과

- 트랙: `$work` standard (기본 실행에서 보이는 화면이 바뀐다)
- Seed: [`.harness/specs/features/2026-10-27-overlay-dev-panel-start-option.md`](../.harness/specs/features/2026-10-27-overlay-dev-panel-start-option.md) — Approved(요청자, 2026-10-27)
- 요청: 오버레이의 디버깅 창(⚙ 개발 패널)을 `npm start`할 때 옵션을 주면 뜨게
- 성공 기준: 옵션 없이 띄우면 ⚙ 버튼과 패널이 없다. `PETTO_DEV_PANEL=1 npm start`면 지금처럼 보인다. 펫 조작은 그대로다.
- 비목표: 패널 버튼이 부르는 기능 막기, 다른 개발용 진입점(`GACHA_PROTO_OPEN` 등) 옮기기, 패널 내용 변경, 패키징된 앱

## 결정

| 질문                 | 결정                                    | 이유                                                                                                                                 |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 옵션 형태            | 환경 변수 `PETTO_DEV_PANEL=1` (요청자)  | 기존 개발용 진입점(`META_DEMO_USAGE=1` 등)과 같은 방식. `npm start -- --dev-panel`은 `--`를 빼면 npm이 옵션을 가져가 조용히 무시된다 |
| 켜는 값              | 정확히 `1`만                            | `PETTO_DEV_PANEL=0`을 켠 것으로 읽지 않는다                                                                                          |
| 메인 → 오버레이 전달 | 오버레이 창 주소의 `devPanel=1` 질의 값 | 펫룸의 `focus`, 뽑기·합성의 `assets`와 같은 방식. preload·IPC를 늘리지 않는다                                                        |
| 브라우저 미리보기    | 옵션 없이 늘 보인다                     | Electron 이 없으면 성장을 움직일 방법이 패널뿐이다                                                                                   |

## 역할별 결과

- Explorer: 패널은 `Overlay.jsx` 한 곳에서만 그린다. hit-test(`useHitTest.js`)는 `.io` 요소를 따라가므로 패널을 안 그리면 입력 영역도 같이 빠진다. 오버레이 창은 질의 값 없이 열리고 있었다.
- Planner: ① 판정 함수와 계약 테스트(먼저 실패) ② `Overlay.jsx`에서 판정 ③ 메인이 환경 변수를 읽어 두 생성 지점(시작, macOS `activate`)에서 넘긴다.
- Implementer:

| 파일                                                      | 변경                                                                      | 검증                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/pet-overlay/src/overlay/dev-panel.ts` (새 파일) | `DEV_PANEL_QUERY`, `showsDevPanel(search, electron)`                      | `test/overlay-dev-panel.contract.test.ts` 2건(모듈이 없어 먼저 실패 확인) |
| `packages/pet-overlay/src/overlay/Overlay.jsx`            | 시작할 때 한 번 판정하고 `devPanelVisible`일 때만 `<DevPanel>`            | 실화면 DOM                                                                |
| `apps/desktop/src/main/windows.ts`                        | `createOverlayWindow({ devPanel })`가 켜졌을 때 `devPanel=1`을 붙여 연다  | 실화면 주소                                                               |
| `apps/desktop/src/main/main.ts`                           | `shouldShowDevPanel()`(`PETTO_DEV_PANEL === '1'`)를 두 생성 지점에 넘긴다 | 실화면(`1`·`0`·없음)                                                      |

## 검증

- Mechanical(최종 변경 뒤 새로 실행):
  - `npm run build` exit 0
  - `bash .harness/scripts/verify-electron.sh` exit 0 — Prettier, typecheck 통과, `npm test` 657/657
  - `apps/desktop`: `ELECTRON_RUN_AS_NODE=1 electron --test test/*.test.cjs` 114/114
  - `git diff --check` 이상 없음
- Semantic: 사용자 데이터 복사본으로 빌드된 앱을 세 번 띄워 CDP로 오버레이 DOM을 읽었다. 원본은 바꾸지 않았다.

| 확인                                                            | 결과 | 증거                                                           |
| --------------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| 옵션 없이 띄우면 패널 없음                                      | 통과 | 주소 질의 없음, `.devpanel`·`.dev-toggle` 없음                 |
| `PETTO_DEV_PANEL=1`이면 ⚙가 접힌 채로 있고 누르면 패널이 열린다 | 통과 | 주소 `?devPanel=1`, `⚙` 버튼, 누른 뒤 `Growth Debug / Lv 28 …` |
| `PETTO_DEV_PANEL=0`이면 패널 없음                               | 통과 | 주소 질의 없음, `.devpanel` 없음                               |
| 펫 우클릭 메뉴는 그대로                                         | 통과 | 두 경우 모두 `펫룸 / 가능 / 뽑기 / 전투 / 보상 5 / 정보`       |
| 브라우저 미리보기는 늘 보인다                                   | 통과 | 계약 테스트(`showsDevPanel('', false)`)                        |

## Independent Review

같은 세션에서 Reviewer 계약으로 diff를 다시 읽었다. 구현자와 다른 사람의 검토는 PR에서 받는다. 범위 밖 수정 없음. 패널 버튼이 부르는 IPC는 그대로라(비목표) 패널을 숨겨도 기능이 사라지지 않는다.

## 남은 일

- `npm start` 자체로는 띄우지 않았다(실제 사용자 데이터를 쓰기 때문). npm 은 환경 변수를 스크립트의 `electron`까지 그대로 넘기므로, 빌드된 앱에 같은 환경 변수를 준 확인으로 대신했다.
- 브라우저 미리보기(`npm run dev --workspace @pet/main-overlay`)는 띄워 보지 않고 계약 테스트로만 확인했다.

## Evolve

none — 하네스 규칙 변경 없음.
