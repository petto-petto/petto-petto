# 전투 투명도 잔상·프레임 수정

## Track and Seed

Standard. 2026-10-19 요청자는 최신 main을 받은 뒤 움직이는 펫의 그림자와 밝은 배경에서
남는 창 외곽을 수정하도록 요청했다.
Seed는 기존 [표시 설정 명세](../.harness/specs/features/2026-10-07-battle-display-settings.md)다.
펫 본체의 불투명과 기존 전투를 유지하면서 장식 그림자·창 프레임이 남지 않는 것이 성공 기준이다.
XP·스테이지·저장 형식·전투 모션 자산은 범위 밖이다.

최신 main `37f45b0`에는 MR #27이 이미 squash 병합되어 있었다.
기존 브랜치에 중복 적용하는 rebase를 취소하고 최신 main에서
`fix/srkim0917/battle-transparency`를 만들었다. 기존 브랜치는 보존했다.

## Explorer

펫 본체와 같은 불투명 부모에 속한 `.ground-shadow`가 고정 alpha 0.62를 사용했다.
hover 강조광도 고정 금색이어서 투명도와 관계없이 남을 수 있었다.
CSS 프레임은 반투명 상태에도 선형 alpha로 표시되어 밝은 배경에서 보였다.
실제 전투 창 옵션에는 Windows 기본 `thickFrame`과 OS 그림자를 끄는 설정이 없었다.
종전 Electron 테스트는 실제 옵션 대신 별도 테스트용 생성 옵션을 사용했다.

## Planner

1. 실제 창 옵션을 테스트에서도 재사용하고 Windows 프레임 비활성 검증을 추가한다.
2. OS 프레임·그림자를 끄고 투명한 창 배경을 명시한다.
3. 반투명 상태에는 CSS 프레임을 숨기되 기존 레이아웃과 불투명 프레임은 유지한다.
4. 펫의 장식 그림자·강조광을 기존 환경 투명도에 연결한다.
5. 0%와 35% 픽셀 alpha, 실제 두더지 0·2단계 공격, 흰색·검은색 합성을 검증한다.
6. 공유 gate와 diff 리뷰를 수행한다.

## Implementer

실제 창 옵션으로 바꾼 Electron 테스트에서 `thickFrame`이 정의되지 않아 먼저 실패했다.
`window-options.json`에 투명 배경과 `hasShadow: false`, `thickFrame: false`를 명시했다.
설치된 Electron 타입 설명도 `thickFrame` 기본값이 true이며 이를 끄면 OS 프레임·그림자를
제거한다고 설명한다. main과 데모는 같은 설정 파일을 사용한다.

CSS의 반투명 상태는 장식 프레임의 색과 그림자만 숨겨 2px 레이아웃 폭을 유지한다.
장식 그림자와 강조광은 기존 환경 투명도 변수를 사용하며 펫 본체는 변경하지 않는다.
새 저장값·계산 규칙·IPC는 추가하지 않았다.

## Verifier

- `npm run typecheck` 및 `npm run build:ui --workspace @pet/battle` 통과.
- 실제 Electron 표시 테스트 통과: 기본 프레임·OS 그림자 없음, 창 크기 변경,
  드래그 중 실시간 투명도, 불투명 펫 유지, 35%에서도 모서리 alpha 0,
  0%에서 장식 그림자 alpha 0, 빈 알림 숨김·복귀, 간소화 공격을 확인했다.
- 실제 두더지 0·2단계 idle/attack 자산을 주입해 native 공격 시점을 캡처했다.
  흰색과 검은색으로 합성한 네 장을 시각 검토해 별도 그림자·창 모서리가 남지 않는 것을 확인했다.
- 창 크기는 Windows DPI 반올림 1px 허용 범위에서 변경되었다.
- `bash .harness/scripts/verify-electron.sh`가 최종 Mechanical gate이며
  최신 실행 결과는 작업 응답에 기록한다.

## Reviewer

별도 리뷰 단계에서 장식 프레임 제거 시 레이아웃 이동 여부, 펫 본체 alpha 유지,
종별 바닥 그림자 opacity와의 합성, 실제 창 옵션 재사용 및 테스트 자산 원본 보존을 확인했다.
사용자 DB를 변경하지 않고 임시 프로필로 검증했다. 미해결 코드 지적 없음.
offscreen 캡처는 클라이언트 영역을 검증하며 OS 프레임은 실제 생성 옵션으로 확인했다.

## Evolve

None. 테스트가 실제 창 옵션을 재사용하도록 개선했으며 별도 harness 규칙 변경은 하지 않았다.
