# Feature specification: 오버레이 개발 패널은 시작 옵션을 줄 때만 띄운다

This specification owns the product what and why. The related implementation
plan owns the technical how.

## Status

Approved (요청자 승인, 2026-10-27 — 옵션은 환경 변수 `PETTO_DEV_PANEL=1`)

## Owner

sh111-coder (요청자). 오버레이 변경은 오버레이 담당이 리뷰한다.

## Problem and user outcome

오버레이의 ⚙ 개발 패널(`Growth Debug`)이 모든 실행에서 보인다. 토큰 추가, 성장 초기화, 활성 펫 바꾸기처럼 실제 사용 중에
누르면 안 되는 버튼이 펫 옆에 늘 있다. 동선 1단계(2026-10-17)는 "별도 실행 방법은 학습 비용이 있어 지금은 그대로 두고 나중에
걷어 낸다"며 이 일을 미뤘다.

기본 실행에서는 패널이 없고, 개발자가 시작 옵션을 주면 지금처럼 보인다.

## Scope

- 옵션 없이 `npm start`로 띄우면 오버레이에 ⚙ 버튼도 패널도 없다.
- `PETTO_DEV_PANEL=1 npm start`로 띄우면 ⚙ 버튼이 보이고, 누르면 지금과 같은 패널이 열린다. 처음에는 지금처럼 접혀 있다.
- 빌드된 앱을 `PETTO_DEV_PANEL=1 electron apps/desktop/dist/main/main.js`로 직접 띄워도 같다.
- 옵션은 그 실행에만 적용된다. 저장하지 않는다.
- 브라우저 미리보기(`npm run dev --workspace @pet/main-overlay`)는 옵션 없이도 패널을 보인다. Electron 없이 성장을 움직일
  방법이 패널뿐이다.

## Non-goals

- 패널 버튼이 부르는 기능(토큰 추가, 성장 초기화, 펫룸 배경 미리보기 등)을 막는 것. 패널을 숨길 뿐 기능은 그대로다.
- 다른 개발용 진입점(`GACHA_PROTO_OPEN`, `COMBINE_PROTO_OPEN`, `META_PROTO_OPEN_PANEL`, `META_DEMO_USAGE`, 전투 모션 메뉴)을
  같은 옵션으로 옮기는 것
- 패널의 내용과 모양 변경
- 패키징된 앱의 실행 옵션

## Domain rules

1. 기본값은 숨김이다. `PETTO_DEV_PANEL`이 정확히 `1`일 때만 보인다(기존 `META_DEMO_USAGE=1`과 같은 규칙).
2. 앱이 시작할 때 한 번 정한다. 실행 중에 켜고 끄지 않는다.

## Acceptance criteria

| 관측 가능한 결과 | 확인 방법 |
| --- | --- |
| 옵션 없이 띄운 오버레이에 ⚙ 버튼과 개발 패널이 없다 | 단위 테스트, 실화면(DOM) |
| `PETTO_DEV_PANEL=1`로 띄우면 ⚙ 버튼이 있고, 누르면 `Growth Debug` 패널이 열린다 | 실화면(DOM) |
| 브라우저 미리보기(Electron 아님)에서는 옵션 없이도 패널이 보인다 | 단위 테스트 |
| 펫 클릭·드래그·우클릭 메뉴는 패널이 있든 없든 그대로다 | 실화면 |
| 기존 테스트와 `bash .harness/scripts/verify-electron.sh`가 통과한다 | 명령 실행 결과 |

## Edge and error cases

- **값이 `1`이 아님**(`PETTO_DEV_PANEL=0`, `true`, 빈 값): 끈 것으로 본다. `0`을 켠 것으로 읽는 일을 막는다.
- **오버레이 창을 다시 만들 때**(macOS Dock 클릭 등): 처음 실행의 옵션을 그대로 따른다.

## API and data impact

- 옵션이 있을 때만 오버레이 창 주소에 개발 패널 표시용 질의 값이 붙는다. 다른 창, IPC, 저장 형식은 바뀌지 않는다.

## Open questions

none — 옵션 형태는 요청자가 환경 변수로 정했다(2026-10-27). `npm start -- --dev-panel`은 `--`를 빼면 npm이 옵션을
가져가는 함정이 있었고, 환경 변수는 기존 개발용 진입점과 같은 방식이다.

## Related implementation plan

작업 기록: [`docs/overlay-dev-panel-start-option-work-result.md`](../../../docs/overlay-dev-panel-start-option-work-result.md)
